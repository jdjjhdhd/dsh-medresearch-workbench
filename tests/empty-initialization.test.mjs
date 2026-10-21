import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const core = fs.readFileSync(new URL('../src/core.js', import.meta.url), 'utf8');
const views = fs.readFileSync(new URL('../src/views.js', import.meta.url), 'utf8');
const collections = ['items', 'topics', 'notes', 'tasks', 'cases', 'searches'];
const plain = (value) => JSON.parse(JSON.stringify(value));

function viewFunction(name) {
  const start = views.search(new RegExp(`^  function ${name}\\(`, 'm'));
  assert.notEqual(start, -1, name);
  const rest = views.slice(start);
  const next = rest.slice(3).search(/\n  (?:async )?function /);
  return next < 0 ? rest : rest.slice(0, next + 3);
}

function harness({ online = false } = {}) {
  const memory = new Map();
  const saves = [];
  const element = { addEventListener() {}, style: {}, classList: { add() {}, remove() {}, toggle() {} } };
  const context = {
    location: { pathname: `/api/worktable/site/${encodeURIComponent('D:/empty-init-test')}/workbench.html` },
    document: { querySelector: () => element, querySelectorAll: () => [], addEventListener() {},
      documentElement: { style: { setProperty() {} } } },
    localStorage: { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) },
    addEventListener() {}, confirm: () => true, URL, AbortController,
    setTimeout() { throw new Error('Unexpected timer in initialization test'); }, clearTimeout() {},
    fetch() { throw new Error('Network access is forbidden in initialization tests'); }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(core, context, { filename: 'src/core.js' });
  vm.runInContext([viewFunction('demoCount'), viewFunction('clearDemoData')].join('\n'), context);
  context.renderHead = context.render = context.toast = context.updateSaveBanner = context.applyFontSize = () => {};
  context.probeBridge = async () => { context.APP.bridge.online = online; return online; };
  context.ensureLocalService = async () => null;
  context.fetchJsonNice = async (url) => {
    const data = url.startsWith('/api/worktable/file?') ? context.worktableData
      : url.endsWith('/data/load') ? context.bridgeData : undefined;
    return data ? { ok: true, status: 200, json: plain(data) } : { ok: false, status: 404, json: null };
  };
  const save = (reason) => {
    const data = plain(context.APP.data);
    saves.push({ reason, data });
    memory.set(context.projectStorageKey(context.LS_KEY), JSON.stringify(data));
    return Promise.resolve(true);
  };
  context.saveNow = save;
  context.markDirty = (options) => save(options?.immediate ? 'immediate' : 'deferred');
  return { context, memory, saves };
}

function persistedFixture(context) {
  const data = context.seedData();
  data.updatedAt = 10;
  data.topics.push({ id: 'persisted-topic', name: 'Persisted topic', kind: 'direction', demo: false });
  data.items.push({ id: 'persisted-item', title: 'Persisted paper', topicIds: ['persisted-topic'], demo: false });
  data.notes.push({ id: 'persisted-note', body: 'Persisted test note', itemId: 'persisted-item', demo: false });
  data.tasks.push({ id: 'persisted-task', title: 'Persisted task', subjectType: 'item', subjectId: 'persisted-item', demo: false });
  data.cases.push({ id: 'persisted-case', title: 'Synthetic saved record', itemIds: ['persisted-item'], demo: false });
  data.searches.push({ id: 'persisted-search', q: 'saved-query', count: 1, at: 1 });
  return plain(context.normalizeState(data));
}

for (const online of [false, true]) {
  test(`first startup with no saved data stays empty (bridge ${online ? 'online' : 'offline'})`, async () => {
    const h = harness({ online });
    h.context.seedData = () => { throw new Error('First startup must not load demo records'); };
    await h.context.bootData();
    assert.equal(h.context.APP.source, 'new');
    for (const collection of collections) assert.deepEqual(plain(h.context.APP.data[collection]), []);
    assert.equal(h.saves.length, 1);
    assert.equal(h.saves[0].reason, 'immediate');
    for (const collection of collections) assert.deepEqual(h.saves[0].data[collection], []);
  });
}

for (const storage of ['local', 'worktable', 'bridge']) {
  test(`existing ${storage} data keeps both demo and non-demo records and associations`, async () => {
    const h = harness({ online: storage === 'bridge' });
    const existing = persistedFixture(h.context);
    if (storage === 'local') h.memory.set(h.context.projectStorageKey(h.context.LS_KEY), JSON.stringify(existing));
    if (storage === 'worktable') h.context.worktableData = existing;
    if (storage === 'bridge') h.context.bridgeData = existing;
    h.context.seedData = () => { throw new Error('Saved data must not be replaced with demo records'); };
    await h.context.bootData();
    assert.equal(h.context.APP.source, storage);
    assert.deepEqual(plain(h.context.APP.data), existing);
    for (const collection of ['items', 'topics', 'notes', 'tasks', 'cases']) {
      assert.ok(h.context.APP.data[collection].some((entry) => entry.demo));
      assert.ok(h.context.APP.data[collection].some((entry) => !entry.demo));
    }
    assert.equal(h.context.APP.data.notes.find((note) => note.id === 'persisted-note').itemId, 'persisted-item');
  });
}

test('a newer saved empty library is retained instead of filling it from older demo data', async () => {
  const h = harness({ online: true });
  h.context.bridgeData = persistedFixture(h.context);
  const empty = plain(h.context.emptyState());
  empty.updatedAt = h.context.bridgeData.updatedAt + 100;
  h.memory.set(h.context.projectStorageKey(h.context.LS_KEY), JSON.stringify(empty));
  await h.context.bootData();
  assert.equal(h.context.APP.source, 'local');
  for (const collection of collections) assert.deepEqual(plain(h.context.APP.data[collection]), []);
  assert.equal(h.saves[0].reason, 'boot-sync');
});

test('demo removal remains explicit and preserves non-demo data after confirmation', async () => {
  const h = harness();
  const existing = persistedFixture(h.context);
  h.context.worktableData = existing;
  await h.context.bootData();
  assert.ok(h.context.demoCount() > 0);
  const before = plain(h.context.APP.data);
  h.context.confirm = () => false;
  h.context.clearDemoData();
  assert.deepEqual(plain(h.context.APP.data), before);
  h.context.confirm = () => true;
  h.context.clearDemoData();
  for (const collection of ['items', 'topics', 'notes', 'tasks', 'cases']) {
    assert.deepEqual(plain(h.context.APP.data[collection]), existing[collection].filter((entry) => !entry.demo));
  }
  assert.equal(h.context.demoCount(), 0);
  assert.equal(h.saves.length, 1);
});
