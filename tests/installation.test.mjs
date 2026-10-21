import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import {
  createInstallationRecord,
  installationRecordPath,
  resolveHostInstallation,
  resolveInstallation,
  validateInstallationRoot,
} from '../plugin/src/host/installation.js';

const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = 'dsh-medresearch-model';
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
function copyTree(source, destination) {
  const stat = lstatSync(source);
  assert.equal(stat.isSymbolicLink(), false);
  if (stat.isDirectory()) {
    mkdirSync(destination, { recursive: true });
    for (const name of readdirSync(source)) copyTree(join(source, name), join(destination, name));
  } else {
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
}
function copyPlugin(root, destination) {
  copyTree(join(root, 'plugin'), destination);
}
function json(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
function fixture(t) {
  const temp = mkdtempSync(join(tmpdir(), 'medwb-installation-test-'));
  t.after(() => {
    assert.ok(resolve(temp).startsWith(resolve(tmpdir()) + sep));
    assert.ok(temp.includes('medwb-installation-test-'));
    rmSync(temp, { recursive: true, force: true });
  });
  function customer(name) {
    const root = join(temp, name);
    mkdirSync(join(root, 'bridge'), { recursive: true });
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, '医学研究工作台.html'), '<!doctype html><title>isolated fixture</title>');
    writeFileSync(join(root, 'bridge/server.mjs'), '// fixture only; never executed\n');
    for (const entry of ['package.json', 'dsh.plugin.json', 'cordis.patch.yml', 'lib', 'src']) {
      copyTree(join(SOURCE, 'plugin', entry), join(root, 'plugin', entry));
    }
    copyTree(join(SOURCE, 'scripts/install-model-plugin.mjs'), join(root, 'scripts/install-model-plugin.mjs'));
    return root;
  }
  function profile(name = 'profile') {
    const root = join(temp, name);
    json(join(root, 'package.json'), { private: true, dependencies: { 'dsh-worktable': '0.4.0', 'other-plugin': '1.0.0' }, dsh: { profile: { bundles: ['other-plugin', 'dsh-worktable'] } }, customerField: { retained: true } });
    json(join(root, 'node_modules/dsh-worktable/package.json'), { name: 'dsh-worktable', version: '0.4.0' });
    return root;
  }
  return { temp, customer, profile };
}
function moduleUrl(root) {
  return pathToFileURL(join(root, 'plugin/src/host/installation.js')).href;
}
function register(root, profile) {
  const record = createInstallationRecord(root, profile);
  json(installationRecordPath(profile), record);
  return record;
}
function install(root, profile, ...args) {
  const result = spawnSync(process.execPath, [join(root, 'scripts/install-model-plugin.mjs'), '--profile', profile, ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.error, undefined);
  return { ...result, output: result.stdout + result.stderr };
}
function expectSuccess(result) {
  assert.equal(result.status, 0, result.output);
}
function layoutSnapshot(profile) {
  const link = join(profile, 'node_modules', PLUGIN);
  return {
    manifest: readFileSync(join(profile, 'package.json'), 'utf8'),
    record: existsSync(installationRecordPath(profile)) ? readFileSync(installationRecordPath(profile), 'utf8') : null,
    link: lstatSync(link).isSymbolicLink() ? readlinkSync(link) : 'physical-copy',
  };
}
function treeSnapshot(root) {
  const files = {};
  function visit(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) visit(join(directory, entry.name), relative + '/');
      else files[relative] = createHash('sha256').update(readFileSync(join(directory, entry.name))).digest('hex');
    }
  }
  visit(root);
  return files;
}
function physicalInstall(root, profile, version) {
  if (version) {
    const pkg = readJson(join(root, 'plugin/package.json'));
    const descriptor = readJson(join(root, 'plugin/dsh.plugin.json'));
    json(join(root, 'plugin/package.json'), { ...pkg, version });
    json(join(root, 'plugin/dsh.plugin.json'), { ...descriptor, version });
  }
  const target = join(profile, 'node_modules', PLUGIN);
  copyPlugin(root, target);
  const manifest = readJson(join(profile, 'package.json'));
  manifest.dependencies[PLUGIN] = `file:${join(root, 'plugin').replaceAll('\\', '/')}`;
  manifest.dsh.profile.bundles.push(PLUGIN);
  json(join(profile, 'package.json'), manifest);
  return target;
}
function lastBackup(profile) {
  const name = readdirSync(profile).filter((entry) => entry.startsWith('.medresearch-model-backup-')).sort().at(-1);
  return join(profile, name);
}

test('original module location is validated without a registration or guessed profile', (t) => {
  const f = fixture(t), root = f.customer('original');
  const result = resolveInstallation({ moduleUrl: moduleUrl(root) });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.projectRoot, root);
  assert.equal(result.profileDir, '');
  assert.equal(result.source, 'module-realpath');
  rmSync(join(root, 'bridge/server.mjs'));
  assert.equal(resolveInstallation({ moduleUrl: moduleUrl(root) }).ok, false);
});

test('junction and preserve-symlinks loading both resolve the physical full delivery', (t) => {
  const f = fixture(t), root = f.customer('original'), profile = f.profile();
  const link = join(profile, 'node_modules', PLUGIN);
  symlinkSync(join(root, 'plugin'), link, process.platform === 'win32' ? 'junction' : 'dir');
  const url = pathToFileURL(join(link, 'src/host/installation.js')).href;
  assert.equal(resolveInstallation({ moduleUrl: url, profileDir: profile }).projectRoot, root);
  const script = `import {resolveInstallation} from ${JSON.stringify(url)}; console.log(JSON.stringify(resolveInstallation()));`;
  const output = execFileSync(process.execPath, ['--preserve-symlinks', '--input-type=module', '-e', script], { encoding: 'utf8', windowsHide: true });
  assert.equal(JSON.parse(output).projectRoot, root);
});

test('a physical node_modules copy uses only the current profile registration', (t) => {
  const f = fixture(t), root = f.customer('original'), profile = f.profile();
  const copy = join(profile, 'node_modules', PLUGIN);
  copyPlugin(root, copy);
  register(root, profile);
  const url = pathToFileURL(join(copy, 'src/host/installation.js')).href;
  const result = resolveHostInstallation({ get: (name) => name === 'profileContext' ? { dir: profile } : null }, { moduleUrl: url });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.projectRoot, root);
  assert.equal(result.source, 'registration');
  assert.equal(resolveInstallation({ moduleUrl: url }).ok, false);
  const other = f.profile('other-profile');
  copyTree(installationRecordPath(profile), installationRecordPath(other));
  assert.match(resolveInstallation({ moduleUrl: url, profileDir: other }).error, /当前 profile/);
});

test('missing, invalid and expired records fail with a repair instruction and no root', (t) => {
  const f = fixture(t), root = f.customer('original'), profile = f.profile();
  const copy = join(profile, 'node_modules', PLUGIN);
  copyPlugin(root, copy);
  const options = { moduleUrl: pathToFileURL(join(copy, 'src/host/installation.js')).href, profileDir: profile };
  for (const record of [null, '{invalid', JSON.stringify({ schemaVersion: 1, plugin: 'other' })]) {
    if (record !== null) writeFileSync(installationRecordPath(profile), record);
    const result = resolveInstallation(options);
    assert.equal(result.ok, false);
    assert.equal(result.projectRoot, '');
    assert.match(result.error, /完整客户目录执行安装脚本/);
  }
  register(root, profile);
  renameSync(root, root + '-moved');
  const result = resolveInstallation(options);
  assert.equal(result.ok, false);
  assert.match(result.error, /过期/);
});

test('root validation rejects node_modules and a wrong plugin identity', (t) => {
  const f = fixture(t), root = f.customer('original');
  const wrong = f.customer('node_modules/impostor');
  assert.equal(validateInstallationRoot(wrong).ok, false);
  const pkg = readJson(join(root, 'plugin/package.json'));
  json(join(root, 'plugin/package.json'), { ...pkg, name: 'other-plugin' });
  assert.equal(validateInstallationRoot(root).ok, false);
});

test('same-version stale code is preserved completely before upgrading to a junction', (t) => {
  const f = fixture(t), root = f.customer('original'), profile = f.profile();
  const copy = join(profile, 'node_modules', PLUGIN);
  copyPlugin(root, copy);
  register(root, profile);
  writeFileSync(join(copy, 'lib/index.js'), '// different code with the same version\n');
  const originalTree = treeSnapshot(copy);
  const result = resolveInstallation({ moduleUrl: pathToFileURL(join(copy, 'src/host/installation.js')).href, profileDir: profile });
  assert.equal(result.ok, false);
  assert.match(result.error, /运行代码/);
  const installed = install(root, profile);
  expectSuccess(installed);
  assert.match(installed.output, /旧实体插件已完整保全/);
  assert.equal(lstatSync(copy).isSymbolicLink(), true);
  assert.deepEqual(treeSnapshot(join(lastBackup(profile), 'plugin-copy')), originalTree);
  expectSuccess(install(root, profile, '--verify'));
});

test('install and repeat verify register the full root without changing other plugins', (t) => {
  const f = fixture(t), root = f.customer('original'), profile = f.profile();
  const before = readJson(join(profile, 'package.json'));
  expectSuccess(install(root, profile));
  const saved = layoutSnapshot(profile);
  const count = readdirSync(profile).filter((name) => name.startsWith('.medresearch-model-backup-')).length;
  expectSuccess(install(root, profile));
  expectSuccess(install(root, profile, '--verify'));
  assert.deepEqual(layoutSnapshot(profile), saved);
  assert.equal(readdirSync(profile).filter((name) => name.startsWith('.medresearch-model-backup-')).length, count);
  const after = readJson(join(profile, 'package.json'));
  assert.equal(after.dependencies['other-plugin'], before.dependencies['other-plugin']);
  assert.deepEqual(after.customerField, before.customerField);
  assert.deepEqual(after.dsh.profile.bundles.filter((name) => name !== PLUGIN), before.dsh.profile.bundles);
  assert.equal(readJson(installationRecordPath(profile)).projectRoot, root);
});

test('a matching physical copy is retained and can be registered and verified', (t) => {
  const f = fixture(t), root = f.customer('original'), profile = f.profile();
  const copy = join(profile, 'node_modules', PLUGIN);
  copyPlugin(root, copy);
  expectSuccess(install(root, profile));
  expectSuccess(install(root, profile, '--verify'));
  assert.equal(lstatSync(copy).isSymbolicLink(), false);
  assert.equal(resolveInstallation({ moduleUrl: pathToFileURL(join(copy, 'src/host/installation.js')).href, profileDir: profile }).projectRoot, root);
});

test('moved delivery reinstalls a dangling junction and updates its registration', (t) => {
  const f = fixture(t), root = f.customer('original'), profile = f.profile();
  expectSuccess(install(root, profile));
  const moved = root + '-moved';
  renameSync(root, moved);
  expectSuccess(install(moved, profile));
  assert.equal(readJson(installationRecordPath(profile)).projectRoot, moved);
  expectSuccess(install(moved, profile, '--verify'));
  const before = layoutSnapshot(profile);
  const result = install(moved, profile, '--rollback');
  assert.notEqual(result.status, 0);
  assert.match(result.output, /旧版本目录不存在/);
  assert.deepEqual(layoutSnapshot(profile), before);
});

test('rollback restores only this plugin registration and keeps later other-plugin changes', (t) => {
  const f = fixture(t), first = f.customer('first'), second = f.customer('second'), profile = f.profile();
  expectSuccess(install(first, profile));
  const firstRecord = readFileSync(installationRecordPath(profile), 'utf8');
  expectSuccess(install(second, profile));
  const manifest = readJson(join(profile, 'package.json'));
  manifest.dependencies['later-plugin'] = '2.0.0';
  manifest.dsh.profile.bundles.push('later-plugin');
  json(join(profile, 'package.json'), manifest);
  expectSuccess(install(second, profile, '--rollback'));
  assert.equal(readFileSync(installationRecordPath(profile), 'utf8'), firstRecord);
  const restored = readJson(join(profile, 'package.json'));
  assert.equal(restored.dependencies['later-plugin'], '2.0.0');
  assert.ok(restored.dsh.profile.bundles.includes('later-plugin'));
  expectSuccess(install(first, profile, '--verify'));
});

test('first install rollback removes only its registration and plugin entry', (t) => {
  const f = fixture(t), root = f.customer('original'), profile = f.profile();
  const original = readJson(join(profile, 'package.json'));
  expectSuccess(install(root, profile));
  expectSuccess(install(root, profile, '--rollback'));
  assert.deepEqual(readJson(join(profile, 'package.json')), original);
  assert.equal(existsSync(installationRecordPath(profile)), false);
  assert.equal(existsSync(join(profile, 'node_modules', PLUGIN)), false);
});

test('default profile respects DSH_HOME rather than the real desktop profile', (t) => {
  const f = fixture(t), root = f.customer('original'), profile = f.profile('isolated-home/profiles/desktop');
  const result = spawnSync(process.execPath, [join(root, 'scripts/install-model-plugin.mjs')], { encoding: 'utf8', windowsHide: true, env: { ...process.env, DSH_HOME: join(f.temp, 'isolated-home') } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readJson(installationRecordPath(profile)).profileDir, profile);
});

test('filesystem commit failures restore this plugin while preserving later unrelated configuration', async (t) => {
  for (const failFile of ['package.json', '.medresearch-workbench-installation.json']) {
    await t.test(failFile, (t) => {
      const f = fixture(t), first = f.customer('first'), second = f.customer('second'), profile = f.profile();
      expectSuccess(install(first, profile));
      const before = layoutSnapshot(profile);
      const preload = join(f.temp, 'injected-filesystem-failure.mjs');
      writeFileSync(preload, `import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const original = fs.renameSync;
let injected = false;
fs.renameSync = (source, destination) => {
  if (!injected && destination === ${JSON.stringify(join(profile, failFile))}) {
    injected = true;
    const manifestFile = ${JSON.stringify(join(profile, 'package.json'))};
    const current = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    current.dependencies['concurrent-other-plugin'] = '3.0.0';
    current.dsh.profile.bundles.push('concurrent-other-plugin');
    fs.writeFileSync(manifestFile, JSON.stringify(current, null, 2) + '\\n');
    throw new Error('injected fixture-only filesystem failure');
  }
  return original(source, destination);
};
syncBuiltinESMExports();
`);
      const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(second, 'scripts/install-model-plugin.mjs'), '--profile', profile], { encoding: 'utf8', windowsHide: true });
      assert.notEqual(result.status, 0);
      assert.match(result.stdout + result.stderr, /安装状态提交失败/);
      const after = layoutSnapshot(profile);
      assert.equal(after.link, before.link);
      assert.equal(after.record, before.record);
      const manifest = readJson(join(profile, 'package.json'));
      assert.equal(manifest.dependencies[PLUGIN], JSON.parse(before.manifest).dependencies[PLUGIN]);
      assert.equal(manifest.dependencies['concurrent-other-plugin'], '3.0.0');
      assert.ok(manifest.dsh.profile.bundles.includes('concurrent-other-plugin'));
      expectSuccess(install(first, profile, '--verify'));
    });
  }
});

test('installer treats spaces and shell metacharacters as literal filesystem paths', (t) => {
  const f = fixture(t), root = f.customer('delivery with spaces & symbols'), profile = f.profile('profile with spaces & symbols');
  expectSuccess(install(root, profile));
  expectSuccess(install(root, profile, '--verify'));
  expectSuccess(install(root, profile, '--rollback'));
  assert.equal(existsSync(join(root, '医学研究工作台.html')), true);
});

test('0.2.2 physical installation upgrades to 0.2.3 and rollback restores its exact directory and registration', (t) => {
  const f = fixture(t), old = f.customer('old'), current = f.customer('new'), profile = f.profile();
  assert.equal(readJson(join(current, 'plugin/package.json')).version, '0.2.3');
  // 0.2.2 没有新的安装定位模块，升级身份检查不能依赖它存在。
  rmSync(join(old, 'plugin/src/host/installation.js'));
  const target = physicalInstall(old, profile, '0.2.2');
  const original = treeSnapshot(target), before = layoutSnapshot(profile);
  const result = install(current, profile);
  expectSuccess(result);
  assert.match(result.output, /旧实体插件已完整保全（未删除）/);
  const backup = lastBackup(profile);
  assert.deepEqual(treeSnapshot(join(backup, 'plugin-copy')), original);
  assert.equal(lstatSync(target).isSymbolicLink(), true);
  assert.equal(readJson(join(target, 'package.json')).version, '0.2.3');
  expectSuccess(install(current, profile, '--verify'));
  const manifest = readJson(join(profile, 'package.json'));
  manifest.dependencies['later-plugin'] = '2.0.0';
  manifest.dsh.profile.bundles.push('later-plugin');
  json(join(profile, 'package.json'), manifest);
  expectSuccess(install(current, profile, '--rollback'));
  assert.equal(lstatSync(target).isSymbolicLink(), false);
  assert.deepEqual(treeSnapshot(target), original);
  assert.equal(existsSync(installationRecordPath(profile)), false);
  const after = readJson(join(profile, 'package.json'));
  assert.equal(after.dependencies[PLUGIN], JSON.parse(before.manifest).dependencies[PLUGIN]);
  assert.equal(after.dependencies['later-plugin'], '2.0.0');
  assert.ok(after.dsh.profile.bundles.includes('later-plugin'));
});

test('an obsolete same-version physical package restores its original registration on rollback', (t) => {
  const f = fixture(t), old = f.customer('old'), current = f.customer('new'), profile = f.profile();
  writeFileSync(join(old, 'plugin/lib/index.js'), '// previous revision with same version\n');
  const target = physicalInstall(old, profile);
  register(old, profile);
  const before = layoutSnapshot(profile), original = treeSnapshot(target);
  expectSuccess(install(current, profile));
  assert.equal(lstatSync(target).isSymbolicLink(), true);
  expectSuccess(install(current, profile, '--rollback'));
  assert.deepEqual(layoutSnapshot(profile), before);
  assert.deepEqual(treeSnapshot(target), original);
});

test('unknown marker directories and wrong-plugin packages are rejected without any changes', (t) => {
  for (const kind of ['marker-only', 'wrong-identity', 'extra-marker', 'nested-marker']) {
    const f = fixture(t), current = f.customer('new'), profile = f.profile();
    const target = join(profile, 'node_modules', PLUGIN);
    if (kind === 'marker-only') {
      mkdirSync(target);
      writeFileSync(join(target, 'customer-marker.txt'), 'keep this unknown directory');
    } else {
      copyPlugin(current, target);
      if (kind === 'wrong-identity') {
        const descriptor = readJson(join(target, 'dsh.plugin.json'));
        json(join(target, 'dsh.plugin.json'), { ...descriptor, name: 'other-plugin' });
      } else if (kind === 'extra-marker') writeFileSync(join(target, 'customer-marker.txt'), 'keep marker');
      else writeFileSync(join(target, 'src/host/customer-marker.txt'), 'keep marker');
    }
    const before = layoutSnapshot(profile), original = treeSnapshot(target);
    const result = install(current, profile);
    assert.notEqual(result.status, 0, kind);
    assert.deepEqual(layoutSnapshot(profile), before, kind);
    assert.deepEqual(treeSnapshot(target), original, kind);
    assert.equal(readdirSync(profile).some((name) => name.startsWith('.medresearch-model-backup-')), false);
  }
});

test('entity move refuses node_modules whose resolved path is outside the current profile', (t) => {
  const f = fixture(t), old = f.customer('old'), current = f.customer('new'), profile = f.profile();
  physicalInstall(old, profile, '0.2.2');
  const outside = join(f.temp, 'outside-node-modules');
  renameSync(join(profile, 'node_modules'), outside);
  symlinkSync(outside, join(profile, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const before = layoutSnapshot(profile), original = treeSnapshot(join(outside, PLUGIN));
  const result = install(current, profile);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /实际路径不在当前 profile/);
  assert.deepEqual(layoutSnapshot(profile), before);
  assert.deepEqual(treeSnapshot(join(outside, PLUGIN)), original);
});

test('a missing old asset directory blocks physical rollback without changing the working new installation', (t) => {
  const f = fixture(t), old = f.customer('old'), current = f.customer('new'), profile = f.profile();
  physicalInstall(old, profile, '0.2.2');
  expectSuccess(install(current, profile));
  const backup = join(lastBackup(profile), 'plugin-copy'), saved = treeSnapshot(backup);
  renameSync(old, old + '-moved-away');
  const before = layoutSnapshot(profile);
  const result = install(current, profile, '--rollback');
  assert.notEqual(result.status, 0);
  assert.match(result.output, /旧版本目录不存在/);
  assert.deepEqual(layoutSnapshot(profile), before);
  assert.deepEqual(treeSnapshot(backup), saved);
});

test('failed entity replacement restores the entire original directory and exact registration', (t) => {
  const f = fixture(t), old = f.customer('old'), current = f.customer('new'), profile = f.profile();
  const target = physicalInstall(old, profile, '0.2.2');
  register(old, profile);
  const before = layoutSnapshot(profile), original = treeSnapshot(target);
  const preload = join(f.temp, 'entity-upgrade-failure.mjs');
  writeFileSync(preload, `import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const rename = fs.renameSync;
let failed = false;
fs.renameSync = (source, destination) => {
  if (!failed && destination === ${JSON.stringify(join(profile, 'package.json'))}) {
    failed = true;
    throw new Error('fixture failure after entity preservation');
  }
  return rename(source, destination);
};
syncBuiltinESMExports();
`);
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(current, 'scripts/install-model-plugin.mjs'), '--profile', profile], { encoding: 'utf8', windowsHide: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /安装状态提交失败/);
  assert.deepEqual(layoutSnapshot(profile), before);
  assert.deepEqual(treeSnapshot(target), original);
  assert.equal(lstatSync(target).isSymbolicLink(), false);
});

test('failed physical rollback returns the entity to its backup and restores the new junction', (t) => {
  const f = fixture(t), old = f.customer('old'), current = f.customer('new'), profile = f.profile();
  physicalInstall(old, profile, '0.2.2');
  register(old, profile);
  expectSuccess(install(current, profile));
  const before = layoutSnapshot(profile), backup = join(lastBackup(profile), 'plugin-copy'), saved = treeSnapshot(backup);
  const preload = join(f.temp, 'entity-rollback-failure.mjs');
  writeFileSync(preload, `import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const rename = fs.renameSync;
let failed = false;
fs.renameSync = (source, destination) => {
  if (!failed && destination === ${JSON.stringify(installationRecordPath(profile))}) {
    failed = true;
    throw new Error('fixture rollback commit failure');
  }
  return rename(source, destination);
};
syncBuiltinESMExports();
`);
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(current, 'scripts/install-model-plugin.mjs'), '--profile', profile, '--rollback'], { encoding: 'utf8', windowsHide: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /安装状态提交失败/);
  assert.deepEqual(layoutSnapshot(profile), before);
  assert.deepEqual(treeSnapshot(backup), saved);
  expectSuccess(install(current, profile, '--verify'));
});
