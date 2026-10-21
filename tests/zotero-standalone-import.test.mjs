import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const core = readFileSync(new URL('../src/core.js', import.meta.url), 'utf8');
const views = readFileSync(new URL('../src/views.js', import.meta.url), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));
const start = views.indexOf('  async function importZoteroItem(');
assert.ok(start >= 0);
const after = views.slice(start);
const next = after.slice(3).search(/\n  (?:async )?function /);
const importSource = next < 0 ? after : after.slice(0, next + 3);

function harness() {
  const calls = [], messages = [], timers = [];
  const element = { addEventListener() {}, style: {}, classList: { add() {}, remove() {}, toggle() {} } };
  const context = {
    location: { pathname: '/api/worktable/site/isolated-zotero-import/workbench.html' },
    document: { querySelector: () => element, querySelectorAll: () => [], addEventListener() {}, documentElement: { style: { setProperty() {} } } },
    localStorage: { getItem: () => null, setItem() {} },
    addEventListener() {}, URL, AbortController,
    setTimeout: (...args) => { timers.push(args); return timers.length; }, clearTimeout() {},
    fetch: () => { throw new Error('Real network requests are forbidden in Zotero import tests'); },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(core, context, { filename: 'src/core.js' });
  vm.runInContext(importSource, context, { filename: 'src/views.js:importZoteroItem' });
  context.APP.data = context.emptyState();
  context.APP.bridge.online = true;
  context.APP.bridge.url = 'http://isolated-zotero.invalid';
  context.toast = (message) => messages.push(message);
  context.markDirty = context.closeModal = context.render = () => {};
  let response;
  context.fetchJsonNice = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: { item: plain(response) } };
  };
  return { context, calls, messages, timers, setItem: (item) => { response = item; } };
}

function standalone(key = 'PDF00001', { contentType = 'application/pdf', filename = 'research.pdf' } = {}) {
  return { zoteroKey: key, zoteroRef: `zotero://user/0/item/${key}`, zoteroItemType: 'attachment', title: 'Isolated standalone research PDF',
    authors: [], tags: [], children: { attachments: [{ key, contentType, filename }],
      annotations: [{ key: 'ANN00001', page: '3', text: 'Important evidence', comment: 'Saved comment' }],
      notes: [{ key: 'NOTE0001', body: 'An imported note.' }] } };
}

test('old standalone attachment records recover their own key when PDF metadata is unavailable', () => {
  const { context } = harness();
  const item = context.normalizeItem({ id: 'saved-item', title: 'Old standalone PDF', zoteroItemType: 'attachment', zoteroKey: 'OLDPDF01' });
  assert.equal(item.attachmentKey, 'OLDPDF01');
  assert.equal(item.zoteroContentType, '');
  assert.equal(item.zoteroFilename, '');
  assert.equal(context.normalizeItem(plain(item)).attachmentKey, 'OLDPDF01');
});

test('known non-PDF self attachments do not recover or retain their own PDF key', () => {
  const { context } = harness();
  for (const metadata of [
    { zoteroContentType: 'text/html', zoteroFilename: 'snapshot.html' },
    { zoteroContentType: 'text/html', zoteroFilename: 'misleading.pdf' },
    { zoteroContentType: 'application/msword', zoteroFilename: 'document.doc' },
    { zoteroFilename: 'snapshot.html' },
  ]) {
    const item = context.normalizeItem({ title: 'Known non-PDF', zoteroItemType: 'attachment', zoteroKey: 'NOTPDF01', attachmentKey: 'NOTPDF01', ...metadata });
    assert.equal(item.attachmentKey, '', JSON.stringify(metadata));
    assert.equal(context.normalizeItem(plain(item)).attachmentKey, '');
  }
});

test('a local PDF path has priority over legacy fallback and explicit Zotero attachment keys', () => {
  const { context } = harness();
  for (const type of ['attachment', 'journalArticle']) {
    const item = context.normalizeItem({ title: 'Locally attached PDF', zoteroItemType: type, zoteroKey: 'LOCAL001',
      attachmentKey: 'LOCAL001', filePath: 'data/uploads/local.pdf', zoteroContentType: 'application/pdf' });
    assert.equal(item.filePath, 'data/uploads/local.pdf');
    assert.equal(item.attachmentKey, '');
    assert.equal(context.normalizeItem(plain(item)).attachmentKey, '');
  }
});

test('a standalone PDF imports its own key and metadata without duplicating the item, notes or annotations on reimport', async () => {
  const h = harness(), key = 'PDF00001';
  h.setItem(standalone(key));
  await h.context.importZoteroItem(key);
  assert.equal(h.context.APP.data.items.length, 1, h.messages.join('\n'));
  const first = h.context.APP.data.items[0], id = first.id;
  assert.equal(first.attachmentKey, key);
  assert.equal(first.zoteroContentType, 'application/pdf');
  assert.equal(first.zoteroFilename, 'research.pdf');
  assert.equal(first.annotations.length, 1);
  assert.equal(h.context.APP.data.notes.length, 1);
  await h.context.importZoteroItem(key);
  assert.equal(h.context.APP.data.items.length, 1);
  assert.equal(h.context.APP.data.items[0].id, id);
  assert.equal(h.context.APP.data.items[0].annotations.length, 1);
  assert.equal(h.context.APP.data.notes.length, 1);
  assert.equal(h.calls.length, 2);
  assert.equal(h.timers.length, 0);
});

test('reimporting known HTML metadata repairs an old guessed self key and preserves the new type across reload', async () => {
  const h = harness(), key = 'HTML0001';
  h.context.upsertItem({ id: 'old-snapshot', title: 'Old saved snapshot', zoteroItemType: 'attachment', zoteroKey: key });
  assert.equal(h.context.APP.data.items[0].attachmentKey, key);
  h.setItem(standalone(key, { contentType: 'text/html', filename: 'snapshot.html' }));
  await h.context.importZoteroItem(key);
  assert.equal(h.context.APP.data.items.length, 1);
  assert.equal(h.context.APP.data.items[0].attachmentKey, '');
  assert.equal(h.context.APP.data.items[0].zoteroContentType, 'text/html');
  h.context.APP.data = h.context.normalizeState(plain(h.context.APP.data));
  assert.equal(h.context.APP.data.items[0].attachmentKey, '');
  assert.equal(h.context.APP.data.items[0].zoteroFilename, 'snapshot.html');
});

test('reimporting a standalone item keeps its manually linked local PDF as the reading source', async () => {
  const h = harness(), key = 'LOCAL001';
  h.context.upsertItem({ id: 'locally-linked', title: 'Existing locally linked paper', zoteroItemType: 'attachment', zoteroKey: key,
    filePath: 'data/uploads/customer.pdf', attachmentKey: '' });
  h.setItem(standalone(key));
  await h.context.importZoteroItem(key);
  assert.equal(h.context.APP.data.items.length, 1);
  assert.equal(h.context.APP.data.items[0].id, 'locally-linked');
  assert.equal(h.context.APP.data.items[0].filePath, 'data/uploads/customer.pdf');
  assert.equal(h.context.APP.data.items[0].attachmentKey, '');
});

test('a later child attachment appears only after explicit reimport, while plain reload makes no Zotero request', async () => {
  const h = harness(), key = 'PARENT01';
  const parent = { zoteroKey: key, zoteroItemType: 'journalArticle', title: 'Parent journal paper', authors: [], tags: [],
    children: { attachments: [], annotations: [], notes: [] } };
  h.setItem(parent);
  await h.context.importZoteroItem(key);
  assert.equal(h.context.APP.data.items[0].attachmentKey, '');
  parent.children.attachments.push({ key: 'NEWPDF01', contentType: 'application/pdf', filename: 'new.pdf' });
  h.setItem(parent);
  h.context.APP.data = h.context.normalizeState(plain(h.context.APP.data));
  await Promise.resolve();
  assert.equal(h.calls.length, 1);
  assert.equal(h.timers.length, 0);
  assert.equal(h.context.APP.data.items[0].attachmentKey, '');
  await h.context.importZoteroItem(key);
  assert.equal(h.calls.length, 2);
  assert.equal(h.context.APP.data.items.length, 1);
  assert.equal(h.context.APP.data.items[0].attachmentKey, 'NEWPDF01');
});
