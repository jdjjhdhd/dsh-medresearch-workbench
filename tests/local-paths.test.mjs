import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizeLocalPaths, registerUploadedFile } from '../bridge/server.mjs';

const PDF = Buffer.from('%PDF-1.4\nmedical-workbench-path-test\n%%EOF');
const relativeUpload = 'data/uploads/paper.pdf';
const sidecarSuffix = '.medwb-upload.json';

async function workspace(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'medwb-paths-'));
  t.after(async () => {
    assert.equal(path.dirname(temp), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith('medwb-paths-'));
    await fs.rm(temp, { recursive: true, force: true });
  });
  return temp;
}

async function putPdf(root, contents = PDF) {
  const file = path.join(root, relativeUpload);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents);
  return file;
}

test('a same-name external PDF is never replaced by a registered upload', async (t) => {
  const temp = await workspace(t);
  const root = path.join(temp, 'project');
  const upload = await putPdf(root);
  await registerUploadedFile(upload, { root });
  const external = path.join(temp, 'external', 'paper.pdf');
  await fs.mkdir(path.dirname(external));
  await fs.writeFile(external, '%PDF-1.4\nA different document');
  const data = { items: [{ id: 'external', filePath: external }] };
  const warnings = [];
  await normalizeLocalPaths(data, { root, warnings });
  assert.equal(data.items[0].filePath, external);
  assert.equal(warnings[0].code, 'unverified-absolute-path');
  assert.equal(await fs.readFile(external, 'utf8'), '%PDF-1.4\nA different document');
});

test('a data/uploads suffix and identical bytes do not establish upload ownership', async (t) => {
  const temp = await workspace(t);
  const root = path.join(temp, 'project');
  const upload = await putPdf(root);
  await registerUploadedFile(upload, { root });
  const foreign = await putPdf(path.join(temp, 'unrelated-project'));
  const data = { items: [{ id: 'unknown', filePath: foreign, source: { type: 'local', label: '本地上传' } }] };
  await normalizeLocalPaths(data, { root });
  assert.equal(data.items[0].filePath, foreign);
});

test('an absolute upload in the current project becomes relative and gains a fingerprint', async (t) => {
  const temp = await workspace(t);
  const root = path.join(temp, 'project');
  const file = await putPdf(root);
  const data = { items: [{ id: 'local', filePath: file }] };
  const warnings = [];
  await normalizeLocalPaths(data, { root, warnings });
  assert.equal(data.items[0].filePath, relativeUpload);
  assert.deepEqual(warnings, []);
  const identity = JSON.parse(await fs.readFile(file + sidecarSuffix, 'utf8'));
  assert.equal(identity.relativePath, relativeUpload);
  assert.equal(identity.sha256, createHash('sha256').update(PDF).digest('hex'));
  assert.equal(identity.bytes, PDF.length);
  assert.deepEqual(identity.sourcePaths, [file]);
});

test('a registered upload survives an actual A to B move with A absent', async (t) => {
  const temp = await workspace(t);
  const oldRoot = path.join(temp, 'A');
  const newRoot = path.join(temp, 'B');
  const oldFile = await putPdf(oldRoot);
  await registerUploadedFile(oldFile, { root: oldRoot });
  await fs.rename(oldRoot, newRoot);
  const data = { items: [{ id: 'moved', filePath: oldFile }] };
  const warnings = [];
  await normalizeLocalPaths(data, { root: newRoot, warnings });
  assert.equal(data.items[0].filePath, relativeUpload);
  assert.deepEqual(warnings, []);
  assert.deepEqual(await fs.readFile(path.join(newRoot, data.items[0].filePath)), PDF);
  await assert.rejects(fs.stat(oldFile), { code: 'ENOENT' });
});

test('upload origin records support another move after the first migration', async (t) => {
  const temp = await workspace(t);
  const a = path.join(temp, 'A');
  const b = path.join(temp, 'B');
  const c = path.join(temp, 'C');
  const original = await putPdf(a);
  await registerUploadedFile(original, { root: a });
  await fs.rename(a, b);
  await normalizeLocalPaths({ items: [{ filePath: original }] }, { root: b });
  const intermediate = path.join(b, relativeUpload);
  await fs.rename(b, c);
  const data = { items: [{ id: 'twice-moved', filePath: intermediate }] };
  await normalizeLocalPaths(data, { root: c });
  assert.equal(data.items[0].filePath, relativeUpload);
});

test('changed file contents fail identity validation after a move', async (t) => {
  const temp = await workspace(t);
  const a = path.join(temp, 'A');
  const b = path.join(temp, 'B');
  const original = await putPdf(a);
  await registerUploadedFile(original, { root: a });
  await fs.rename(a, b);
  await fs.writeFile(path.join(b, relativeUpload), '%PDF-1.4\nreplacement');
  const data = { items: [{ id: 'changed', filePath: original }] };
  const warnings = [];
  await normalizeLocalPaths(data, { root: b, warnings });
  assert.equal(data.items[0].filePath, original);
  assert.equal(warnings[0].code, 'unverified-absolute-path');
});

test('an already moved legacy absolute path without provenance stays unchanged', async (t) => {
  const temp = await workspace(t);
  const a = path.join(temp, 'A');
  const b = path.join(temp, 'B');
  const oldFile = await putPdf(a);
  await fs.rename(a, b);
  const data = { items: [{ id: 'legacy', filePath: oldFile }] };
  const warnings = [];
  await normalizeLocalPaths(data, { root: b, warnings });
  assert.equal(data.items[0].filePath, oldFile);
  assert.equal(warnings.length, 1);
  await assert.rejects(fs.stat(path.join(b, relativeUpload) + sidecarSuffix), { code: 'ENOENT' });
});

test('existing relative uploads remain relative and can acquire provenance before moving', async (t) => {
  const temp = await workspace(t);
  const a = path.join(temp, 'A');
  const b = path.join(temp, 'B');
  const oldFile = await putPdf(a);
  const data = { items: [{ id: 'relative', filePath: relativeUpload }] };
  await normalizeLocalPaths(data, { root: a });
  assert.equal(data.items[0].filePath, relativeUpload);
  await fs.rename(a, b);
  const legacy = { items: [{ id: 'old-reference', filePath: oldFile }] };
  await normalizeLocalPaths(legacy, { root: b });
  assert.equal(legacy.items[0].filePath, relativeUpload);
});

test('a missing destination or malformed identity never changes the old reference', async (t) => {
  const temp = await workspace(t);
  const a = path.join(temp, 'A');
  const b = path.join(temp, 'B');
  const oldFile = await putPdf(a);
  await registerUploadedFile(oldFile, { root: a });
  await fs.rename(a, b);
  const newFile = path.join(b, relativeUpload);
  await fs.unlink(newFile);
  const missing = { items: [{ filePath: oldFile }] };
  await normalizeLocalPaths(missing, { root: b });
  assert.equal(missing.items[0].filePath, oldFile);
  await fs.writeFile(newFile, PDF);
  await fs.writeFile(newFile + sidecarSuffix, '{broken json');
  const malformed = { items: [{ filePath: oldFile }] };
  await normalizeLocalPaths(malformed, { root: b });
  assert.equal(malformed.items[0].filePath, oldFile);
});

test('unrelated relative PDFs stay unchanged and external files cannot be registered', async (t) => {
  const temp = await workspace(t);
  const root = path.join(temp, 'project');
  await putPdf(root);
  const data = { items: [{ id: 'example', filePath: 'fixtures/sample-paper.pdf' }] };
  await normalizeLocalPaths(data, { root });
  assert.equal(data.items[0].filePath, 'fixtures/sample-paper.pdf');
  const external = await putPdf(path.join(temp, 'external'));
  await assert.rejects(registerUploadedFile(external, { root }), /只能登记本项目/);
});
