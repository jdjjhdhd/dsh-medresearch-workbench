import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createInstallationRecord, INSTALLATION_FILENAME } from '../plugin/src/host/installation.js';
import { assertSystemNode, prepareMarketInstall, restoreMarketInstall } from '../scripts/prepare-market-install.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts/prepare-market-install.mjs');
const PLUGIN = 'dsh-medresearch-model';
const quiet = () => {};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const exists = (file) => { try { lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };

function put(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof value === 'object' && !Buffer.isBuffer(value) ? `${JSON.stringify(value, null, 2)}\n` : value);
}

function tree(root) {
  const entries = {};
  function visit(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`;
      assert.equal(entry.isSymbolicLink(), false, path);
      if (entry.isDirectory()) { entries[`${path}/`] = 'directory'; visit(join(directory, entry.name), `${path}/`); }
      else entries[path] = hash(readFileSync(join(directory, entry.name)));
    }
  }
  visit(root);
  return entries;
}

function fixture(t) {
  const temp = mkdtempSync(join(tmpdir(), 'medwb-market-migration-'));
  t.after(() => {
    const absolute = resolve(temp);
    assert.ok(absolute.startsWith(resolve(tmpdir()) + sep) && absolute.includes('medwb-market-migration-'));
    rmSync(absolute, { recursive: true, force: true });
  });
  const dshHome = join(temp, 'dsh-home');
  const profile = join(dshHome, 'profiles', 'desktop');
  const root = join(temp, 'old-workbench');
  const pluginDir = join(root, 'plugin');
  const modules = join(profile, 'node_modules');
  const link = join(modules, PLUGIN);
  function customer(target = root) {
    put(join(target, '医学研究工作台.html'), '<!doctype html><title>Synthetic workbench</title>');
    put(join(target, 'bridge/server.mjs'), '// fixture, never executed\n');
    put(join(target, 'plugin/package.json'), { name: PLUGIN, version: '0.2.3', type: 'module', main: 'lib/index.js' });
    put(join(target, 'plugin/dsh.plugin.json'), { name: PLUGIN, version: '0.2.3', entry: { name: PLUGIN } });
    put(join(target, 'plugin/cordis.patch.yml'), '- insert:\n    - id: medresearch-model\n      name: dsh-medresearch-model\n');
    for (const file of ['lib/index.js', 'lib/client.js', 'src/host/constants.js', 'src/host/routes.js', 'src/host/service.js']) {
      put(join(target, 'plugin', file), `// synthetic ${file}\n`);
    }
    put(join(target, 'plugin/README.md'), 'Synthetic plugin license and description\n');
    mkdirSync(join(target, 'plugin/src/empty'), { recursive: true });
    put(join(target, 'data/library.json'), { items: [{ id: 'saved-paper', title: 'Synthetic saved paper' }] });
    put(join(target, 'data/uploads/saved.pdf'), '%PDF-synthetic-fixture');
    return target;
  }
  customer();
  put(join(profile, 'package.json'), {
    private: true, dependencies: { [PLUGIN]: `file:${pluginDir.replaceAll('\\', '/')}`, 'other-plugin': '1.0.0' },
    dsh: { profile: { bundles: ['other-plugin', PLUGIN] } }, customerField: 'retained',
  });
  put(join(profile, 'pnpm-lock.yaml'), '# synthetic lockfile retained byte for byte\n');
  put(join(modules, 'other-plugin/package.json'), { name: 'other-plugin', version: '1.0.0' });
  put(join(modules, 'other-plugin/config.txt'), 'other plugin retained\n');
  const registration = join(profile, INSTALLATION_FILENAME);
  put(registration, createInstallationRecord(root, profile));
  symlinkSync(pluginDir, link, process.platform === 'win32' ? 'junction' : 'dir');
  const messages = [];
  const prepare = (options = {}) => prepareMarketInstall({ profileDir: profile, log: (message) => messages.push(message), ...options });
  const restore = (backupDir, options = {}) => restoreMarketInstall({ profileDir: profile, backupDir, log: quiet, ...options });
  const stable = () => ({ workbench: tree(root), other: tree(join(modules, 'other-plugin')),
    manifest: hash(readFileSync(join(profile, 'package.json'))), lock: hash(readFileSync(join(profile, 'pnpm-lock.yaml'))),
    registration: hash(readFileSync(registration)) });
  return { temp, dshHome, profile, root, pluginDir, modules, link, registration, customer, messages, prepare, restore, stable };
}

test('准备市场安装只解除旧 junction，完整备份插件与登记且保留所有资料/其他配置', (t) => {
  const f = fixture(t);
  const before = f.stable();
  const result = f.prepare();
  assert.equal(result.status, 'prepared');
  assert.equal(exists(f.link), false);
  assert.deepEqual(f.stable(), before);
  assert.equal(dirname(realpathSync(result.backupDir)), realpathSync(f.profile));
  assert.match(result.backupDir, /\.medresearch-market-migration-/u);
  assert.deepEqual(readdirSync(result.backupDir).sort(), [INSTALLATION_FILENAME, 'migration.json', 'plugin'].sort());
  assert.deepEqual(tree(join(result.backupDir, 'plugin')), tree(f.pluginDir));
  assert.equal(readFileSync(join(result.backupDir, INSTALLATION_FILENAME), 'utf8'), readFileSync(f.registration, 'utf8'));
  const metadata = json(join(result.backupDir, 'migration.json'));
  assert.equal(metadata.treeSha256, result.treeSha256);
  assert.equal(metadata.registrationSha256, before.registration);
  assert.equal(exists(join(result.backupDir, 'data')), false);
  assert.ok(f.messages.includes('原工作台与资料保留，返回市场安装，完成后再重启DSH'));
});

test('重复准备给出可读提示，不再创建备份或修改任何外部文件', (t) => {
  const f = fixture(t);
  f.prepare();
  const before = f.stable();
  const backups = readdirSync(f.profile).filter((name) => name.startsWith('.medresearch-market-migration-'));
  assert.equal(f.prepare().status, 'no-link');
  assert.deepEqual(f.stable(), before);
  assert.deepEqual(readdirSync(f.profile).filter((name) => name.startsWith('.medresearch-market-migration-')), backups);
  assert.match(f.messages.at(-1), /无需重复处理/u);
});

test('链接到另一个同身份插件目录也拒绝，不能仅凭 package name 解除', (t) => {
  const f = fixture(t);
  const wrong = f.customer(join(f.temp, 'wrong-workbench'));
  unlinkSync(f.link);
  symlinkSync(join(wrong, 'plugin'), f.link, process.platform === 'win32' ? 'junction' : 'dir');
  const before = f.stable();
  const wrongBefore = tree(wrong);
  assert.throws(() => f.prepare(), /junction 目标与安装登记不匹配/u);
  assert.equal(lstatSync(f.link).isSymbolicLink(), true);
  assert.deepEqual(f.stable(), before);
  assert.deepEqual(tree(wrong), wrongBefore);
});

for (const [label, mutate] of [
  ['错误 profile', (record, f) => { record.profileDir = f.temp; }],
  ['错误 schema', (record) => { record.schemaVersion = 2; }],
  ['错误运行哈希', (record) => { record.runtimeHash = '0'.repeat(64); }],
  ['错误工作台根', (record, f) => { record.projectRoot = f.profile; }],
  ['错误插件目录', (record, f) => { record.pluginDir = f.root; }],
]) {
  test(`${label}登记拒绝解除，保留链接和原数据`, (t) => {
    const f = fixture(t);
    const record = json(f.registration);
    mutate(record, f);
    put(f.registration, record);
    const before = f.stable();
    assert.throws(() => f.prepare());
    assert.equal(lstatSync(f.link).isSymbolicLink(), true);
    assert.deepEqual(f.stable(), before);
    assert.equal(readdirSync(f.profile).some((name) => name.startsWith('.medresearch-market-migration-')), false);
  });
}

test('profile file: 依赖与登记不匹配时拒绝解除', (t) => {
  const f = fixture(t);
  const metadata = json(join(f.profile, 'package.json'));
  metadata.dependencies[PLUGIN] = '1.0.0';
  put(join(f.profile, 'package.json'), metadata);
  const before = f.stable();
  assert.throws(() => f.prepare(), /file: 依赖与安装登记不匹配/u);
  assert.equal(lstatSync(f.link).isSymbolicLink(), true);
  assert.deepEqual(f.stable(), before);
});

test('备份复制失败时保留旧链接，部分备份保留供排查', (t) => {
  const f = fixture(t);
  const before = f.stable();
  assert.throws(() => f.prepare({ copyFile: () => { throw new Error('simulated backup failure'); } }), /simulated backup failure/u);
  assert.equal(lstatSync(f.link).isSymbolicLink(), true);
  assert.deepEqual(f.stable(), before);
  assert.equal(readdirSync(f.profile).filter((name) => name.startsWith('.medresearch-market-migration-')).length, 1);
});

test('备份落盘内容损坏时哈希校验阻止解除链接', (t) => {
  const f = fixture(t);
  const before = f.stable();
  assert.throws(() => f.prepare({ copyFile: (input, output, mode) => {
    copyFileSync(input, output, mode);
    writeFileSync(output, 'corrupt backup fixture');
  } }), /备份哈希校验失败/u);
  assert.equal(lstatSync(f.link).isSymbolicLink(), true);
  assert.deepEqual(f.stable(), before);
});

test('node_modules 或 profile 是链接时拒绝操作，不跟随路径别名', (t) => {
  const f = fixture(t);
  const relocated = join(f.profile, 'relocated-modules');
  renameSync(f.modules, relocated);
  symlinkSync(relocated, f.modules, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => f.prepare(), /node_modules 必须/u);
  const alias = join(f.temp, 'profile-alias');
  symlinkSync(f.profile, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => f.prepare({ profileDir: alias }), /路径不能包含链接/u);
  assert.equal(lstatSync(join(relocated, PLUGIN)).isSymbolicLink(), true);
});

test('未知实体插件目录拒绝；已识别市场实体包只提示无需处理', (t) => {
  const f = fixture(t);
  unlinkSync(f.link);
  put(join(f.link, 'package.json'), { name: PLUGIN, version: '0.2.3' });
  const before = f.stable();
  assert.throws(() => f.prepare(), /未知实体/u);
  put(join(f.link, 'package.json'), { name: PLUGIN, version: '0.2.4', main: './plugin/lib/index.js',
    exports: { '.': './plugin/lib/index.js' }, medresearchWorkbench: { formatVersion: 1, manifest: 'market-assets.json' } });
  put(join(f.link, 'market-assets.json'), { formatVersion: 1, plugin: PLUGIN, version: '0.2.4' });
  const marketBefore = tree(f.link);
  assert.equal(f.prepare().status, 'market-package');
  assert.deepEqual(tree(f.link), marketBefore);
  assert.deepEqual(f.stable(), before);
  assert.match(f.messages.at(-1), /市场实体包，无需处理/u);
});

test('没有版本的实体目录不能被误报为已安装市场包', (t) => {
  const f = fixture(t);
  unlinkSync(f.link);
  put(join(f.link, 'package.json'), { name: PLUGIN, main: './plugin/lib/index.js',
    exports: { '.': './plugin/lib/index.js' }, medresearchWorkbench: { formatVersion: 1, manifest: 'market-assets.json' } });
  put(join(f.link, 'market-assets.json'), { formatVersion: 1, plugin: PLUGIN });
  const before = tree(f.link);
  assert.throws(() => f.prepare(), /未知实体/u);
  assert.deepEqual(tree(f.link), before);
});

test('restore 仅在目标不存在时恢复原链接，备份、资料与配置不变', (t) => {
  const f = fixture(t);
  const before = f.stable();
  const { backupDir } = f.prepare();
  const backupBefore = tree(backupDir);
  assert.equal(f.restore(backupDir).status, 'restored');
  assert.equal(lstatSync(f.link).isSymbolicLink(), true);
  assert.equal(realpathSync(f.link), realpathSync(f.pluginDir));
  assert.deepEqual(f.stable(), before);
  assert.deepEqual(tree(backupDir), backupBefore);
});

test('restore 拒绝覆盖新市场实体包及悬空链接', (t) => {
  const f = fixture(t);
  const { backupDir } = f.prepare();
  put(join(f.link, 'package.json'), { name: PLUGIN, version: '0.2.4' });
  const marketBefore = tree(f.link);
  assert.throws(() => f.restore(backupDir), /已存在.*拒绝覆盖/u);
  assert.deepEqual(tree(f.link), marketBefore);
  const movedMarket = join(f.profile, 'synthetic-market-copy');
  renameSync(f.link, movedMarket);
  symlinkSync(join(f.temp, 'missing-plugin'), f.link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => f.restore(backupDir), /已存在.*拒绝覆盖/u);
  assert.equal(lstatSync(f.link).isSymbolicLink(), true);
});

test('restore 拒绝被篡改的插件备份及 profile 外的备份路径', (t) => {
  const f = fixture(t);
  const { backupDir } = f.prepare();
  put(join(backupDir, 'plugin/lib/index.js'), '// tampered fixture\n');
  assert.throws(() => f.restore(backupDir), /哈希不一致/u);
  assert.equal(exists(f.link), false);
  assert.throws(() => f.restore(f.root), /当前 profile 直属/u);
});

test('Electron runtime 与旧 Node 拒绝执行', () => {
  assert.throws(() => assertSystemNode({ node: '22.0.0', electron: '40.0.0' }), /拒绝在 Electron/u);
  assert.throws(() => assertSystemNode({ node: '18.0.0' }), /Node.js 20/u);
  assert.doesNotThrow(() => assertSystemNode({ node: '22.0.0' }));
});

test('CLI 默认采用 DSH_HOME/profiles/desktop，显式 --profile 与 --restore 可用', (t) => {
  const f = fixture(t);
  const before = f.stable();
  const invoke = (args = []) => {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', windowsHide: true,
      env: { ...process.env, DSH_HOME: f.dshHome } });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout;
  };
  assert.match(invoke(), /原工作台与资料保留/u);
  const backup = readdirSync(f.profile).find((name) => name.startsWith('.medresearch-market-migration-'));
  assert.match(invoke(['--profile', f.profile]), /无需重复处理/u);
  assert.match(invoke(['--profile', f.profile, '--restore', join(f.profile, backup)]), /已恢复原插件链接/u);
  assert.deepEqual(f.stable(), before);
});

test('CMD 使用 PATH 系统 Node，CRLF 无 BOM，白名单包含迁移入口', () => {
  const bytes = readFileSync(join(ROOT, '旧版转市场安装.cmd'));
  assert.equal(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), false);
  const text = bytes.toString('utf8');
  assert.equal(/(?<!\r)\n/u.test(text), false);
  assert.match(text, /where\.exe "\$PATH:node\.exe"/u);
  assert.match(text, /scripts\\prepare-market-install\.mjs/u);
  assert.doesNotMatch(text, /electron|DeepSeek Harness\.exe|rm\s|rmdir|del\s/iu);
  const pkg = json(join(ROOT, 'package.json'));
  for (const path of ['scripts/prepare-market-install.mjs', '旧版转市场安装.cmd']) assert.ok(pkg.files.includes(path));
});
