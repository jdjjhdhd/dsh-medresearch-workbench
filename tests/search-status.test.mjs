import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const read = (name) => fs.readFileSync(new URL(`../src/${name}.js`, import.meta.url), 'utf8');
const core = read('core');
const views = read('views');
const search = read('search');
function pick(source, name) {
  const start = source.search(new RegExp(`^  (?:async )?function ${name}\\(`, 'm'));
  assert.notEqual(start, -1, name);
  const rest = source.slice(start);
  const next = rest.slice(3).search(/\n  (?:async )?function /);
  return next < 0 ? rest : rest.slice(0, next + 3);
}
function harness(biomcp = { found: false, installed: false, note: '未找到 BioMCP 二进制' }) {
  const head = { innerHTML: '' };
  const context = {
    APP: { bridge: { online: true, url: 'http://127.0.0.1:18765', health: { version: '0.2.2', search: { biomcp } } },
      save: {}, model: { mode: 'dsh', dsh: {}, status: {} }, data: { searches: [] },
      ui: { search: { tab: 'lit', q: '' } },
      search: { loading: false, error: '', results: { lit: null }, meta: {} } },
    $: () => head, saveClass: () => 'ok', saveLabel: () => '已存本机文件', modelChipHtml: () => '',
    zoteroStatusChip: () => '', modelStatusChip: () => '', modelStatusLabel: () => '',
    saveModeText: () => '', projectDir: () => 'D:/test', fmtDateTime: () => 'test-time',
    demoBanner: () => '', pageHead: (title) => title, relTime: () => '刚刚',
    markDirty() {}, render() {}, toast() {}, uid: () => 'test-search',
    readSearchForm: () => ({ q: '高血压' }), Date,
  };
  vm.createContext(context);
  vm.runInContext([pick(core, 'esc'), pick(core, 'str'), pick(core, 'truncate'), pick(core, 'renderHead'),
    pick(views, 'biomcpStatusChip'), pick(views, 'settingsConnBody'), search].join('\n'), context);
  context.readSearchForm = () => ({ q: '高血压' });
  return { context, head };
}

test('missing binary is an actionable warning rather than an unlabelled grey light', () => {
  const { context, head } = harness();
  context.renderHead();
  assert.match(head.innerHTML, /statusChip warn click[^>]*data-act="settings"[^>]*title="未找到 BioMCP/);
  assert.match(head.innerHTML, /BioMCP 未就绪/);
  assert.doesNotMatch(head.innerHTML, />BioMCP 同源</);
  assert.match(context.biomcpStatusChip(), /BioMCP 未找到 · 备用检索/);
});

test('a found binary that cannot run is not shown as available', () => {
  const { context } = harness({ found: true, installed: false, note: '程序启动失败' });
  assert.match(context.biomcpStatusChip(), /BioMCP 启动失败 · 备用检索/);
  const html = context.settingsConnBody();
  assert.match(html, /程序启动失败/);
  assert.match(html, /NCBI PubMed E-utilities/);
  assert.match(html, /learn.microsoft.com/);
  assert.doesNotMatch(html, /BioMCP  · PubMed/);
});

test('a verified executable displays its version without claiming network success', () => {
  const { context, head } = harness({ found: true, installed: true, version: '0.9.3' });
  context.renderHead();
  assert.match(head.innerHTML, /statusChip ok click[^>]*title="本地程序可运行/);
  assert.match(head.innerHTML, />BioMCP 0.9.3</);
  assert.match(context.settingsConnBody(), /检索需要联网/);
});

test('fallback search banner retains the reason while offering public sources', () => {
  const { context } = harness({ found: true, installed: false, note: '版本检测未通过' });
  const html = context.renderSearch();
  assert.match(html, /banner bannerWarn/);
  assert.match(html, /版本检测未通过/);
  assert.match(html, /备用检索/);
});

test('search results retain fallback, partial-result and upstream-note metadata', async () => {
  const { context } = harness();
  context.runSearchViaBridge = async () => ({ items: [{ title: 'public paper' }], total: 100,
    query: '高血压', source: 'PubMed', fallback: { reason: '<network failed>' }, complete: false, note: '上游维护' });
  await context.runSearch();
  assert.equal(context.APP.search.meta.lit.fallback.reason, '<network failed>');
  assert.equal(context.APP.search.meta.lit.complete, false);
  assert.equal(context.APP.search.meta.lit.returnedCount, 1);
  const html = context.searchResultMetaHtml();
  assert.match(html, /&lt;network failed&gt;/);
  assert.doesNotMatch(html, /<network failed>/);
  assert.match(html, /部分来源/);
  assert.match(html, /上游维护/);
  assert.match(html, /返回 1 条/);
  assert.doesNotMatch(html, /返回 100 条/);
  assert.match(html, /未自动翻译或改写原查询/);
});

test('literature and trial history use the same types as persisted search records', () => {
  const { context } = harness();
  context.recordSearch('lit', 'hypertension', {}, 2, 'BioMCP');
  context.recordSearch('trials', 'diabetes', {}, 1, 'ClinicalTrials.gov');
  assert.match(context.searchHistoryHtml('lit'), /hypertension/);
  assert.doesNotMatch(context.searchHistoryHtml('lit'), /diabetes/);
  assert.match(context.searchHistoryHtml('trials'), /diabetes/);
});
