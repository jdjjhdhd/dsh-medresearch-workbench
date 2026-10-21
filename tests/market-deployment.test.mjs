import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { ensureMarketDeployment, isMarketPackageRoot } from '../plugin/src/host/market-deployment.js';
import { createInstallationRecord, pluginRuntimeHash, validateInstallationRoot } from '../plugin/src/host/installation.js';

const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = 'dsh-medresearch-model';
const RECORD = '.medresearch-workbench-installation.json';
const OWNER = '.medresearch-market-deployment.json';
const LOCK = '.medresearch-market-deployment.lock';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (file, value) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); };
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
function file(root, relative, bytes) { mkdirSync(dirname(join(root, relative)), { recursive: true }); writeFileSync(join(root, relative), bytes); }
function list(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? list(root, path) : [path];
  });
}
function snapshot(root) { return Object.fromEntries(list(root).map((path) => [path, hash(readFileSync(join(root, path)))])); }

function fixture(t) {
  const temp = mkdtempSync(join(tmpdir(), 'medwb-market-deployment-test-'));
  t.after(() => {
    assert.ok(resolve(temp).startsWith(resolve(tmpdir()) + sep));
    assert.ok(temp.includes('medwb-market-deployment-test-'));
    rmSync(temp, { recursive: true, force: true });
  });
  const profile = join(temp, 'profile');
  const packageRoot = join(temp, 'node_modules', PLUGIN);
  mkdirSync(profile, { recursive: true });
  mkdirSync(packageRoot, { recursive: true });
  cpSync(join(SOURCE, 'plugin'), join(packageRoot, 'plugin'), { recursive: true, filter: (source) => !source.split(/[\\/]/).includes('node_modules') });
  for (const name of ['package.json', 'dsh.plugin.json']) {
    const target = join(packageRoot, 'plugin', name);
    json(target, { ...readJson(target), version: '0.2.4' });
  }
  json(join(packageRoot, 'package.json'), { name: PLUGIN, version: '0.2.4', medresearchWorkbench: { formatVersion: 1, manifest: 'market-assets.json' } });
  file(packageRoot, '医学研究工作台.html', '<!doctype html><title>isolated market fixture</title>');
  file(packageRoot, 'bridge/server.mjs', '// fixture bridge version one; never executed\n');
  file(packageRoot, 'vendor/pdfjs/pdf.min.js', '// isolated PDF fixture');
  file(packageRoot, 'fixtures/paper.pdf', '%PDF-isolated-test');
  file(packageRoot, 'src/core.js', '// isolated UI fixture');
  function manifest() {
    const assets = list(packageRoot).filter((path) => path !== 'package.json' && path !== 'market-assets.json' && !path.startsWith('assets/')).map((path) => {
      const bytes = readFileSync(join(packageRoot, path));
      return { path, source: path, size: bytes.length, sha256: hash(bytes) };
    });
    json(join(packageRoot, 'market-assets.json'), { formatVersion: 1, plugin: PLUGIN, version: readJson(join(packageRoot, 'package.json')).version, assets });
  }
  manifest();
  function deploy(options = {}) {
    return ensureMarketDeployment({ packageRoot, profileDir: profile, validateRoot: validateInstallationRoot,
      createRecord: createInstallationRecord, runtimeHash: pluginRuntimeHash, ...options });
  }
  const root = join(profile, 'medresearch-workbench');
  return { temp, profile, packageRoot, root, manifest, deploy };
}

test('root marker validates plugin identity and exact manifest name', (t) => {
  const f = fixture(t);
  assert.equal(isMarketPackageRoot(f.packageRoot), true);
  const pkg = readJson(join(f.packageRoot, 'package.json'));
  for (const bad of [{ ...pkg, name: 'other' }, { ...pkg, medresearchWorkbench: { formatVersion: 1, manifest: '../market-assets.json' } }]) {
    json(join(f.packageRoot, 'package.json'), bad);
    assert.equal(isMarketPackageRoot(f.packageRoot), false);
  }
});

test('first install copies assets outside node_modules, registers ownership and reuses without writes', (t) => {
  const f = fixture(t), first = f.deploy();
  assert.equal(first.ok, true, first.error);
  assert.equal(first.source, 'market-deployment');
  assert.equal(first.projectRoot, f.root);
  assert.equal(first.pluginDir, join(f.root, 'plugin'));
  assert.equal(existsSync(join(f.root, 'data')), false);
  assert.equal(readJson(join(f.root, OWNER)).profileDir, f.profile);
  const record = readJson(join(f.profile, RECORD));
  assert.equal(record.projectRoot, f.root);
  assert.equal(record.runtimeHash, pluginRuntimeHash(join(f.root, 'plugin')));
  const before = snapshot(f.profile);
  assert.equal(f.deploy().source, 'market-reuse');
  assert.deepEqual(snapshot(f.profile), before);
  assert.equal(existsSync(join(f.profile, LOCK)), false);
});

test('same-version reinstall survives replacement of its installed package and preserves user data', (t) => {
  const f = fixture(t);
  assert.equal(f.deploy().ok, true);
  file(f.root, 'data/workbench-data.json', '{"items":[{"id":"retained"}]}');
  file(f.root, 'data/uploads/owned.pdf', '%PDF-persisted');
  file(f.root, 'runtime/customer.json', '{"keep":true}');
  const before = snapshot(f.root);
  const replacement = join(f.temp, 'new-node-modules', PLUGIN);
  cpSync(f.packageRoot, replacement, { recursive: true });
  rmSync(f.packageRoot, { recursive: true });
  const result = f.deploy({ packageRoot: replacement });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.source, 'market-reuse');
  assert.deepEqual(snapshot(f.root), before);
});

test('valid legacy registration is reused across versions without touching registration or legacy files', (t) => {
  const f = fixture(t), legacy = join(f.temp, 'legacy-workspace');
  cpSync(f.packageRoot, legacy, { recursive: true });
  for (const name of ['package.json', 'dsh.plugin.json']) {
    const target = join(legacy, 'plugin', name);
    json(target, { ...readJson(target), version: '0.2.3' });
  }
  file(legacy, 'data/workbench-data.json', '{"items":[{"id":"legacy"}]}');
  json(join(f.profile, RECORD), createInstallationRecord(legacy, f.profile));
  const before = snapshot(legacy), registration = readFileSync(join(f.profile, RECORD));
  const result = f.deploy();
  assert.equal(result.ok, true, result.error);
  assert.equal(result.source, 'market-existing-workspace');
  assert.equal(result.projectRoot, legacy);
  assert.deepEqual(snapshot(legacy), before);
  assert.deepEqual(readFileSync(join(f.profile, RECORD)), registration);
  assert.equal(existsSync(f.root), false);
});

test('bad registrations never initialize an empty replacement workspace', (t) => {
  const f = fixture(t);
  for (const bytes of ['{invalid', JSON.stringify({ schemaVersion: 1, plugin: 'other' }), JSON.stringify({ schemaVersion: 1, plugin: PLUGIN, profileDir: f.profile, projectRoot: join(f.temp, 'missing') })]) {
    file(f.profile, RECORD, bytes);
    const result = f.deploy();
    assert.equal(result.ok, false);
    assert.equal(readFileSync(join(f.profile, RECORD), 'utf8'), bytes);
    assert.equal(existsSync(f.root), false);
  }
});

test('invalid manifest paths, protected data paths and duplicate paths are rejected before deployment', (t) => {
  const f = fixture(t), base = readJson(join(f.packageRoot, 'market-assets.json'));
  const asset = base.assets[0];
  for (const path of ['../escape', '/absolute', 'data/owned.json', 'RUNTIME/pid.json', 'vendor/../data/file', 'C:/escape', 'vendor\\escape', 'vendor/NUL', `${OWNER}/nested`]) {
    json(join(f.packageRoot, 'market-assets.json'), { ...base, assets: [...base.assets, { ...asset, path }] });
    assert.equal(f.deploy().ok, false, path);
    assert.equal(existsSync(f.root), false);
  }
  json(join(f.packageRoot, 'market-assets.json'), { ...base, assets: [...base.assets, asset] });
  assert.match(f.deploy().error, /重复|冲突/);
});

test('corrupted source bytes and unsafe links never replace existing resources', (t) => {
  const f = fixture(t);
  assert.equal(f.deploy().ok, true);
  const before = snapshot(f.profile);
  const manifest = readJson(join(f.packageRoot, 'market-assets.json'));
  manifest.assets.find((asset) => asset.path === 'src/core.js').sha256 = '0'.repeat(64);
  json(join(f.packageRoot, 'market-assets.json'), manifest);
  assert.match(f.deploy().error, /SHA-256/);
  assert.deepEqual(snapshot(f.profile), before);
  const source = join(f.packageRoot, 'src');
  const outside = join(f.temp, 'outside-source');
  cpSync(source, outside, { recursive: true });
  rmSync(source, { recursive: true });
  symlinkSync(outside, source, process.platform === 'win32' ? 'junction' : 'dir');
  assert.match(f.deploy().error, /链接/);
  assert.deepEqual(snapshot(f.profile), before);
});

test('unknown directories and foreign profile ownership are preserved', (t) => {
  const f = fixture(t);
  file(f.root, 'customer.txt', 'unknown contents');
  assert.equal(f.deploy().ok, false);
  assert.equal(readFileSync(join(f.root, 'customer.txt'), 'utf8'), 'unknown contents');
  assert.equal(existsSync(join(f.profile, RECORD)), false);
  rmSync(f.root, { recursive: true });
  assert.equal(f.deploy().ok, true);
  const owner = readJson(join(f.root, OWNER));
  json(join(f.root, OWNER), { ...owner, profileDir: join(f.temp, 'other-profile') });
  const before = snapshot(f.profile);
  assert.equal(f.deploy().ok, false);
  assert.deepEqual(snapshot(f.profile), before);
});

test('deployment lock rejects overlapping installs without deleting the other owner lock', (t) => {
  const f = fixture(t);
  const lock = { plugin: PLUGIN, profileDir: f.profile, pid: process.pid, token: 'other-installer' };
  json(join(f.profile, LOCK), lock);
  const result = f.deploy();
  assert.equal(result.ok, false);
  assert.match(result.error, /部署锁/);
  assert.deepEqual(readJson(join(f.profile, LOCK)), lock);
  assert.equal(existsSync(f.root), false);
});

test('a second installer entering during staged validation cannot publish or steal the first lock', (t) => {
  const f = fixture(t);
  let overlapping;
  const result = f.deploy({ validateRoot: (root) => {
    if (!overlapping) overlapping = f.deploy();
    return validateInstallationRoot(root);
  } });
  assert.equal(result.ok, true, result.error);
  assert.equal(overlapping.ok, false);
  assert.match(overlapping.error, /部署锁/);
  assert.equal(existsSync(join(f.profile, LOCK)), false);
  assert.equal(f.deploy().source, 'market-reuse');
});

test('gzip payload is decompressed and verified using the uncompressed size and SHA-256', (t) => {
  const f = fixture(t), bytes = Buffer.from('isolated compressed asset');
  file(f.packageRoot, 'assets/test.gz', gzipSync(bytes));
  const manifest = readJson(join(f.packageRoot, 'market-assets.json'));
  manifest.assets.push({ path: 'vendor/compressed.bin', source: 'assets/test.gz', size: bytes.length, sha256: hash(bytes), compression: 'gzip' });
  json(join(f.packageRoot, 'market-assets.json'), manifest);
  const result = f.deploy();
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(readFileSync(join(f.root, 'vendor/compressed.bin')), bytes);
});

test('BioMCP rejects a manifest that substitutes the pinned official executable', (t) => {
  const f = fixture(t), manifest = readJson(join(f.packageRoot, 'market-assets.json'));
  manifest.assets.push({ path: 'tools/biomcp.exe', source: 'assets/test.gz', size: 12, sha256: 'a'.repeat(64), compression: 'gzip' });
  json(join(f.packageRoot, 'market-assets.json'), manifest);
  assert.match(f.deploy().error, /BioMCP 官方/);
  assert.equal(existsSync(f.root), false);
});

test('managed upgrade updates only declared runtime assets and preserves data, uploads and backups', (t) => {
  const f = fixture(t);
  assert.equal(f.deploy().ok, true);
  for (const [path, bytes] of [['data/workbench-data.json', '{"keep":true}'], ['data/uploads/paper.pdf', '%PDF-retained'], ['data/backups/old.json', '{"backup":true}'], ['logs/a.log', 'retained log'], ['runtime/customer.json', '{}']]) file(f.root, path, bytes);
  const protectedBefore = Object.fromEntries(['data', 'logs', 'runtime'].map((path) => [path, snapshot(join(f.root, path))]));
  file(f.packageRoot, 'src/core.js', '// upgraded isolated UI fixture');
  f.manifest();
  const result = f.deploy();
  assert.equal(result.ok, true, result.error);
  assert.equal(readFileSync(join(f.root, 'src/core.js'), 'utf8'), '// upgraded isolated UI fixture');
  for (const path of ['data', 'logs', 'runtime']) assert.deepEqual(snapshot(join(f.root, path)), protectedBefore[path]);
  assert.equal(f.deploy().source, 'market-reuse');
});

test('changed bridge code refuses upgrade while the recorded process is still alive', (t) => {
  const f = fixture(t);
  assert.equal(f.deploy().ok, true);
  json(join(f.root, 'runtime/bridge-service.json'), { service: 'medresearch-workbench-bridge', projectRoot: f.root, pid: process.pid, port: 1 });
  const before = snapshot(f.profile);
  file(f.packageRoot, 'bridge/server.mjs', '// changed bridge code');
  f.manifest();
  const result = f.deploy();
  assert.equal(result.ok, false);
  assert.match(result.error, /先停止旧本地服务/);
  assert.deepEqual(snapshot(f.profile), before);
});

test('record creation failure rolls back all upgraded resources and keeps customer files', (t) => {
  const f = fixture(t);
  assert.equal(f.deploy().ok, true);
  file(f.root, 'data/uploads/retained.pdf', '%PDF-unchanged');
  const before = snapshot(f.profile);
  file(f.packageRoot, 'src/core.js', '// a failing upgrade');
  f.manifest();
  const result = f.deploy({ createRecord: () => { throw new Error('intentional record failure'); } });
  assert.equal(result.ok, false);
  assert.match(result.error, /intentional record failure/);
  assert.deepEqual(snapshot(f.profile), before);
});

test('record creation failure during first install publishes neither the workspace nor a registration', (t) => {
  const f = fixture(t);
  const result = f.deploy({ createRecord: () => { throw new Error('intentional first-registration failure'); } });
  assert.equal(result.ok, false);
  assert.equal(existsSync(f.root), false);
  assert.equal(existsSync(join(f.profile, RECORD)), false);
  assert.equal(existsSync(join(f.profile, LOCK)), false);
  assert.deepEqual(readdirSync(f.profile), []);
});

test('same-manifest reuse rejects an ownership marker that no longer lists the declared assets', (t) => {
  const f = fixture(t);
  assert.equal(f.deploy().ok, true);
  const owner = readJson(join(f.root, OWNER));
  owner.assets.pop();
  json(join(f.root, OWNER), owner);
  const before = snapshot(f.profile);
  assert.match(f.deploy().error, /所有权标记与资源清单不一致/);
  assert.deepEqual(snapshot(f.profile), before);
});

test('same-version modified deployed files are rejected rather than overwritten', (t) => {
  const f = fixture(t);
  assert.equal(f.deploy().ok, true);
  file(f.root, 'src/core.js', '// customer changed runtime code');
  const before = snapshot(f.profile);
  assert.match(f.deploy().error, /已被修改/);
  assert.deepEqual(snapshot(f.profile), before);
});

test('deployment rejects source targets or existing directories that escape through junctions', (t) => {
  const f = fixture(t), outside = join(f.temp, 'outside-workspace');
  mkdirSync(outside);
  file(outside, 'keep.txt', 'preserved outside root');
  symlinkSync(outside, f.root, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(f.deploy().ok, false);
  assert.equal(lstatSync(f.root).isSymbolicLink(), true);
  assert.equal(readFileSync(join(outside, 'keep.txt'), 'utf8'), 'preserved outside root');
});
