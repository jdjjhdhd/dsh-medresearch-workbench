import { PROVIDERS, REQUEST_TIMEOUT_MS } from './constants.js';
import { getService } from './http.js';

export class ModelCallError extends Error {
  constructor(code, message, status = 502, extra) {
    super(message);
    this.name = 'ModelCallError';
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

export function dshUnavailable() {
  return new ModelCallError('host-unavailable', '宿主模型接口不可用（ctx.llm / agentDefaultModel 未注册）', 503);
}

export function resolveDshSelection(ctx, sessionId, reason = '') {
  const sessions = getService(ctx, 'sessions');
  const projections = getService(ctx, 'sessionProjections');
  const binding = reason === 'ambiguous' || reason === 'none' ? reason : sessionId ? 'unique' : reason || 'none';
  const effectiveSessionId = binding === 'unique' ? sessionId : '';
  let session = null;
  let sessionMissing = false;
  if (effectiveSessionId) {
    try {
      session = sessions && typeof sessions.get === 'function' ? sessions.get(effectiveSessionId) : null;
    } catch {
      session = null;
    }
    sessionMissing = !session;
  }
  let projection = null;
  if (session && projections && typeof projections.stateOf === 'function') {
    try {
      projection = projections.stateOf(session, 'modelSelection');
    } catch {
      projection = null;
    }
  }
  const pending = projection && projection.pending ? projection.pending : null;
  const lastUsed = projection && projection.lastUsed ? projection.lastUsed : null;
  const chosen = pending || lastUsed;
  if (chosen && chosen.provider && chosen.model) {
    return {
      available: true,
      source: 'session',
      provider: String(chosen.provider),
      model: String(chosen.model),
      reasoningEffort: chosen.reasoningEffort ? String(chosen.reasoningEffort) : '',
      sessionId: effectiveSessionId,
      bindingReason: binding,
      label: `跟随当前会话 · ${chosen.provider} / ${chosen.model}`,
    };
  }
  const defaults = getService(ctx, 'agentDefaultModel');
  let fallback = null;
  try {
    fallback = defaults && typeof defaults.currentSelection === 'function' ? defaults.currentSelection() : null;
  } catch {
    fallback = null;
  }
  if (fallback && fallback.provider && fallback.model) {
    return {
      available: true,
      source: 'default',
      provider: String(fallback.provider),
      model: String(fallback.model),
      reasoningEffort: fallback.reasoningEffort ? String(fallback.reasoningEffort) : '',
      sessionId: effectiveSessionId,
      sessionMissing,
      bindingReason: binding,
      label: binding === 'ambiguous'
        ? '使用 DSH 默认模型（工作台存在多个匹配绑定，无法唯一确定）'
        : binding === 'none'
          ? '使用 DSH 默认模型（工作台未找到明确绑定）'
          : sessionMissing
            ? '使用 DSH 默认模型（绑定会话不可用）'
            : effectiveSessionId
              ? '使用 DSH 默认模型（当前会话无模型选择）'
              : '使用 DSH 默认模型',
    };
  }
  return {
    available: false,
    source: 'default',
    provider: '',
    model: '',
    reasoningEffort: '',
    sessionId: effectiveSessionId,
    sessionMissing,
    bindingReason: binding,
    label: binding === 'ambiguous'
      ? '使用 DSH 默认模型（工作台存在多个匹配绑定，无法唯一确定；且默认模型未配置）'
      : '使用 DSH 默认模型（未配置）',
    message: binding === 'ambiguous'
      ? '工作台存在多个匹配绑定，已回退默认模型；DSH 默认模型未配置'
      : sessionMissing
        ? '当前工作台绑定会话未运行，且 DSH 默认模型未配置'
        : 'DSH 默认模型未配置',
  };
}

function failureCode(failure) {
  const code = String(failure?.code || '').toUpperCase();
  if (code === 'AUTH' || code === 'INVALID_CREDENTIAL' || failure?.status === 401 || failure?.status === 403) return 'auth-failed';
  if (code === 'QUOTA' || code === 'ACCOUNT_QUOTA' || failure?.status === 402) return 'quota';
  if (code === 'RATE_LIMIT' || failure?.status === 429) return 'rate-limited';
  if (code.includes('MODEL') || failure?.status === 404) return 'model-not-found';
  if (code === 'CONTEXT_WINDOW_EXCEEDED') return 'context-too-large';
  if (code === 'EMPTY_RESPONSE') return 'empty';
  if (code === 'MISSING_CREDENTIAL' || code === 'NO_ADAPTER') return 'host-unavailable';
  return 'upstream-failed';
}

export async function streamDsh(ctx, selection, input) {
  if (!selection || !selection.available) throw dshUnavailable();
  const llm = getService(ctx, 'llm');
  if (!llm || typeof llm.stream !== 'function') throw dshUnavailable();

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      controller.abort();
    } catch {
      /* ignore */
    }
  }, Number(input?.timeoutMs) > 0 ? Number(input.timeoutMs) : REQUEST_TIMEOUT_MS);
  const outer = input?.signal;
  const onAbort = () => {
    try {
      controller.abort();
    } catch {
      /* ignore */
    }
  };
  if (outer) {
    if (outer.aborted) onAbort();
    else outer.addEventListener?.('abort', onAbort);
  }

  let text = '';
  let finish = null;
  let thrown = null;
  const usage = [];
  try {
    const options = {
      provider: selection.provider,
      model: selection.model,
      system: String(input?.system || ''),
      messages: [{ role: 'user', content: [{ type: 'text', text: String(input?.user || '') }] }],
      signal: controller.signal,
    };
    if (selection.reasoningEffort) options.reasoningEffort = selection.reasoningEffort;
    if (Number.isFinite(input?.maxTokens) && input.maxTokens > 0) options.maxTokens = input.maxTokens;
    for await (const chunk of llm.stream(options)) {
      if (chunk?.type === 'text-delta') text += chunk.text || '';
      else if (chunk?.type === 'usage') usage.push(chunk.usage);
      else if (chunk?.type === 'finish') finish = chunk.reason;
    }
  } catch (err) {
    thrown = err;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener?.('abort', onAbort);
  }

  if (thrown) {
    if (timedOut) throw new ModelCallError('timeout', 'DSH 模型响应超时', 504);
    const code = String(thrown?.code || '').toUpperCase();
    const mapped = failureCode({ code, status: thrown?.status });
    throw new ModelCallError(mapped, `DSH 模型调用失败：${thrown?.message || '未知错误'}`, 502, { failureCode: code });
  }
  if (finish?.kind === 'error') {
    if (timedOut) throw new ModelCallError('timeout', 'DSH 模型响应超时', 504);
    const mapped = failureCode(finish.failure);
    throw new ModelCallError(mapped, `DSH 模型调用失败：${finish.failure?.message || '未知错误'}`, 502, {
      failureCode: finish.failure?.code,
    });
  }
  if (finish?.kind === 'aborted') {
    if (timedOut) throw new ModelCallError('timeout', 'DSH 模型响应超时', 504);
    throw new ModelCallError('aborted', 'DSH 模型调用被中断', 499);
  }
  if (!text.trim()) throw new ModelCallError('empty', 'DSH 模型返回空回答', 502);
  const finishReason = finish?.kind || 'unknown';
  return {
    text: text.trim(),
    provider: selection.provider,
    model: selection.model,
    usage,
    finish: finishReason,
    finishReason,
    truncated: finishReason === 'max-tokens',
  };
}

export function resolveChatURL(baseURL) {
  const raw = String(baseURL || '').trim().replace(/\/+$/, '');
  if (!raw) throw new ModelCallError('bad-config', '请填写 API Base URL', 400);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ModelCallError('bad-config', 'API Base URL 不是合法 URL', 400);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ModelCallError('bad-config', 'API Base URL 只支持 http/https', 400);
  }
  if (/\/chat\/completions$/i.test(url.pathname)) return url.toString();
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`;
  return url.toString();
}

function customProviderLabel(provider) {
  return PROVIDERS[provider]?.label || '自定义 OpenAI 兼容服务';
}

function extractContent(json) {
  const choice = Array.isArray(json?.choices) ? json.choices[0] : null;
  const content = choice?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .filter(Boolean)
      .join('\n');
  }
  if (typeof choice?.text === 'string') return choice.text;
  return '';
}

export async function callCustom(settings, key, input) {
  const custom = settings?.custom || {};
  const provider = custom.provider || 'openai';
  const baseURL = custom.baseURL || PROVIDERS[provider]?.baseURL || '';
  const model = String(custom.model || '').trim();
  if (!key) throw new ModelCallError('unconfigured', '自定义 API 未配置密钥', 401);
  if (!model) throw new ModelCallError('bad-config', '请填写模型名称', 400);
  const url = resolveChatURL(baseURL);
  const controller = new AbortController();
  let timedOut = false;
  const timeoutMs = Number(input?.timeoutMs) > 0 ? Number(input.timeoutMs) : REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      controller.abort();
    } catch {
      /* ignore */
    }
  }, timeoutMs);
  let response;
  let text = '';
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: String(input?.system || '') },
          { role: 'user', content: String(input?.user || '') },
        ],
      }),
      signal: controller.signal,
    });
    text = await response.text();
  } catch (err) {
    clearTimeout(timer);
    if (timedOut || err?.name === 'AbortError') throw new ModelCallError('timeout', '自定义 API 请求超时', 504);
    throw new ModelCallError('network', `无法连接自定义 API：${err?.message || '网络错误'}`, 502);
  } finally {
    clearTimeout(timer);
  }

  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const apiMessage = String(json?.error?.message || json?.message || text.slice(0, 300) || '').split(key).join('[redacted]');
    const code = String(json?.error?.code || json?.error?.type || '').toUpperCase();
    if (response.status === 401 || response.status === 403) {
      throw new ModelCallError('auth-failed', `认证失败（HTTP ${response.status}）${apiMessage ? '：' + apiMessage : ''}`, 401);
    }
    if (response.status === 402 || /QUOTA|BALANCE|INSUFFICIENT|余额|额度/i.test(code + ' ' + apiMessage)) {
      throw new ModelCallError('quota', `余额或额度不足（HTTP ${response.status}）${apiMessage ? '：' + apiMessage : ''}`, 402);
    }
    if (response.status === 429) {
      throw new ModelCallError('rate-limited', `请求被限流（HTTP 429）${apiMessage ? '：' + apiMessage : ''}`, 429);
    }
    if (response.status === 404 || /MODEL.*(NOT|INVALID)|NO_SUCH_MODEL/i.test(code + ' ' + apiMessage)) {
      throw new ModelCallError('model-not-found', `模型不存在（HTTP ${response.status}）${apiMessage ? '：' + apiMessage : ''}`, 404);
    }
    if (response.status === 400 && /MODEL|模型/i.test(apiMessage)) {
      throw new ModelCallError('model-not-found', `模型不可用（HTTP 400）${apiMessage ? '：' + apiMessage : ''}`, 404);
    }
    if (response.status >= 500) {
      throw new ModelCallError('network', `自定义 API 服务器错误（HTTP ${response.status}）${apiMessage ? '：' + apiMessage : ''}`, 502);
    }
    throw new ModelCallError('upstream-failed', `自定义 API 返回 HTTP ${response.status}${apiMessage ? '：' + apiMessage : ''}`, 502);
  }
  const choice = Array.isArray(json?.choices) ? json.choices[0] : null;
  const finishReason = String(choice?.finish_reason || choice?.finishReason || 'unknown');
  const truncated = finishReason === 'length' || finishReason === 'max_tokens';
  const filtered = finishReason === 'content_filter';
  const answer = extractContent(json).trim();
  if (!answer) {
    if (filtered) throw new ModelCallError('filtered', '自定义 API 内容被安全过滤（finish_reason=content_filter），没有可用回答', 422);
    throw new ModelCallError('empty', `自定义 API 返回空回答（finish_reason=${finishReason}；HTTP 200 不代表生成通过）`, 502);
  }
  return {
    text: answer,
    provider,
    providerLabel: customProviderLabel(provider),
    model,
    usage: json?.usage || null,
    finish: finishReason,
    finishReason,
    truncated: truncated || filtered,
    filtered,
  };
}

export function errorStatusFor(code) {
  const map = {
    'auth-failed': 401,
    quota: 402,
    'rate-limited': 429,
    'model-not-found': 404,
    'bad-config': 400,
    unconfigured: 400,
    filtered: 422,
    'host-unavailable': 503,
    timeout: 504,
    network: 502,
    empty: 502,
    aborted: 499,
  };
  return map[code] || 502;
}

