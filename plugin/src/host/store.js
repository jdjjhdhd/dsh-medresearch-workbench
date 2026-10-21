import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT_MODE, PROVIDERS, SETTINGS_VERSION } from './constants.js';
import { getService } from './http.js';

/** 旧版本的单密钥记录：只用于识别，不读取、不迁移，避免升级后静默沿用错平台密钥。 */
export const LEGACY_CREDENTIAL_KEY = 'medresearch-model/custom-api';
export const CREDENTIAL_SCOPE = 'medresearch-model';

export function dshHome() {
  const configured = String(process.env.DSH_HOME || '').trim();
  return configured || path.join(os.homedir(), '.dsh');
}

export function settingsPath() {
  return path.join(dshHome(), 'medresearch-model', 'settings.json');
}

function safeBaseURL(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function normalizeCustom(input) {
  const source = input && typeof input === 'object' ? input : {};
  const provider = ['openai', 'deepseek', 'custom'].includes(source.provider) ? source.provider : 'openai';
  return {
    provider,
    baseURL: safeBaseURL(source.baseURL),
    model: String(source.model || '').trim().slice(0, 160),
    protocol: 'openai-chat-completions',
    rememberKey: source.rememberKey === true,
  };
}

export function normalizeSettings(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    version: SETTINGS_VERSION,
    mode: source.mode === 'custom' ? 'custom' : DEFAULT_MODE,
    custom: normalizeCustom(source.custom),
    updatedAt: Number(source.updatedAt) || 0,
  };
}

export async function loadSettings() {
  try {
    const text = await fsp.readFile(settingsPath(), 'utf8');
    return normalizeSettings(JSON.parse(text));
  } catch {
    return normalizeSettings({});
  }
}

export async function saveSettings(settings) {
  const normalized = normalizeSettings({ ...settings, updatedAt: Date.now() });
  const dir = path.dirname(settingsPath());
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = `${settingsPath()}.tmp-${process.pid}`;
  await fsp.writeFile(tmp, JSON.stringify(normalized, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fsp.rename(tmp, settingsPath());
  try {
    fs.chmodSync(dir, 0o700);
    fs.chmodSync(settingsPath(), 0o600);
  } catch {
    /* Windows ACL 不受 chmod 影响；文件仍位于用户主目录 */
  }
  return normalized;
}

/** 服务商 + 规范化接口地址构成密钥隔离键；模型名不属于隔离键。 */
export function canonicalEndpoint(custom) {
  const provider = ['openai', 'deepseek', 'custom'].includes(custom?.provider) ? custom.provider : 'openai';
  const raw = String(custom?.baseURL || PROVIDERS[provider]?.baseURL || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function keySlot(settings) {
  const custom = settings?.custom || {};
  const provider = ['openai', 'deepseek', 'custom'].includes(custom.provider) ? custom.provider : 'openai';
  return `${provider}|${canonicalEndpoint({ ...custom, provider })}`;
}

export function slotRecordKey(slot) {
  const digest = crypto.createHash('sha256').update(String(slot)).digest('hex').slice(0, 24);
  return `${CREDENTIAL_SCOPE}/custom-${digest}`;
}

export async function loadKey(ctx, settings) {
  if (settings?.custom?.rememberKey !== false) {
    const credentials = getService(ctx, 'credentials');
    if (credentials && typeof credentials.readRecord === 'function') {
      try {
        const record = await credentials.readRecord(slotRecordKey(keySlot(settings)));
        if (record && record.kind === 'api-key' && typeof record.key === 'string' && record.key) {
          return { key: record.key, source: 'host-store' };
        }
      } catch {
        /* 读不到凭据库时回退内存 */
      }
    }
  }
  return { key: '', source: 'none' };
}

export async function describeKey(ctx, settings) {
  const credentials = getService(ctx, 'credentials');
  if (settings?.custom?.rememberKey !== false && credentials && typeof credentials.describeRecord === 'function') {
    try {
      const info = await credentials.describeRecord(slotRecordKey(keySlot(settings)));
      if (info && info.configured) return { configured: true, source: 'host-store', writable: info.writable !== false };
    } catch {
      /* ignore */
    }
  }
  return { configured: false, source: 'none', writable: true };
}

export async function storeKey(ctx, settings, key) {
  const credentials = getService(ctx, 'credentials');
  if (!credentials || typeof credentials.modifyRecord !== 'function') {
    throw new Error('宿主凭据库不可用，无法安全保存密钥');
  }
  await credentials.modifyRecord(slotRecordKey(keySlot(settings)), async () => ({ kind: 'api-key', key }));
}

export async function deleteStoredKey(ctx, settings) {
  const credentials = getService(ctx, 'credentials');
  if (credentials && typeof credentials.deleteRecord === 'function') {
    await credentials.deleteRecord(slotRecordKey(keySlot(settings)));
  }
}

/** 清除本插件拥有的全部密钥记录；不触碰其他插件凭据。 */
export async function clearAllStoredKeys(ctx) {
  const credentials = getService(ctx, 'credentials');
  if (!credentials) return;
  if (typeof credentials.listRecords === 'function' && typeof credentials.deleteRecord === 'function') {
    const records = await credentials.listRecords();
    for (const record of records) {
      const key = String(record?.key || record || '');
      if (key === LEGACY_CREDENTIAL_KEY || key.startsWith(`${CREDENTIAL_SCOPE}/`)) {
        await credentials.deleteRecord(key);
      }
    }
    return;
  }
  if (typeof credentials.deleteRecord === 'function') {
    await credentials.deleteRecord(LEGACY_CREDENTIAL_KEY);
  }
}
