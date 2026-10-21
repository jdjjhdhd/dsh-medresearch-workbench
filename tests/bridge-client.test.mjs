import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/core.js', import.meta.url), 'utf8');
const names = ['projectDir', 'normalizedProjectRoot', 'projectStorageKey', 'bridgeIdentityMatches', 'bridgeRequestPath', 'fetchJsonNice', 'apiErrorMessage', 'probeBridge', 'ensureLocalService', 'readLocalState', 'writeLocalState'];
function functionSource(name) {
  const marker = new RegExp(`^  (?:async )?function ${name}\\(`, 'm');
  const start = source.search(marker);
  assert.notEqual(start, -1, name);
  const rest = source.slice(start);
  const next = rest.slice(3).search(/\n  (?:async )?function /);
  return next < 0 ? rest : rest.slice(0, next + 3);
}
function harness(root = 'D:\\客户B') {
  const memory = new Map();
  const requests = [];
  const pathname = `/api/worktable/site/${encodeURIComponent(root)}/workbench.html`;
  const context = {
    location: { pathname, href: `dsh-app://app${pathname}` }, URL, AbortController, setTimeout, clearTimeout,
    APP: { bridge: { url: 'http://127.0.0.1:8765', online: false }, data: null },
    LS_KEY: 'dsh.medresearch.v1', LS_BRIDGE_KEY: 'dsh.medresearch.bridge',
    localStorage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) },
    safeJsonParse: text => { try { return JSON.parse(text); } catch { return null; } },
    normalizeState: value => value, renderHead() {}, toast() {},
    fetch: async (url, options) => {
      requests.push({ url, options });
      const value = context.response ?? { ok: true, service: 'medresearch-workbench-bridge', projectRoot: root };
      return { ok: context.httpStatus !== 403, status: context.httpStatus || 200, text: async () => JSON.stringify(value) };
    },
  };
  vm.createContext(context);
  vm.runInContext(names.map(functionSource).join('\n'), context);
  return { context, memory, requests, root };
}
function authorize(h) {
  h.context.APP.bridge.health = { ok: true, service: 'medresearch-workbench-bridge', projectRoot: h.root };
  h.context.APP.bridge.online = true;
  h.context.APP.bridge.verifiedUrl = h.context.APP.bridge.url;
}

test('wrong-project health is rejected even when ok=true', async () => {
  const h = harness();
  h.context.response = { ok: true, service: 'medresearch-workbench-bridge', projectRoot: 'D:\\客户A' };
  assert.equal(await h.context.probeBridge(), false);
  assert.equal(h.context.APP.bridge.online, false);
  assert.match(h.context.APP.bridge.error, /目录不匹配/);
});

test('health requires both a project root and the expected service identity', () => {
  const h = harness();
  assert.equal(h.context.bridgeIdentityMatches({ ok: true, service: 'medresearch-workbench-bridge' }), false);
  assert.equal(h.context.bridgeIdentityMatches({ ok: true, projectRoot: h.root, service: 'other' }), false);
  assert.equal(h.context.bridgeIdentityMatches({ ok: true, projectRoot: 'd:/客户B/./', service: 'medresearch-workbench-bridge' }), true);
});

test('upload/save/load/backup are blocked before fetch when the project is not verified', async () => {
  for (const route of ['/files/upload', '/data/save', '/data/load', '/data/backup']) {
    const h = harness();
    h.context.APP.bridge.online = true;
    await assert.rejects(h.context.fetchJsonNice(h.context.APP.bridge.url + route), /阻止跨项目/);
    assert.equal(h.requests.length, 0);
  }
});

test('changing the bridge address invalidates the previous verification', async () => {
  const h = harness(); authorize(h);
  h.context.APP.bridge.url = 'http://127.0.0.1:18765';
  await assert.rejects(h.context.fetchJsonNice(h.context.APP.bridge.url + '/data/load'), /阻止跨项目/);
  assert.equal(h.requests.length, 0);
});

test('verified requests send URI-encoded project identity and preserve JSON headers', async () => {
  const h = harness(); authorize(h);
  await h.context.fetchJsonNice(h.context.APP.bridge.url + '/files/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(h.requests[0].options.headers['x-medresearch-project-root'], encodeURIComponent(h.root));
  assert.equal(h.requests[0].options.headers['content-type'], 'application/json');
});

test('host same-origin APIs do not receive bridge identity headers or require a bridge', async () => {
  const h = harness();
  await h.context.fetchJsonNice('/api/medresearch/model/settings');
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].options.headers, undefined);
});

test('a server-side project rejection invalidates the bridge connection', async () => {
  const h = harness(); authorize(h);
  h.context.httpStatus = 403;
  h.context.response = { error: { message: '项目目录不一致' } };
  await h.context.fetchJsonNice(h.context.APP.bridge.url + '/data/load');
  assert.equal(h.context.APP.bridge.online, false);
  assert.equal(h.context.APP.bridge.verifiedUrl, '');
});

test('service discovery accepts a different local port only for the correct project', async () => {
  const h = harness();
  h.context.response = { bridge: { online: true, url: 'http://127.0.0.1:18765', health: { ok: true, service: 'medresearch-workbench-bridge', projectRoot: h.root } } };
  assert.ok(await h.context.ensureLocalService());
  assert.equal(h.context.APP.bridge.url, 'http://127.0.0.1:18765');
  assert.equal(h.context.APP.bridge.verifiedUrl, h.context.APP.bridge.url);
  h.context.response.bridge.health.projectRoot = 'D:\\Other';
  assert.equal(await h.context.ensureLocalService(), null);
  assert.equal(h.context.APP.bridge.online, false);
});

test('browser data and bridge preferences are scoped by project; legacy unowned cache is retained', () => {
  const h = harness();
  h.memory.set(h.context.LS_KEY, JSON.stringify({ version: 1, items: [{ id: 'other-project' }] }));
  assert.equal(h.context.readLocalState(), null);
  h.context.APP.data = { version: 1, items: [{ id: 'project-B' }] };
  h.context.writeLocalState();
  assert.equal(h.context.readLocalState().items[0].id, 'project-B');
  const keyB = h.context.projectStorageKey(h.context.LS_KEY);
  h.context.location.pathname = `/api/worktable/site/${encodeURIComponent('D:\\客户A')}/workbench.html`;
  assert.notEqual(h.context.projectStorageKey(h.context.LS_KEY), keyB);
  assert.equal(h.context.readLocalState(), null);
  assert.ok(h.memory.has(h.context.LS_KEY));
});

test('unresolved PDF path warnings are retained for the data settings view', async () => {
  const h = harness(); authorize(h);
  h.context.response = { version: 1, pathWarnings: [{ itemId: 'pdf-1', code: 'unverified-upload-origin', message: '旧 PDF 需要重新定位' }] };
  await h.context.fetchJsonNice(h.context.APP.bridge.url + '/data/load');
  assert.equal(h.context.APP.bridge.pathWarnings[0], '旧 PDF 需要重新定位');
});
