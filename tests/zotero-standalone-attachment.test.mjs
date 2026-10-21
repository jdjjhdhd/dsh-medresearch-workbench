import assert from 'node:assert/strict';
import test from 'node:test';
import { zoteroItem } from '../bridge/server.mjs';

function mockZotero(responses) {
  const calls = [];
  return {
    calls,
    fetchItem: async (pathname) => {
      calls.push(pathname);
      assert.ok(Object.hasOwn(responses, pathname), `unexpected Zotero request: ${pathname}`);
      return { status: 200, ok: true, json: responses[pathname] };
    },
  };
}

test('a standalone PDF attachment identifies its own file and imports its annotations', async () => {
  const key = 'PDF00001';
  const mock = mockZotero({
    [`/users/0/items/${key}`]: {
      key,
      data: { itemType: 'attachment', title: 'Standalone research PDF', contentType: 'application/pdf', filename: 'research.pdf', linkMode: 'imported_file' },
    },
    [`/users/0/items/${key}/children?limit=100`]: [],
    [`/users/0/items/${key}/children?itemType=annotation&limit=100`]: [
      { key: 'ANN00001', data: { itemType: 'annotation', annotationPageLabel: '4', annotationText: 'Evidence quote', annotationComment: 'Read again', annotationType: 'highlight' } },
    ],
  });
  const item = await zoteroItem(key, mock);
  assert.equal(item.zoteroKey, key);
  assert.equal(item.zoteroItemType, 'attachment');
  const pdf = item.children.attachments.find((attachment) => /pdf/i.test(attachment.contentType) || /\.pdf$/i.test(attachment.filename));
  assert.equal(pdf.key, key);
  assert.equal(pdf.filename, 'research.pdf');
  assert.equal(item.children.annotations.length, 1);
  assert.equal(item.children.annotations[0].parentAttachment, key);
  assert.equal(item.children.annotations[0].page, '4');
  assert.equal(item.children.annotations[0].text, 'Evidence quote');
  assert.equal(mock.calls.length, 3);
});

test('a normal parent item keeps the child attachment key and its notes instead of treating the parent as a file', async () => {
  const parent = 'PAPER001', attachment = 'ATT00001';
  const mock = mockZotero({
    [`/users/0/items/${parent}`]: { key: parent, data: { itemType: 'journalArticle', title: 'Parent paper', DOI: '10.test/parent' } },
    [`/users/0/items/${parent}/children?limit=100`]: [
      { key: attachment, data: { itemType: 'attachment', filename: 'paper.pdf', contentType: 'application/pdf', linkMode: 'linked_file' } },
      { key: 'NOTE0001', data: { itemType: 'note', note: '<p>A saved note.</p>' } },
    ],
    [`/users/0/items/${attachment}/children?itemType=annotation&limit=100`]: [],
  });
  const item = await zoteroItem(parent, mock);
  assert.equal(item.zoteroItemType, 'journalArticle');
  assert.equal(item.doi, '10.test/parent');
  assert.deepEqual(item.children.attachments.map((file) => file.key), [attachment]);
  assert.equal(item.children.notes[0].body, 'A saved note.');
  assert.equal(mock.calls.some((path) => path === `/users/0/items/${parent}/children?itemType=annotation&limit=100`), false);
});

test('metadata-only items with no attachments remain readable without inventing a PDF or making polling requests', async () => {
  const key = 'NOFILE01';
  const mock = mockZotero({
    [`/users/0/items/${key}`]: { key, data: { itemType: 'journalArticle', title: 'Metadata only', abstractNote: 'A useful abstract.' } },
    [`/users/0/items/${key}/children?limit=100`]: [],
  });
  const item = await zoteroItem(key, mock);
  assert.equal(item.abstract, 'A useful abstract.');
  assert.deepEqual(item.children, { notes: [], annotations: [], attachments: [] });
  assert.equal(mock.calls.length, 2);
});

test('a non-PDF standalone attachment keeps its real MIME type and is not labelled as a PDF', async () => {
  const key = 'HTML0001';
  const mock = mockZotero({
    [`/users/0/items/${key}`]: { key, data: { itemType: 'attachment', title: 'Saved snapshot', filename: 'snapshot.html', contentType: 'text/html', linkMode: 'imported_url' } },
    [`/users/0/items/${key}/children?limit=100`]: [],
    [`/users/0/items/${key}/children?itemType=annotation&limit=100`]: [],
  });
  const item = await zoteroItem(key, mock);
  assert.equal(item.children.attachments[0].key, key);
  assert.equal(item.children.attachments[0].contentType, 'text/html');
  assert.equal(item.children.attachments.some((file) => /pdf/i.test(file.contentType) || /\.pdf$/i.test(file.filename)), false);
});

test('annotation lookup failure does not prevent importing the standalone PDF', async () => {
  const key = 'PDF00002';
  const mock = mockZotero({
    [`/users/0/items/${key}`]: { key, data: { itemType: 'attachment', filename: 'paper.pdf', contentType: 'application/pdf' } },
    [`/users/0/items/${key}/children?limit=100`]: [],
    [`/users/0/items/${key}/children?itemType=annotation&limit=100`]: [],
  });
  const item = await zoteroItem(key, { fetchItem: async (pathname) => {
    if (pathname.includes('itemType=annotation')) throw new Error('simulated unavailable annotation endpoint');
    return mock.fetchItem(pathname);
  } });
  assert.equal(item.children.attachments[0].key, key);
  assert.deepEqual(item.children.annotations, []);
});
