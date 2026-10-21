export class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function getService(ctx, name) {
  if (!ctx) return undefined;
  try {
    if (typeof ctx.get === 'function') {
      const viaGet = ctx.get(name);
      if (viaGet !== undefined && viaGet !== null) return viaGet;
    }
  } catch {
    /* 服务未注册时回退属性访问 */
  }
  return ctx[name];
}

export function makeFence(ctx) {
  return function fence(req) {
    const connection = getService(ctx, 'connection');
    if (!connection || typeof connection.requestRejection !== 'function') return false;
    try {
      return connection.requestRejection(req) === undefined;
    } catch {
      return false;
    }
  };
}

export function json(res, status, body) {
  if (res.writableEnded) return;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

export function methodNotAllowed(res, allow) {
  if (res.writableEnded) return;
  res.writeHead(405, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    allow,
  });
  res.end(JSON.stringify({ error: { code: 'method-not-allowed', message: `仅支持 ${allow}` } }));
}

export async function readJsonBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buf.length;
    if (total > maxBytes) throw new HttpError(400, 'bad-request', `请求体超过 ${maxBytes} 字节上限`);
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '');
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new HttpError(400, 'bad-json', '请求体必须是 JSON 对象');
    }
    return parsed;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, 'bad-json', '请求体不是合法 JSON');
  }
}

export function sendError(res, err, logger) {
  if (res.writableEnded) return;
  if (err instanceof HttpError) {
    const body = { error: { code: err.code, message: err.message } };
    if (err.extra && typeof err.extra === 'object') {
      for (const [key, value] of Object.entries(err.extra)) {
        if (key !== 'error' && value !== undefined) body[key] = value;
      }
    }
    json(res, err.status, body);
    return;
  }
  try {
    logger?.warn?.(`[medresearch-model] internal error: ${err?.stack ?? String(err)}`);
  } catch {
    /* ignore */
  }
  json(res, 500, { error: { code: 'internal', message: '内部错误' } });
}

export function requireString(value, field, max) {
  if (typeof value !== 'string') throw new HttpError(400, 'bad-request', `${field} 必须是字符串`);
  const text = value.trim();
  if (!text) throw new HttpError(400, 'bad-request', `${field} 不能为空`);
  if (text.length > max) throw new HttpError(400, 'bad-request', `${field} 超过 ${max} 字符上限`);
  return text;
}
