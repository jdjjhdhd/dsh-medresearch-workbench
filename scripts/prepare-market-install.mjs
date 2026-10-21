#!/usr/bin/env node
/** 旧 file: 安装转市场安装前，只备份并解除本插件的已登记链接。 */
import { createHash } from 'node:crypto';
import { constants, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync,
  readdirSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTALLATION_FILENAME, INSTALLATION_PLUGIN_ID as PLUGIN, pluginRuntimeHash,
  validateInstallationRoot } from '../plugin/src/host/installation.js';

const BACKUP_PREFIX = '.medresearch-market-migration-';
const BACKUP_METADATA = 'migration.json';
const PLUGIN_ENTRIES = new Set(['package.json', 'dsh.plugin.json', 'cordis.patch.yml', 'README.md',
  'LICENSE', 'LICENSE.txt', 'LICENSE.md', 'lib', 'src']);
const FORBIDDEN_ENTRIES = /^(?:data|runtime|logs|backups|node_modules|\.git|\.env(?:\..*)?)$/iu;
const SUCCESS = '原工作台与资料保留，返回市场安装，完成后再重启DSH';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const samePath = (left, right) => {
  const normalize = (value) => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
  return normalize(left) === normalize(right);
};
const snapshotHash = (snapshot) => hash(JSON.stringify(snapshot));

export function assertSystemNode(versions = process.versions) {
  if (versions.electron) throw new Error('请使用 PATH 中的系统 Node.js 运行；拒绝在 Electron 环境解除链接。');
  const major = Number(String(versions.node).split('.')[0]);
  if (!Number.isInteger(major) || major < 20) throw new Error('需要系统 Node.js 20+。');
}

export function defaultProfileDir() {
  const dshHome = String(process.env.DSH_HOME || '').trim() || join(homedir(), '.dsh');
  return resolve(dshHome, 'profiles', 'desktop');
}

function statIfExists(path) {
  try { return lstatSync(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function assertNoLinks(path, { missing = false } = {}) {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of relative(current, absolute).split(sep).filter(Boolean)) {
    current = join(current, part);
    const info = statIfExists(current);
    if (!info && missing) continue;
    if (!info) throw new Error(`路径不存在：${current}`);
    if (info.isSymbolicLink()) throw new Error(`路径不能包含链接：${current}`);
  }
  return absolute;
}

function canonicalDirectory(path, label) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error(`${label}必须是绝对路径。`);
  const absolute = assertNoLinks(path);
  if (!lstatSync(absolute).isDirectory()) throw new Error(`${label}必须是普通目录。`);
  const canonical = realpathSync(absolute);
  if (!samePath(canonical, absolute)) throw new Error(`${label}不是规范目录。`);
  return canonical;
}

function childPath(root, path) {
  if (typeof path !== 'string' || !path || /[\\:\0]/u.test(path)
      || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`不安全的相对路径：${path}`);
  }
  const full = resolve(root, ...path.split('/'));
  const suffix = relative(root, full);
  if (!suffix || suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) {
    throw new Error(`路径超出所属目录：${path}`);
  }
  return full;
}

function ordinaryFile(path) {
  assertNoLinks(path);
  if (!lstatSync(path).isFile()) throw new Error(`必须是普通文件：${path}`);
  return readFileSync(path);
}

function readJson(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/u, '')); }
  catch { throw new Error(`${label}无法解析。`); }
}

function profileScope(profileDir) {
  const profile = canonicalDirectory(profileDir, 'profile');
  const modules = join(profile, 'node_modules');
  const modulesInfo = statIfExists(modules);
  if (modulesInfo && (!modulesInfo.isDirectory() || modulesInfo.isSymbolicLink()
      || !samePath(dirname(canonicalDirectory(modules, 'node_modules')), profile))) {
    throw new Error('node_modules 必须是当前 profile 直属的普通目录。');
  }
  return { profile, modules, link: join(modules, PLUGIN), registration: join(profile, INSTALLATION_FILENAME),
    manifest: join(profile, 'package.json'), lock: join(profile, 'pnpm-lock.yaml') };
}

function profileFiles(scope) {
  return {
    manifest: ordinaryFile(scope.manifest),
    registration: ordinaryFile(scope.registration),
    lock: statIfExists(scope.lock) ? ordinaryFile(scope.lock) : null,
  };
}

function assertSameProfileFiles(scope, before) {
  const current = profileFiles(scope);
  for (const field of ['manifest', 'registration', 'lock']) {
    if ((before[field] === null) !== (current[field] === null)
        || (before[field] && !before[field].equals(current[field]))) {
      throw new Error('profile 配置、锁文件或安装登记已变化，已停止操作。');
    }
  }
}

function validateRegistration(scope, original) {
  const record = readJson(original.registration, '安装登记');
  if (record?.schemaVersion !== 1 || record.plugin !== PLUGIN
      || typeof record.profileDir !== 'string' || !isAbsolute(record.profileDir)
      || !samePath(record.profileDir, scope.profile)) throw new Error('安装登记不属于当前插件或当前 profile。');
  const root = canonicalDirectory(record.projectRoot, '登记的工作台目录');
  const pluginDir = canonicalDirectory(record.pluginDir, '登记的插件目录');
  if (!samePath(pluginDir, join(root, 'plugin'))) throw new Error('登记的工作台目录与插件目录不匹配。');
  const installation = validateInstallationRoot(root);
  if (!installation.ok || !samePath(installation.pluginDir, pluginDir)
      || installation.version !== record.pluginVersion) throw new Error('安装登记的完整工作台或版本校验失败。');
  const metadata = readJson(original.manifest, 'profile package.json');
  const spec = metadata?.dependencies?.[PLUGIN];
  if (typeof spec !== 'string' || !spec.startsWith('file:') || !spec.slice(5)
      || !samePath(canonicalDirectory(resolve(scope.profile, spec.slice(5)), 'file: 依赖目录'), pluginDir)) {
    throw new Error('当前 profile 的 file: 依赖与安装登记不匹配。');
  }
  if (!/^[a-f0-9]{64}$/u.test(record.runtimeHash || '') || pluginRuntimeHash(pluginDir) !== record.runtimeHash) {
    throw new Error('插件运行代码与安装登记 runtimeHash 不一致。');
  }
  return { record, root, pluginDir };
}

function pluginSnapshot(pluginDir) {
  canonicalDirectory(pluginDir, '插件目录');
  const directories = [];
  const files = [];
  function visit(path) {
    const full = childPath(pluginDir, path);
    const info = lstatSync(full);
    if (info.isSymbolicLink() || FORBIDDEN_ENTRIES.test(basename(full))) throw new Error(`插件备份不允许链接或本地状态：${path}`);
    if (info.isDirectory()) {
      directories.push(path);
      for (const name of readdirSync(full).sort()) visit(`${path}/${name}`);
    } else if (info.isFile()) {
      const bytes = ordinaryFile(full);
      files.push({ path, size: bytes.length, sha256: hash(bytes) });
    } else throw new Error(`插件备份只允许普通文件：${path}`);
  }
  for (const name of readdirSync(pluginDir).sort()) {
    if (!PLUGIN_ENTRIES.has(name)) throw new Error(`插件中存在未知文件或目录，拒绝备份：${name}`);
    visit(name);
  }
  return { directories, files };
}

function linkTarget(scope) {
  const info = statIfExists(scope.link);
  if (!info?.isSymbolicLink()) throw new Error('仅允许解除当前 profile 中已登记的插件 junction。');
  const rawTarget = readlinkSync(scope.link);
  const target = canonicalDirectory(resolve(scope.modules, rawTarget.replace(/^\\\\\?\\/u, '')), 'junction 目标');
  if (!samePath(realpathSync(scope.link), target)) throw new Error('junction 目标不一致。');
  return { rawTarget, target };
}

function assertSameLink(scope, before, pluginDir) {
  const currentScope = profileScope(scope.profile);
  if (!samePath(currentScope.link, scope.link)) throw new Error('插件链接范围已变化。');
  const current = linkTarget(scope);
  if (current.rawTarget !== before.rawTarget || !samePath(current.target, pluginDir)) throw new Error('插件链接目标已变化。');
}

function recognizedMarketPackage(path) {
  const pkg = readJson(ordinaryFile(join(path, 'package.json')), '已安装包');
  if (pkg.name !== PLUGIN || typeof pkg.version !== 'string' || !pkg.version.trim() || pkg.main !== './plugin/lib/index.js'
      || pkg.exports?.['.'] !== './plugin/lib/index.js'
      || pkg.medresearchWorkbench?.formatVersion !== 1 || pkg.medresearchWorkbench.manifest !== 'market-assets.json') return false;
  const manifest = readJson(ordinaryFile(join(path, 'market-assets.json')), '市场资产清单');
  return manifest.formatVersion === 1 && manifest.plugin === PLUGIN && manifest.version === pkg.version;
}

function backupScope(scope, backupDir) {
  const backup = canonicalDirectory(backupDir, '迁移备份');
  if (!samePath(dirname(backup), scope.profile) || !basename(backup).startsWith(BACKUP_PREFIX)) {
    throw new Error('迁移备份必须位于当前 profile 直属的专用备份目录。');
  }
  return backup;
}

function copySnapshot(source, destination, snapshot, copyFile) {
  canonicalDirectory(source, '备份源');
  canonicalDirectory(destination, '备份目标');
  for (const directory of snapshot.directories) {
    const output = childPath(destination, directory);
    assertNoLinks(output, { missing: true });
    mkdirSync(output, { recursive: true });
  }
  for (const file of snapshot.files) {
    const input = childPath(source, file.path);
    ordinaryFile(input);
    const output = childPath(destination, file.path);
    assertNoLinks(output, { missing: true });
    copyFile(input, output, constants.COPYFILE_EXCL);
  }
}

export function prepareMarketInstall({ profileDir = defaultProfileDir(), log = console.log, copyFile = copyFileSync } = {}) {
  assertSystemNode();
  const scope = profileScope(profileDir);
  const info = statIfExists(scope.link);
  if (!info) {
    log('[market-migration] 当前 profile 没有需要解除的旧插件链接，无需重复处理。');
    return { status: 'no-link', backupDir: '' };
  }
  if (!info.isSymbolicLink()) {
    if (info.isDirectory() && recognizedMarketPackage(scope.link)) {
      log('[market-migration] 当前已是市场实体包，无需处理。');
      return { status: 'market-package', backupDir: '' };
    }
    throw new Error('插件位置是未知实体目录或文件，拒绝移动或删除。');
  }
  const original = profileFiles(scope);
  const installation = validateRegistration(scope, original);
  const target = linkTarget(scope);
  if (!samePath(target.target, installation.pluginDir)) throw new Error('junction 目标与安装登记不匹配，拒绝解除。');
  const snapshot = pluginSnapshot(installation.pluginDir);
  const backupDir = backupScope(scope, mkdtempSync(join(scope.profile, BACKUP_PREFIX)));
  const backupPlugin = childPath(backupDir, 'plugin');
  mkdirSync(backupPlugin);
  copySnapshot(installation.pluginDir, backupPlugin, snapshot, copyFile);
  writeFileSync(join(backupDir, INSTALLATION_FILENAME), original.registration, { flag: 'wx' });
  const metadata = {
    schemaVersion: 1, plugin: PLUGIN, profileDir: scope.profile, projectRoot: installation.root,
    pluginDir: installation.pluginDir, linkPath: scope.link, rawTarget: target.rawTarget,
    pluginVersion: installation.record.pluginVersion, runtimeHash: installation.record.runtimeHash,
    registrationSha256: hash(original.registration), treeSha256: snapshotHash(snapshot),
    tree: snapshot, createdAt: new Date().toISOString(),
  };
  writeFileSync(join(backupDir, BACKUP_METADATA), `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });
  if (snapshotHash(pluginSnapshot(backupPlugin)) !== metadata.treeSha256
      || hash(ordinaryFile(join(backupDir, INSTALLATION_FILENAME))) !== metadata.registrationSha256) {
    throw new Error(`备份哈希校验失败，旧链接保留。备份：${backupDir}`);
  }
  assertSameProfileFiles(scope, original);
  if (snapshotHash(pluginSnapshot(installation.pluginDir)) !== metadata.treeSha256) throw new Error('备份期间原插件发生变化，旧链接保留。');
  assertSameLink(scope, target, installation.pluginDir);
  // 这里只解除经过验证的链接；绝不递归删除它指向的外部插件目录。
  unlinkSync(scope.link);
  if (statIfExists(scope.link)) throw new Error(`插件链接未解除。备份：${backupDir}`);
  assertSameProfileFiles(scope, original);
  if (snapshotHash(pluginSnapshot(installation.pluginDir)) !== metadata.treeSha256) throw new Error(`解除链接后原插件发生变化，请保留备份：${backupDir}`);
  log(`[market-migration] 备份：${backupDir}`);
  log(`[market-migration] files=${snapshot.files.length} treeSha256=${metadata.treeSha256}`);
  log(SUCCESS);
  return { status: 'prepared', backupDir, treeSha256: metadata.treeSha256 };
}

export function restoreMarketInstall({ profileDir = defaultProfileDir(), backupDir, log = console.log } = {}) {
  assertSystemNode();
  const scope = profileScope(profileDir);
  if (!statIfExists(scope.modules)) throw new Error('当前 profile 的 node_modules 不存在，拒绝猜测恢复位置。');
  if (statIfExists(scope.link)) throw new Error('插件位置已存在（可能已安装市场包），拒绝覆盖恢复。');
  const backup = backupScope(scope, backupDir);
  const metadata = readJson(ordinaryFile(join(backup, BACKUP_METADATA)), '迁移备份清单');
  const original = profileFiles(scope);
  const installation = validateRegistration(scope, original);
  if (metadata.schemaVersion !== 1 || metadata.plugin !== PLUGIN
      || typeof metadata.profileDir !== 'string' || !isAbsolute(metadata.profileDir) || !samePath(metadata.profileDir, scope.profile)
      || typeof metadata.linkPath !== 'string' || !isAbsolute(metadata.linkPath) || !samePath(metadata.linkPath, scope.link)
      || typeof metadata.projectRoot !== 'string' || !isAbsolute(metadata.projectRoot) || !samePath(metadata.projectRoot, installation.root)
      || typeof metadata.pluginDir !== 'string' || !isAbsolute(metadata.pluginDir) || !samePath(metadata.pluginDir, installation.pluginDir)
      || metadata.pluginVersion !== installation.record.pluginVersion || metadata.runtimeHash !== installation.record.runtimeHash
      || hash(original.registration) !== metadata.registrationSha256) throw new Error('迁移备份不属于当前安装登记或 profile，拒绝恢复。');
  const backupTree = pluginSnapshot(join(backup, 'plugin'));
  if (snapshotHash(backupTree) !== metadata.treeSha256 || snapshotHash(metadata.tree) !== metadata.treeSha256
      || snapshotHash(pluginSnapshot(installation.pluginDir)) !== metadata.treeSha256
      || hash(ordinaryFile(join(backup, INSTALLATION_FILENAME))) !== metadata.registrationSha256) {
    throw new Error('迁移备份、原插件或登记的哈希不一致，拒绝恢复。');
  }
  profileScope(scope.profile);
  assertSameProfileFiles(scope, original);
  if (statIfExists(scope.link)) throw new Error('插件位置已存在，拒绝覆盖恢复。');
  symlinkSync(installation.pluginDir, scope.link, process.platform === 'win32' ? 'junction' : 'dir');
  if (!samePath(realpathSync(scope.link), installation.pluginDir)) throw new Error('恢复后的链接目标校验失败。');
  assertSameProfileFiles(scope, original);
  if (snapshotHash(pluginSnapshot(installation.pluginDir)) !== metadata.treeSha256) throw new Error('恢复后原插件发生变化。');
  log('[market-migration] 已恢复原插件链接；原工作台、登记和资料保留。');
  return { status: 'restored', backupDir: backup };
}

function main(argv) {
  assertSystemNode();
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    if (name === '--help') {
      console.log('系统 Node.js 20+：node scripts/prepare-market-install.mjs [--profile <目录>] [--restore <备份目录>]');
      return;
    }
    if (!['--profile', '--restore'].includes(name) || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error(`未知参数或缺少参数值：${name}`);
    }
    options[name.slice(2)] = resolve(argv[++index]);
  }
  const profileDir = options.profile || defaultProfileDir();
  if (options.restore) restoreMarketInstall({ profileDir, backupDir: options.restore });
  else prepareMarketInstall({ profileDir });
}

if (process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url))) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    console.error(`[market-migration] 失败：${error.message}`);
    process.exitCode = 1;
  }
}
