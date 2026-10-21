import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../plugin/lib/client.js', import.meta.url), 'utf8');
const PROJECTS = 'dsh.worktable.projects.v1';
const WIDGETS = 'dsh.worktable.widgetBindings.v2';
const GUARD = 'dsh.medresearch.worktableInit.v1';
const ROOT = 'D:/customer/medical';
const MOVED = 'E:/moved/medical';
const PAGE = '医学研究工作台.html';
const pageUrl = (root) => `/api/worktable/site/${encodeURIComponent(root)}/${encodeURIComponent(PAGE)}`;
const get = (state, key) => JSON.parse(state.values.get(key));
const put = (state, key, value) => state.values.set(key, JSON.stringify(value));

function state() {
  return { values: new Map(), writes: [], sessionCalls: [], workspaceCalls: [],
    byId: {}, workspaces: new Map(), counter: 0, reloads: 0, banners: [] };
}

function projectState(layouts = []) {
  return { order: layouts.map((layout) => layout.id), lastUsed: {}, hidden: [], removed: [],
    nameOverrides: {}, iconOverrides: {}, views: {}, shortcuts: [], layouts,
    bindings: {}, folders: {} };
}

async function run(s, options = {}) {
  const root = options.root || ROOT;
  const elements = new Map();
  const element = () => ({ style: {}, children: [], appendChild(child) { this.children.push(child); },
    remove() { elements.delete(this.id); } });
  const body = element();
  body.appendChild = (child) => {
    elements.set(child.id, child);
    s.banners.push(child.children.map((entry) => entry.textContent || '').join(''));
  };
  const sessions = {
    list: { getSnapshot: () => ({ byId: options.unknownCwd ? {} : s.byId }) },
    create: async (input) => {
      s.sessionCalls.push(structuredClone(input));
      if (options.failSession) throw new Error('test session unavailable');
      if (options.onCreate) await options.onCreate(s, input);
      const id = `session-${++s.counter}`;
      s.byId[id] = { id, cwd: options.wrongCreatedCwd || input.cwd || s.workspaces.get(input.workspaceId) };
      return id;
    }
  };
  const workspaces = { create: async (input) => {
    s.workspaceCalls.push(structuredClone(input));
    const workspaceId = `workspace-${++s.counter}`;
    s.workspaces.set(workspaceId, input.path);
    return { workspaceId, path: input.path };
  } };
  let plugin;
  const context = {
    console,
    localStorage: {
      getItem: (key) => s.values.get(key) ?? null,
      setItem: (key, value) => { s.writes.push(key); s.values.set(key, value); }
    },
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++s.counter).padStart(12, '0')}` },
    fetch: async (url) => {
      if (url.endsWith('/worktable-info') && options.infoError) return { ok: false, status: 503,
        json: async () => ({ error: { message: options.infoError } }) };
      if (url.endsWith('/worktable-info')) return { ok: true, status: 200, json: async () => ({
        ok: true, projectRoot: root, pageName: PAGE, pageExists: true, version: '0.2.0'
      }) };
      if (url.endsWith('/service/ensure')) return { ok: true, status: 200, json: async () => ({ bridge: { online: true } }) };
      throw new Error(`Unexpected request: ${url}`);
    },
    document: { body, documentElement: {}, getElementById: (id) => elements.get(id),
      createElement: element, addEventListener() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)), clearTimeout,
    __dshWorktable: options.worktable === false ? undefined : {},
    location: { reload: () => { s.reloads++; } },
    __ModuleLoader__: { load: ({ id, factory }) => {
      assert.equal(id, 'dsh-medresearch-model');
      plugin = factory();
    } }
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'client.js' });
  assert.deepEqual(Array.from(plugin.inject), ['sessions', 'workspaces']);
  await plugin.apply({ sessions, workspaces });
}

function resetWrites(s) { s.writes.length = 0; s.banners.length = 0; }

test('installation errors preserve the host repair instruction without creating a project', async () => {
  const s = state();
  await run(s, { infoError: '安装登记已过期，请在完整客户目录执行安装脚本以登记位置。' });
  assert.match(s.banners.join(' '), /安装登记已过期.*完整客户目录/);
  assert.equal(s.writes.length, 0);
  assert.equal(s.sessionCalls.length, 0);
});

test('creates a separately owned project without claiming same-name or same-folder customer projects', async () => {
  const s = state();
  const customer = { id: 'layout-customer', title: '医学文献与证据工作台', main: [{
    id: 'custom', content: { kind: 'terminal' }, active: 1,
    tabs: [{ id: 'browser', content: { kind: 'iframe', url: 'https://customer.invalid' } }]
  }] };
  const p = projectState([customer]);
  p.folders[customer.id] = ROOT;
  p.bindings[customer.id] = 'customer-session';
  put(s, PROJECTS, p);
  await run(s);
  const result = get(s, PROJECTS);
  assert.deepEqual(result.layouts[0], customer);
  assert.equal(result.folders[customer.id], ROOT);
  assert.equal(result.bindings[customer.id], 'customer-session');
  assert.equal(result.layouts.length, 2);
  assert.match(get(s, GUARD).layoutId, /^layout-medresearch-/);
  assert.equal(s.sessionCalls.length, 1);
  assert.equal(s.reloads, 1);
});

test('repeat startup performs no storage writes and preserves renamed, hidden, removed and edited panes', async () => {
  const s = state();
  await run(s);
  const p = get(s, PROJECTS);
  const id = get(s, GUARD).layoutId;
  const layout = p.layouts.find((entry) => entry.id === id);
  layout.title = 'Customer renamed';
  layout.main[0].content = { kind: 'terminal', cwd: 'D:/customer/other' };
  layout.main[0].tabs.push({ id: 'extra', title: 'Customer tab', content: { kind: 'iframe', url: 'https://customer.invalid' } });
  layout.main[0].active = 1;
  p.hidden.push(id);
  p.removed.push(id);
  p.nameOverrides[id] = 'A custom name';
  put(s, PROJECTS, p);
  const widgets = get(s, WIDGETS);
  widgets[id].p1.enabled = false;
  put(s, WIDGETS, widgets);
  const before = new Map(s.values);
  resetWrites(s);
  await run(s);
  assert.deepEqual(s.writes, []);
  assert.deepEqual(s.values, before);
  assert.equal(s.sessionCalls.length, 1);
  assert.equal(s.reloads, 1);
});

test('a missing ownership guard never claims even an existing specially prefixed project', async () => {
  const s = state();
  await run(s);
  const original = get(s, PROJECTS).layouts[0];
  s.values.delete(GUARD);
  resetWrites(s);
  await run(s);
  assert.equal(get(s, PROJECTS).layouts.length, 2);
  assert.deepEqual(get(s, PROJECTS).layouts[0], original);
  assert.notEqual(get(s, GUARD).layoutId, original.id);
});

test('a partial ownership guard cannot claim a prefixed customer layout', async () => {
  const s = state();
  await run(s);
  const original = get(s, PROJECTS).layouts[0];
  put(s, GUARD, { version: 2, owner: 'dsh-medresearch-model', layoutId: original.id });
  await run(s);
  assert.equal(get(s, PROJECTS).layouts.length, 2);
  assert.deepEqual(get(s, PROJECTS).layouts[0], original);
});

test('moving the directory changes only the owned iframe and binding and preserves the old session', async () => {
  const s = state();
  await run(s);
  const oldGuard = get(s, GUARD);
  const p = get(s, PROJECTS);
  const pane = p.layouts[0].main[0];
  pane.content = { kind: 'terminal' };
  pane.title = 'Customer window';
  pane.tabs.unshift({ id: 'customer-first', content: { kind: 'iframe', url: 'https://customer.invalid' } });
  pane.active = 0;
  pane.tabs[1].title = 'Customer renamed tab';
  put(s, PROJECTS, p);
  const widgets = get(s, WIDGETS);
  widgets[oldGuard.layoutId].p1.enabled = false;
  put(s, WIDGETS, widgets);
  resetWrites(s);
  await run(s, { root: MOVED });
  const result = get(s, PROJECTS);
  const updated = result.layouts[0].main[0];
  assert.equal(result.layouts.length, 1);
  assert.equal(updated.tabs[0].content.url, 'https://customer.invalid');
  assert.equal(updated.tabs[1].content.url, pageUrl(MOVED));
  assert.equal(updated.tabs[1].title, 'Customer renamed tab');
  assert.equal(updated.title, 'Customer window');
  assert.equal(updated.active, 0);
  assert.deepEqual(updated.content, { kind: 'terminal' });
  assert.equal(result.folders[oldGuard.layoutId], MOVED);
  assert.notEqual(result.bindings[oldGuard.layoutId], oldGuard.sessionId);
  assert.equal(s.byId[oldGuard.sessionId].cwd, ROOT);
  assert.equal(s.byId[result.bindings[oldGuard.layoutId]].cwd, MOVED);
  assert.deepEqual(get(s, GUARD).previousSessionIds, [oldGuard.sessionId]);
  assert.equal(get(s, WIDGETS)[oldGuard.layoutId].p1.enabled, false);
  assert.equal(get(s, WIDGETS)[oldGuard.layoutId].p1.sessionId, result.bindings[oldGuard.layoutId]);
  resetWrites(s);
  await run(s, { root: MOVED });
  assert.deepEqual(s.writes, []);
  assert.equal(s.sessionCalls.length, 2);
});

test('moving preserves a user-replaced tab instead of rewriting or restoring it', async () => {
  const s = state();
  await run(s);
  const p = get(s, PROJECTS);
  p.layouts[0].main[0].tabs[0].content = { kind: 'iframe', url: 'https://customer.invalid/replacement' };
  put(s, PROJECTS, p);
  await run(s, { root: MOVED });
  assert.equal(get(s, PROJECTS).layouts[0].main[0].tabs[0].content.url, 'https://customer.invalid/replacement');
});

test('moving reuses a bound session only when its actual SDK snapshot cwd is already correct', async () => {
  const s = state();
  await run(s);
  const sid = get(s, GUARD).sessionId;
  s.byId[sid].cwd = MOVED;
  await run(s, { root: MOVED });
  assert.equal(s.sessionCalls.length, 1);
  assert.equal(get(s, GUARD).sessionId, sid);
});

test('an unavailable cwd snapshot creates a new session only at a directory move', async () => {
  const s = state();
  await run(s);
  await run(s, { unknownCwd: true });
  assert.equal(s.sessionCalls.length, 1);
  await run(s, { root: MOVED, unknownCwd: true });
  assert.equal(s.sessionCalls.length, 2);
  resetWrites(s);
  await run(s, { root: MOVED, unknownCwd: true });
  assert.equal(s.sessionCalls.length, 2);
  assert.deepEqual(s.writes, []);
});

test('failed move keeps the existing layout, binding and session and reports the failure', async () => {
  const s = state();
  await run(s);
  const before = new Map(s.values);
  resetWrites(s);
  await run(s, { root: MOVED, failSession: true });
  assert.deepEqual(s.writes, []);
  assert.deepEqual(s.values, before);
  assert.ok(s.banners.some((message) => message.includes('目录迁移未完成')));
});

test('an existing mismatched session cwd is visible without silently replacing a customer binding', async () => {
  const s = state();
  await run(s);
  s.byId[get(s, GUARD).sessionId].cwd = 'D:/customer/elsewhere';
  const before = new Map(s.values);
  resetWrites(s);
  await run(s);
  assert.deepEqual(s.values, before);
  assert.deepEqual(s.writes, []);
  assert.equal(s.sessionCalls.length, 1);
  assert.ok(s.banners.some((message) => message.includes('目录不一致')));
});

test('moving does not overwrite a project folder changed while awaiting the new session', async () => {
  const s = state();
  await run(s);
  const oldGuard = s.values.get(GUARD);
  const id = get(s, GUARD).layoutId;
  resetWrites(s);
  await run(s, { root: MOVED, onCreate: async () => {
    const p = get(s, PROJECTS);
    p.folders[id] = 'D:/customer/new-choice';
    put(s, PROJECTS, p);
  } });
  assert.deepEqual(s.writes, []);
  assert.equal(get(s, PROJECTS).folders[id], 'D:/customer/new-choice');
  assert.equal(s.values.get(GUARD), oldGuard);
  assert.ok(s.banners.some((message) => message.includes('目录已由用户修改')));
});

function legacyState() {
  const s = state();
  const layoutId = 'layout-00000000-0000-4000-8000-000000000001';
  const url = pageUrl(ROOT);
  const layout = { id: layoutId, title: 'Customer renamed legacy', main: [{ id: 'p1', active: 0,
    content: null, tabs: [{ id: 'tab-old', title: PAGE, content: { kind: 'iframe', url } }] }] };
  const p = projectState([layout]);
  p.folders[layoutId] = ROOT;
  p.bindings[layoutId] = 'legacy-session';
  s.byId['legacy-session'] = { cwd: ROOT };
  put(s, PROJECTS, p);
  put(s, WIDGETS, { [layoutId]: { p1: { projectId: layoutId, paneId: 'p1', folder: ROOT,
    sessionId: 'legacy-session', bindingId: 'binding-old', enabled: false } } });
  put(s, GUARD, { version: 1, layoutId, folder: ROOT, pageUrl: url, sessionId: 'legacy-session',
    signature: ['0.2.0', ROOT.toLowerCase(), url, layoutId, 'legacy-session'].join('|'), at: 1 });
  return s;
}

test('migrates a complete 0.2.0 guard and binding chain without writing customer layout or visibility', async () => {
  const s = legacyState();
  const oldProjects = s.values.get(PROJECTS);
  const oldWidgets = s.values.get(WIDGETS);
  await run(s);
  assert.deepEqual(s.writes, [GUARD]);
  assert.equal(s.values.get(PROJECTS), oldProjects);
  assert.equal(s.values.get(WIDGETS), oldWidgets);
  assert.equal(get(s, GUARD).legacy, true);
  assert.equal(get(s, GUARD).version, 2);
  assert.equal(s.sessionCalls.length, 0);
  resetWrites(s);
  await run(s);
  assert.deepEqual(s.writes, []);
});

test('an incomplete legacy chain is preserved and a separate owned project is created', async () => {
  const s = legacyState();
  const widgets = get(s, WIDGETS);
  widgets[get(s, GUARD).layoutId].p1.folder = 'D:/different';
  put(s, WIDGETS, widgets);
  const oldLayout = get(s, PROJECTS).layouts[0];
  await run(s);
  assert.equal(get(s, PROJECTS).layouts.length, 2);
  assert.deepEqual(get(s, PROJECTS).layouts[0], oldLayout);
  assert.deepEqual(get(s, WIDGETS)[oldLayout.id], widgets[oldLayout.id]);
});

test('does not recreate an owned project that the customer removed', async () => {
  const s = state();
  await run(s);
  const p = get(s, PROJECTS);
  p.layouts = [];
  put(s, PROJECTS, p);
  resetWrites(s);
  await run(s);
  assert.deepEqual(s.writes, []);
  assert.equal(s.sessionCalls.length, 1);
  assert.ok(s.banners.some((message) => message.includes('已被移除')));
});

test('preserves unrelated projects created during the asynchronous session request', async () => {
  const s = state();
  await run(s, { onCreate: async () => {
    const p = projectState([{ id: 'layout-during-await', title: 'A customer project', main: [] }]);
    put(s, PROJECTS, p);
  } });
  assert.equal(get(s, PROJECTS).layouts.length, 2);
  assert.equal(get(s, PROJECTS).layouts[0].id, 'layout-during-await');
});

test('corrupt worktable state is not overwritten', async () => {
  const s = state();
  s.values.set(PROJECTS, '{broken');
  await run(s);
  assert.deepEqual(s.writes, []);
  assert.equal(s.values.get(PROJECTS), '{broken');
  assert.ok(s.banners.some((message) => message.includes('无法解析')));
});

test('does not initialize projects while worktable is absent', async () => {
  const s = state();
  await run(s, { worktable: false });
  assert.deepEqual(s.writes, []);
  assert.equal(s.sessionCalls.length, 0);
  assert.ok(s.banners.some((message) => message.includes('缺少 dsh-worktable')));
});
