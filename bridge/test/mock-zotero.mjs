#!/usr/bin/env node
/**
 * 仅供本地验收使用的 Zotero 本地 API 模拟器（不是交付功能）。
 * 在未安装 Zotero 的机器上验证：条目映射、笔记/批注/附件、PDF 代理、全文状态。
 *
 * 用法：node bridge/test/mock-zotero.mjs [port]
 * 然后：MEDWB_PORT=8766 ZOTERO_BASE_URL=http://127.0.0.1:23119/api node bridge/server.mjs
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PORT = Number(process.argv[2] || 23119);
const PDF = path.join(ROOT, 'fixtures', 'sample-paper.pdf');

const ITEM = {
  key: 'ABCD1234',
  version: 12,
  library: { type: 'user', id: 0 },
  links: { self: { href: 'http://127.0.0.1:23119/api/users/0/items/ABCD1234', type: 'application/json' } },
  meta: { creatorSummary: 'Boussageon et al.', parsedDate: '2012-03-06', numChildren: 3 },
  data: {
    key: 'ABCD1234',
    version: 12,
    itemType: 'journalArticle',
    title: 'Reappraisal of Metformin Efficacy in the Treatment of Type 2 Diabetes: A Meta-Analysis of Randomised Trials',
    creators: [
      { creatorType: 'author', firstName: 'Rémy', lastName: 'Boussageon' },
      { creatorType: 'author', firstName: 'Theodora', lastName: 'Bejan-Angoulvant' },
      { creatorType: 'author', firstName: 'Mitra', lastName: 'Saadatian-Elahi' },
    ],
    abstractNote:
      'Background: Metformin is recommended as first-line therapy in type 2 diabetes. This meta-analysis re-examines its efficacy on glycated hemoglobin and cardiovascular outcomes.',
    date: '2012-03-06',
    DOI: '10.1371/journal.pmed.1001204',
    publicationTitle: 'PLoS Medicine',
    volume: '9',
    issue: '3',
    pages: 'e1001204',
    url: 'https://doi.org/10.1371/journal.pmed.1001204',
    tags: [{ tag: 'metformin' }, { tag: 'type 2 diabetes' }, { tag: 'meta-analysis' }],
    collections: ['COLL0001'],
    extra: 'PMID: 22509138\nCitation Key: boussageon2012',
    relations: {},
  },
};

const ATTACHMENT = {
  key: 'PDF00001',
  version: 3,
  data: {
    key: 'PDF00001',
    version: 3,
    itemType: 'attachment',
    parentItem: 'ABCD1234',
    title: 'Full Text PDF',
    filename: 'sample-paper.pdf',
    contentType: 'application/pdf',
    linkMode: 'imported_file',
    tags: [],
    collections: [],
    relations: {},
  },
};

const NOTE = {
  key: 'NOTE0001',
  version: 1,
  data: {
    key: 'NOTE0001',
    version: 1,
    itemType: 'note',
    parentItem: 'ABCD1234',
    note: '<p>复现要点：这是一篇再评价的 Meta 分析，需核对纳入试验的异质性与终点定义。</p>',
    tags: [],
    collections: [],
    relations: {},
  },
};

const ANNOTATION = {
  key: 'ANNO0001',
  version: 1,
  data: {
    key: 'ANNO0001',
    version: 1,
    itemType: 'annotation',
    parentItem: 'PDF00001',
    annotationType: 'highlight',
    annotationText: 'Metformin was associated with a reduction in HbA1c',
    annotationComment: '与后续指南的表述对照阅读',
    annotationPageLabel: '3',
    annotationColor: '#ffd600',
    tags: [],
    relations: {},
  },
};

const COLLECTION = {
  key: 'COLL0001',
  version: 1,
  data: { key: 'COLL0001', version: 1, name: 'Metformin · 证据再评价', parentCollection: false },
};

const FULLTEXT =
  'Metformin is widely recommended as first-line pharmacotherapy for type 2 diabetes. ' +
  'This systematic review and meta-analysis included randomised controlled trials comparing metformin with placebo or other oral agents. ' +
  'Metformin was associated with a reduction in HbA1c of approximately 0.5 percentage points versus placebo. ' +
  'Evidence for a reduction in cardiovascular mortality was uncertain, with wide confidence intervals and substantial heterogeneity.';

function json(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'zotero-api-version': '3',
    'zotero-server-id': 'mock-zotero-local',
    'total-results': String(headers.total ?? 1),
  });
  res.end(text);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const p = url.pathname;
  if (p === '/api/users/0/items' || p === '/api/users/0/items/top') {
    if (url.searchParams.get('q') && !/metformin|diabet/i.test(url.searchParams.get('q'))) {
      json(res, 200, [], { total: 0 });
      return;
    }
    json(res, 200, [ITEM], { total: 1 });
    return;
  }
  if (p === '/api/users/0/collections') {
    json(res, 200, [COLLECTION], { total: 1 });
    return;
  }
  const m = p.match(/^\/api\/users\/0\/items\/([^/]+)(\/[^/]+(?:\/[^/]+)*)?$/);
  if (m) {
    const key = decodeURIComponent(m[1]);
    const rest = m[2] || '';
    if (key === 'ABCD1234') {
      if (rest === '') return json(res, 200, ITEM);
      if (rest === '/children') return json(res, 200, [ATTACHMENT, NOTE, ANNOTATION], { total: 3 });
    }
    if (key === 'PDF00001') {
      if (rest === '') return json(res, 200, ATTACHMENT);
      if (rest === '/fulltext') {
        return json(res, 200, {
          content: FULLTEXT,
          indexedPages: 8,
          totalPages: 8,
          indexedChars: FULLTEXT.length,
          totalChars: FULLTEXT.length,
        });
      }
      if (rest === '/file/view/url') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(pathToFileURL(PDF).href);
        return;
      }
    }
    if (key === 'NOTE0001') return json(res, 200, NOTE);
    if (key === 'ANNO0001') return json(res, 200, ANNOTATION);
    return json(res, 404, { error: 'not found' }, { total: 0 });
  }
  json(res, 404, { error: 'not found' }, { total: 0 });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-zotero] listening on http://127.0.0.1:${PORT}/api (pdf: ${PDF})`);
});
