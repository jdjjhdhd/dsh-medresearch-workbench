import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { assertBridgeProjectRoot, setCors } from '../bridge/server.mjs';

const root = path.resolve('test-project-A');
const other = path.resolve('test-project-B');
const request = (value) => ({ headers: value === undefined ? {} : { 'x-medresearch-project-root': value } });

test('all project data routes and PDF uploads require an explicit project identity', () => {
  for (const route of ['/data/load', '/data/save', '/data/backup', '/data/backups', '/data/restore', '/files/upload']) {
    assert.throws(() => assertBridgeProjectRoot(request(), route, { root }), { status: 403, code: 'project-root-required' });
    assert.doesNotThrow(() => assertBridgeProjectRoot(request(encodeURIComponent(root)), route, { root }));
  }
});

test('a request from another project is rejected before any route operation', () => {
  for (const route of ['/data/load', '/data/save', '/files/upload', '/search/pubmed']) {
    let handled = false;
    assert.throws(() => {
      assertBridgeProjectRoot(request(encodeURIComponent(other)), route, { root });
      handled = true;
    }, { status: 403, code: 'project-root-mismatch' });
    assert.equal(handled, false);
  }
});

test('URI encoding is checked and relative project paths cannot authorize data access', () => {
  assert.throws(() => assertBridgeProjectRoot(request('%E0%A4%A'), '/data/save', { root }), { status: 400, code: 'bad-project-root' });
  assert.throws(() => assertBridgeProjectRoot(request(encodeURIComponent('test-project-A')), '/data/save', { root }), { status: 403, code: 'project-root-mismatch' });
  assert.throws(() => assertBridgeProjectRoot(request(''), '/data/save', { root }), { status: 403, code: 'project-root-required' });
});

test('absolute paths normalize trailing separators and dot components', () => {
  const equivalent = path.join(root, 'nested', '..') + path.sep;
  assert.doesNotThrow(() => assertBridgeProjectRoot(request(encodeURIComponent(equivalent)), '/data/load', { root }));
  if (process.platform === 'win32') {
    assert.doesNotThrow(() => assertBridgeProjectRoot(request(encodeURIComponent(root.toUpperCase())), '/data/load', { root }));
  }
});

test('health and status remain readable while legacy non-project requests stay compatible', () => {
  assert.doesNotThrow(() => assertBridgeProjectRoot(request(), '/health', { root }));
  assert.doesNotThrow(() => assertBridgeProjectRoot(request(), '/status', { root }));
  assert.doesNotThrow(() => assertBridgeProjectRoot(request(encodeURIComponent(other)), '/health', { root }));
  assert.doesNotThrow(() => assertBridgeProjectRoot(request(), '/search/pubmed', { root }));
  assert.doesNotThrow(() => assertBridgeProjectRoot(request(), '/zotero/search', { root }));
});

test('desktop CORS preflight permits the project header without accessing project files', () => {
  const headers = new Map();
  setCors({ headers: { origin: 'dsh-app://app' } }, { setHeader: (key, value) => headers.set(key, value) });
  assert.equal(headers.get('access-control-allow-origin'), 'dsh-app://app');
  assert.ok(headers.get('access-control-allow-headers').split(',').map((value) => value.trim()).includes('x-medresearch-project-root'));
});
