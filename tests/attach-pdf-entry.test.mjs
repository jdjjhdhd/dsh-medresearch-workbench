import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = Object.fromEntries(['reader', 'events', 'core', 'views'].map((name) => [name,
  readFileSync(new URL(`../src/${name}.js`, import.meta.url), 'utf8')]));
const plain = (value) => JSON.parse(JSON.stringify(value));

function functionSource(file, name) {
  const start = source[file].search(new RegExp(`^  (?:async )?function ${name}\\(`, 'm'));
  assert.notEqual(start, -1, `${file}.${name}`);
  const rest = source[file].slice(start);
  const header = rest.split('\n', 1)[0];
  if (/\}\s*$/u.test(header)) return header;
  const closing = /\r?\n  \}(?=\r?\n|$)/u.exec(rest);
  assert.ok(closing, `${file}.${name} closing brace`);
  return rest.slice(0, closing.index + closing[0].length);
}

function harness() {
  const listeners = new Map();
  const input = { files: [], value: '', clicks: 0,
    click() { this.clicks++; }, addEventListener(name, callback) { listeners.set(name, callback); } };
  const records = {
    items: [{ id: 'original-paper', title: 'Original paper metadata', abstract: 'Existing abstract',
      doi: '10.1234/original', readStatus: 'unread', source: { type: 'pubmed', label: 'PubMed' },
      topicIds: ['existing-topic'], annotations: [{ id: 'annotation-1', page: 2 }], qa: [{ question: 'Saved question' }] }],
    notes: [{ id: 'note-1', itemId: 'original-paper', body: 'Saved note' }],
    tasks: [{ id: 'task-1', subjectType: 'item', subjectId: 'original-paper', title: 'Saved task' }],
    topics: [{ id: 'existing-topic', name: 'Existing topic' }],
  };
  const calls = { requests: [], saves: [], opened: [], messages: [], imports: [], rendered: 0 };
  const context = {
    APP: { data: records, bridge: { online: true, url: 'http://fixture.invalid' },
      ui: { attachItemId: '', reader: { tab: 'info' } } },
    READER: { loading: false, status: 'abstract', numPages: 0, textChunks: [] },
    document: { addEventListener() {} },
    $: (selector) => selector === '#filePdf' ? input : { addEventListener() {} },
    btoa: (value) => Buffer.from(value, 'latin1').toString('base64'),
    findItem: (id) => records.items.find((item) => item.id === id),
    fetchJsonNice: async (url, options) => {
      calls.requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: { path: 'data/uploads/associated.pdf' } };
    },
    upsertItem: (item) => { calls.imports.push(plain(item)); records.items.push({ ...item, id: 'new-import' }); return { merged: false }; },
    markDirty: (options) => calls.saves.push({ options: plain(options), data: plain(records) }),
    closeModal() {}, render: () => calls.rendered++,
    openReader: (id) => calls.opened.push(id),
    toast: (message) => calls.messages.push(message),
    apiErrorMessage: (error) => error.message,
    itemMetaLine: () => 'Metadata', readerStatusBadge: () => 'Status',
    openModal: (options) => { calls.modal = options; }, ITEM_TYPES: ['期刊文献'],
  };
  vm.createContext(context);
  vm.runInContext([
    functionSource('core', 'str'), functionSource('core', 'esc'), functionSource('core', 'onAction'),
    functionSource('reader', 'readerStageHtml'), functionSource('reader', 'readerInfoHtml'),
    functionSource('views', 'openLocalFileModal'), source.events,
  ].join('\n'), context, { filename: 'attach-pdf-fixture.js' });
  return { context, records, calls, input, listeners };
}

function selectPdf(h, name = 'local-copy.pdf') {
  const file = { name, type: 'application/pdf', size: 12,
    arrayBuffer: async () => Uint8Array.from(Buffer.from('%PDF-fixture')).buffer };
  h.input.files = [file];
  h.input.value = name;
  let pending;
  const upload = h.context.uploadPdfFile;
  h.context.uploadPdfFile = (...args) => { pending = upload(...args); return pending; };
  h.listeners.get('change').call(h.input);
  return pending;
}

test('摘要视图与无附件信息栏将关联入口绑定到当前资料 ID', () => {
  const h = harness();
  const item = { ...h.records.items[0], id: 'paper-"quoted"' };
  for (const html of [h.context.readerStageHtml(item), h.context.readerInfoHtml(item)]) {
    assert.match(html, /data-act="attachPdf" data-id="paper-&quot;quoted&quot;"/u);
  }
  assert.match(h.context.readerStageHtml(item), /为本资料选择 \/ 关联 PDF/u);
});

test('已有本地 PDF 或 Zotero 附件时信息栏不显示新增关联按钮', () => {
  const h = harness();
  for (const fields of [{ filePath: 'data/uploads/existing.pdf' }, { attachmentKey: 'ZOTERO123' }]) {
    assert.doesNotMatch(h.context.readerInfoHtml({ ...h.records.items[0], ...fields }), /data-act="attachPdf"/u);
  }
});

test('点击当前资料入口并选择 PDF 后原地关联、立即保存，保留笔记和任务', async () => {
  const h = harness();
  const item = h.records.items[0];
  const before = plain(h.records);
  const element = { getAttribute: (name) => name === 'data-id' ? item.id : null };
  h.context.onAction('attachPdf', element, {});
  assert.equal(h.input.clicks, 1);
  assert.equal(h.context.APP.ui.attachItemId, item.id);
  await selectPdf(h);
  assert.equal(h.input.value, '');
  assert.equal(h.records.items.length, 1);
  assert.equal(h.calls.imports.length, 0);
  assert.equal(h.records.items[0], item);
  assert.equal(item.id, before.items[0].id);
  assert.equal(item.filePath, 'data/uploads/associated.pdf');
  assert.equal(item.attachmentKey, '');
  assert.equal(item.readStatus, 'reading');
  for (const key of ['title', 'abstract', 'doi', 'source', 'topicIds', 'annotations', 'qa']) {
    assert.deepEqual(plain(item[key]), before.items[0][key]);
  }
  assert.deepEqual(plain(h.records.notes), before.notes);
  assert.deepEqual(plain(h.records.tasks), before.tasks);
  assert.deepEqual(h.calls.opened, [item.id]);
  assert.equal(h.context.APP.ui.attachItemId, '');
  assert.equal(h.calls.saves.length, 1);
  assert.deepEqual(h.calls.saves[0].options, { immediate: true });
  assert.equal(h.calls.saves[0].data.items[0].filePath, item.filePath);
  assert.deepEqual(h.calls.saves[0].data.notes, before.notes);
  assert.deepEqual(h.calls.saves[0].data.tasks, before.tasks);
  assert.equal(h.calls.requests[0].url, 'http://fixture.invalid/files/upload');
});

test('打开普通导入 PDF 弹窗会清除上一次关联目标，继续沿用新增资料流程', async () => {
  const h = harness();
  h.context.APP.ui.attachItemId = h.records.items[0].id;
  h.context.openLocalFileModal('existing-topic');
  assert.equal(h.context.APP.ui.attachItemId, '');
  await selectPdf(h, 'new-paper.pdf');
  assert.equal(h.calls.imports.length, 1);
  assert.equal(h.calls.imports[0].title, 'new-paper');
  assert.equal(h.records.items.length, 2);
  assert.equal(h.records.items[0].filePath, undefined);
  assert.deepEqual(h.calls.opened, []);
});

test('取消关联文件选择后立即清除目标，下一次普通选择不会误关联', async () => {
  const h = harness();
  const id = h.records.items[0].id;
  h.context.onAction('attachPdf', { getAttribute: () => id }, {});
  assert.equal(h.context.APP.ui.attachItemId, id);
  h.input.files = [];
  h.listeners.get('change').call(h.input);
  assert.equal(h.context.APP.ui.attachItemId, '');
  assert.equal(h.calls.requests.length, 0);
  assert.equal(h.calls.imports.length, 0);
  await selectPdf(h, 'later-normal-import.pdf');
  assert.equal(h.calls.imports.length, 1);
  assert.equal(h.records.items.length, 2);
  assert.equal(h.records.items[0].filePath, undefined);
  assert.deepEqual(h.calls.opened, []);
});

test('上传期间原资料被删时保留已上传附件，不回退新建资料', async () => {
  const h = harness();
  const before = plain(h.records);
  let finishUpload;
  let uploadStarted;
  const started = new Promise((resolve) => { uploadStarted = resolve; });
  h.context.fetchJsonNice = (url, options) => {
    h.calls.requests.push({ url, method: options.method });
    uploadStarted();
    return new Promise((resolve) => { finishUpload = resolve; });
  };
  h.context.onAction('attachPdf', { getAttribute: () => h.records.items[0].id }, {});
  const pending = selectPdf(h);
  assert.equal(h.context.APP.ui.attachItemId, '');
  await started;
  h.records.items.splice(0, 1);
  finishUpload({ ok: true, json: { path: 'data/uploads/retained-upload.pdf' } });
  await pending;
  assert.equal(h.records.items.length, 0);
  assert.equal(h.calls.imports.length, 0);
  assert.equal(h.calls.saves.length, 0);
  assert.deepEqual(h.calls.opened, []);
  assert.equal(h.context.APP.ui.attachItemId, '');
  assert.ok(h.calls.messages.includes('原资料已不存在，未创建新资料'));
  assert.deepEqual(plain(h.records.notes), before.notes);
  assert.deepEqual(plain(h.records.tasks), before.tasks);
  assert.deepEqual(h.calls.requests, [{ url: 'http://fixture.invalid/files/upload', method: 'POST' }]);
});
