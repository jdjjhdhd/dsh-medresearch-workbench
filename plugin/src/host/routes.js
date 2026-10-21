import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  CUSTOM_TEST_PROMPT,
  DEFAULT_MODE,
  MAX_BODY_BYTES,
  MAX_QUESTION_CHARS,
  PLUGIN_ID,
  PLUGIN_VERSION,
  PROVIDERS,
  ROUTE_PREFIX,
} from './constants.js';
import {
  HttpError,
  getService,
  json,
  makeFence,
  methodNotAllowed,
  readJsonBody,
  requireString,
  sendError,
} from './http.js';
import {
  callCustom,
  errorStatusFor,
  resolveDshSelection,
  streamDsh,
} from './llm.js';
import { buildMessages } from './prompts.js';
import { createBridgeService } from './service.js';
import { resolveHostInstallation } from './installation.js';
import {
  clearAllStoredKeys,
  describeKey,
  deleteStoredKey,
  keySlot,
  loadKey,
  loadSettings,
  normalizeSettings,
  saveSettings,
  storeKey,
} from './store.js';

export const name = PLUGIN_ID;
export const inject = ['webServer'];

/** 内存密钥也按 provider + 规范化 Base URL 的 slot 隔离，进程内也不跨平台复用。 */
const memoryKeys = new Map();
let testState = null;
const workbenchRuntimes = new WeakMap();

function workbenchRuntime(ctx) {
  const installation = resolveHostInstallation(ctx);
  if (!installation.ok) throw new HttpError(503, 'installation-unavailable', installation.error);
  let runtime = workbenchRuntimes.get(ctx);
  if (!runtime || runtime.projectRoot !== installation.projectRoot) {
    runtime = { projectRoot: installation.projectRoot, service: createBridgeService({ projectRoot: installation.projectRoot }) };
    workbenchRuntimes.set(ctx, runtime);
  }
  return { ...runtime, installation };
}

function nowIso() {
  return new Date().toISOString();
}

function bindingReason(value) {
  return value === 'ambiguous' || value === 'none' ? value : value === 'unique' ? 'unique' : '';
}

function keyConfigured(settings) {
  return memoryKeys.has(keySlot(settings));
}

async function effectiveKey(ctx, settings) {
  const slot = keySlot(settings);
  if (memoryKeys.has(slot)) return { key: memoryKeys.get(slot), source: 'memory', slot };
  const loaded = await loadKey(ctx, settings);
  return { ...loaded, slot };
}

/** 读取“新配置 slot”已有的密钥；绝不回退到旧 slot。 */
async function existingKeyForSlot(ctx, custom) {
  const probe = { custom: { ...custom, rememberKey: true } };
  return effectiveKey(ctx, probe);
}

function customFingerprint(settings, hasKey) {
  const custom = settings.custom;
  return [settings.mode, keySlot(settings), custom.model, custom.rememberKey, hasKey ? 'key' : 'nokey'].join('|');
}

function dshFingerprint(selection) {
  return [selection.source, selection.provider, selection.model, selection.reasoningEffort || ''].join('|');
}

function currentStatus(settings, dsh, customHasKey) {
  if (!testState) return { status: 'untested', at: 0, message: '尚未测试' };
  const fingerprint = settings.mode === 'custom'
    ? customFingerprint(settings, customHasKey)
    : dshFingerprint(dsh);
  if (testState.fingerprint !== fingerprint) return { status: 'untested', at: 0, message: '配置或模型已变化，需重新测试' };
  return testState.status === 'success'
    ? { status: 'success', at: testState.at, message: testState.message, provider: testState.provider, model: testState.model, source: testState.source }
    : { status: testState.status, at: testState.at, message: testState.message, provider: testState.provider, model: testState.model, source: testState.source };
}

async function settingsPayload(ctx, sessionId, reason = '') {
  const settings = await loadSettings();
  const dsh = resolveDshSelection(ctx, sessionId, reason);
  const stored = await describeKey(ctx, settings);
  const hasKey = keyConfigured(settings) || stored.configured;
  const custom = {
    ...settings.custom,
    protocol: 'openai-chat-completions',
    providerLabel: PROVIDERS[settings.custom.provider]?.label || '自定义 OpenAI 兼容服务',
    defaultBaseURL: PROVIDERS[settings.custom.provider]?.baseURL || '',
    hasKey,
    keySource: keyConfigured(settings) ? 'memory' : stored.configured ? 'host-store' : 'none',
    keyWritable: stored.writable !== false,
    keyIsolation: 'provider+base-url',
  };
  return {
    ok: true,
    plugin: { name: PLUGIN_ID, version: PLUGIN_VERSION },
    mode: settings.mode,
    dsh: {
      ...dsh,
      reasoningEffort: dsh.reasoningEffort || '',
    },
    custom,
    status: currentStatus(settings, dsh, hasKey),
    protocols: {
      supported: ['openai-chat-completions'],
      note: '当前只支持 OpenAI 兼容的 /chat/completions；Anthropic、Gemini 原生协议未实现。',
    },
    at: nowIso(),
  };
}

function validateProvider(value) {
  const provider = String(value || 'openai');
  if (!PROVIDERS[provider]) throw new HttpError(400, 'bad-request', '不支持的服务商');
  return provider;
}

function validateBaseURL(provider, value) {
  const text = String(value || '').trim();
  if (!text) {
    if (provider === 'custom') throw new HttpError(400, 'bad-request', '自定义服务商必须填写 API Base URL');
    return '';
  }
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
    return url.toString().replace(/\/+$/, '');
  } catch {
    throw new HttpError(400, 'bad-request', 'API Base URL 必须是 http/https URL');
  }
}

async function runAttempt(ctx, sessionId, reason, messages, settings) {
  if (settings.mode === 'custom') {
    const keyInfo = await effectiveKey(ctx, settings);
    if (!keyInfo.key) throw new HttpError(400, 'unconfigured', '当前服务商/地址未配置密钥，请重新填写');
    return callCustom(settings, keyInfo.key, {
      system: messages.system,
      user: messages.user,
      timeoutMs: 65000,
    });
  }
  const selection = resolveDshSelection(ctx, sessionId, reason);
  if (!selection.available) throw new HttpError(503, 'host-unavailable', selection.message || 'DSH 模型不可用');
  return streamDsh(ctx, selection, { system: messages.system, user: messages.user, timeoutMs: 65000 });
}

async function runSave(ctx, body) {
  const previous = await loadSettings();
  const mode = body.mode === 'custom' ? 'custom' : body.mode === 'dsh' ? 'dsh' : previous.mode;
  const provider = validateProvider(body.provider ?? previous.custom.provider);
  const baseURL = validateBaseURL(provider, body.baseURL ?? previous.custom.baseURL);
  const model = String(body.model ?? previous.custom.model ?? '').trim();
  if (mode === 'custom' && !model) throw new HttpError(400, 'bad-request', '自定义 API 必须填写模型名称');
  const rememberKey = body.rememberKey === true;
  const providedKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const newCustom = { provider, baseURL, model, rememberKey };
  const newSlot = keySlot({ custom: newCustom });

  // 只读取新 slot 的已保存密钥；旧服务商/旧地址的 key 不参与本轮保存。
  const existing = providedKey ? { key: '', source: 'none' } : await existingKeyForSlot(ctx, newCustom);
  const effective = providedKey || existing.key;

  if (rememberKey) {
    if (effective) {
      await storeKey(ctx, { custom: newCustom }, effective);
      memoryKeys.delete(newSlot);
    }
  } else {
    if (effective) memoryKeys.set(newSlot, effective);
    else memoryKeys.delete(newSlot);
    await deleteStoredKey(ctx, { custom: newCustom });
  }

  await saveSettings({ mode, custom: newCustom });
  testState = null;
  return settingsPayload(ctx, String(body.sessionId || ''), bindingReason(body.binding));
}

async function runClear(ctx, body) {
  memoryKeys.clear();
  await clearAllStoredKeys(ctx);
  await saveSettings(normalizeSettings({ mode: DEFAULT_MODE }));
  testState = null;
  return settingsPayload(ctx, String(body.sessionId || ''), bindingReason(body.binding));
}

async function runClearKey(ctx, body) {
  const settings = await loadSettings();
  memoryKeys.delete(keySlot(settings));
  await deleteStoredKey(ctx, settings);
  testState = null;
  return settingsPayload(ctx, String(body.sessionId || ''), bindingReason(body.binding));
}

async function runTest(ctx, body) {
  const sessionId = String(body.sessionId || '');
  const reason = bindingReason(body.binding);
  const settings = await loadSettings();
  const messages = {
    system: '你是连接测试助手。请严格按用户要求，只输出一句话，不要补充解释。',
    user: CUSTOM_TEST_PROMPT,
  };
  try {
    const result = await runAttempt(ctx, sessionId, reason, messages, settings);
    const text = String(result.text || '').trim();
    if (!text) throw new HttpError(502, 'empty', '模型返回空回答，测试未通过');
    const dsh = resolveDshSelection(ctx, sessionId, reason);
    const stored = await describeKey(ctx, settings);
    const hasKey = keyConfigured(settings) || stored.configured;
    const fingerprint = settings.mode === 'custom' ? customFingerprint(settings, hasKey) : dshFingerprint(dsh);
    const truncated = result.truncated === true;
    const finishReason = result.finishReason || result.finish || '';
    const message = `生成测试通过：${text.slice(0, 120)}${result.filtered ? '（内容被安全过滤：content_filter）' : truncated ? `（输出被截断：${finishReason || 'max-tokens'}）` : ''}`;
    testState = {
      status: 'success',
      at: Date.now(),
      message,
      provider: result.provider,
      model: result.model,
      source: settings.mode === 'custom' ? 'custom' : dsh.source,
      fingerprint,
    };
    return {
      ok: true,
      status: 'success',
      at: testState.at,
      message,
      answerPreview: text.slice(0, 200),
      provider: result.provider,
      model: result.model,
      source: testState.source,
      truncated,
      finishReason,
    };
  } catch (err) {
    const code = err?.code || 'upstream-failed';
    const status = code === 'unconfigured' ? 'unconfigured' : code === 'host-unavailable' ? 'host-unavailable' : code;
    const dsh = resolveDshSelection(ctx, sessionId, reason);
    const stored = await describeKey(ctx, settings);
    testState = {
      status,
      at: Date.now(),
      message: err?.message || '测试失败',
      provider: settings.mode === 'custom' ? settings.custom.provider : dsh.provider,
      model: settings.mode === 'custom' ? settings.custom.model : dsh.model,
      source: settings.mode === 'custom' ? 'custom' : dsh.source,
      fingerprint: settings.mode === 'custom'
        ? customFingerprint(settings, keyConfigured(settings) || stored.configured)
        : dshFingerprint(dsh),
    };
    return { ok: false, status, at: testState.at, message: testState.message, code, provider: testState.provider, model: testState.model, source: testState.source };
  }
}

async function runAsk(ctx, body) {
  const question = requireString(body.question, '问题', MAX_QUESTION_CHARS);
  const kind = body.kind === 'case' ? 'case' : body.kind === 'explain' ? 'explain' : 'qa';
  const messages = buildMessages({
    kind,
    question,
    itemTitle: body.itemTitle,
    chunks: body.chunks,
  });
  if (kind !== 'case' && messages.chunks.length === 0) {
    throw new HttpError(400, 'bad-request', '没有可用的原文片段，不能进行文献问答');
  }
  const sessionId = String(body.sessionId || '');
  const reason = bindingReason(body.binding);
  const settings = await loadSettings();
  const result = await runAttempt(ctx, sessionId, reason, messages, settings);
  const dsh = resolveDshSelection(ctx, sessionId, reason);
  const truncated = result.truncated === true;
  return {
    ok: true,
    answer: result.text,
    provider: result.provider,
    providerLabel: settings.mode === 'custom' ? (PROVIDERS[settings.custom.provider]?.label || '自定义 OpenAI 兼容服务') : 'DSH',
    model: result.model,
    source: settings.mode === 'custom' ? 'custom' : dsh.source,
    mode: settings.mode,
    kind,
    truncated,
    finishReason: result.finishReason || result.finish || '',
    notice: result.filtered
      ? '回答被内容安全过滤（content_filter），内容不完整。'
      : truncated
        ? `回答被截断（${result.finishReason || 'max-tokens'}），请缩短上下文或提高服务端输出上限。`
        : '',
    usage: result.usage || null,
    at: nowIso(),
  };
}

// ── 路由表：health 不 fence；其余全部走宿主 connection 鉴权 ─────────────────
const ROUTES = [
  { method: 'GET', path: `${ROUTE_PREFIX}/health`, fence: false, run: async () => ({ ok: true, plugin: PLUGIN_ID, version: PLUGIN_VERSION, features: { dsh: true, custom: true, sessionModel: true, secureKeyStore: true }, time: nowIso() }) },
  { method: 'GET', path: `${ROUTE_PREFIX}/worktable-info`, fence: true, run: async ({ ctx }) => {
    const { projectRoot, service, installation } = workbenchRuntime(ctx);
    const pageName = '医学研究工作台.html';
    const page = join(projectRoot, pageName);
    return {
      ok: true,
      version: PLUGIN_VERSION,
      projectRoot,
      installationSource: installation.source,
      pageName,
      pageExists: existsSync(page),
      pageUrl: `/api/worktable/site/${encodeURIComponent(projectRoot)}/${encodeURIComponent(pageName)}`,
      bridge: await service.bridgeStatus(),
    };
  } },
  { method: 'GET', path: `${ROUTE_PREFIX}/service/status`, fence: true, run: async ({ ctx }) => ({ ok: true, bridge: await workbenchRuntime(ctx).service.bridgeStatus() }) },
  { method: 'POST', path: `${ROUTE_PREFIX}/service/ensure`, fence: true, run: async ({ ctx }) => ({ ok: true, bridge: await workbenchRuntime(ctx).service.ensureBridge() }) },
  { method: 'GET', path: `${ROUTE_PREFIX}/settings`, fence: true, run: async ({ ctx, url }) => settingsPayload(ctx, url.searchParams.get('sessionId') || '', bindingReason(url.searchParams.get('binding'))) },
  { method: 'POST', path: `${ROUTE_PREFIX}/save`, fence: true, run: async ({ ctx, body }) => runSave(ctx, body) },
  { method: 'POST', path: `${ROUTE_PREFIX}/test`, fence: true, run: async ({ ctx, body }) => runTest(ctx, body) },
  { method: 'POST', path: `${ROUTE_PREFIX}/ask`, fence: true, run: async ({ ctx, body }) => runAsk(ctx, body) },
  { method: 'POST', path: `${ROUTE_PREFIX}/clear`, fence: true, run: async ({ ctx, body }) => runClear(ctx, body) },
  { method: 'POST', path: `${ROUTE_PREFIX}/clear-key`, fence: true, run: async ({ ctx, body }) => runClearKey(ctx, body) },
];

function createHandler(ctx, fence, route) {
  return async function handler(req, res) {
    const method = String(req?.method || 'GET').toUpperCase();
    const url = new URL(req?.url || '/', 'http://127.0.0.1');
    if (route.fence && !fence(req)) {
      json(res, 403, { error: { code: 'forbidden', message: '未授权访问' } });
      return;
    }
    if (method !== route.method) {
      methodNotAllowed(res, route.method);
      return;
    }
    try {
      const body = route.method === 'GET' ? {} : await readJsonBody(req, MAX_BODY_BYTES);
      if (body.sessionId !== undefined && (typeof body.sessionId !== 'string' || body.sessionId.length > 200)) {
        throw new HttpError(400, 'bad-request', 'sessionId 不合法');
      }
      if (body.binding !== undefined && !['unique', 'none', 'ambiguous', ''].includes(body.binding)) {
        throw new HttpError(400, 'bad-request', 'binding 不合法');
      }
      const payload = await route.run({ req, res, body, ctx, url });
      if (!res.writableEnded) json(res, 200, payload);
    } catch (err) {
      if (err instanceof HttpError) {
        sendError(res, err, ctx.logger);
        return;
      }
      const code = err?.code || 'upstream-failed';
      const status = err?.status || errorStatusFor(code);
      sendError(res, new HttpError(status, code, err?.message || '模型调用失败'), ctx.logger);
    }
  };
}

export function apply(ctx) {
  const webServer = getService(ctx, 'webServer');
  if (!webServer || typeof webServer.register !== 'function') {
    try {
      ctx.logger?.warn?.('[medresearch-model] webServer 不可用，跳过模型路由注册');
    } catch {
      /* ignore */
    }
    return;
  }
  const fence = makeFence(ctx);
  for (const route of ROUTES) {
    const handler = createHandler(ctx, fence, route);
    const register = () => webServer.register({ kind: 'exact', path: route.path, handler });
    if (typeof ctx.effect === 'function') ctx.effect(register, `medresearch-model: ${route.path}`);
    else register();
  }
}

export const __internals = { runSave, runClear, runClearKey, runTest, runAsk, settingsPayload, resolveDshSelection, workbenchRuntime };

