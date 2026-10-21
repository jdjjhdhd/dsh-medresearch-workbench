#!/usr/bin/env node
/**
 * 安装/升级 dsh-medresearch-model 宿主插件。
 *
 * 设计约束：
 * - 不跑 pnpm；用 junction + profile package.json 的 file: 依赖注册。
 * - 支持交付目录换位置升级：自动把依赖和 junction 指到当前 plugin/ 实际位置。
 * - 回滚只撤销本插件的 dependency、bundle 和 junction，绝不覆盖其他插件配置。
 *
 * 用法：
 *   node scripts/install-model-plugin.mjs
 *   node scripts/install-model-plugin.mjs --verify
 *   node scripts/install-model-plugin.mjs --dry-run
 *   node scripts/install-model-plugin.mjs --profile <dir>
 *   node scripts/install-model-plugin.mjs --rollback [备份目录名]
 */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createInstallationRecord,
  installationRecordPath,
  pluginRuntimeHash,
  resolveInstallation,
  validateInstallationRoot,
} from '../plugin/src/host/installation.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_DIR = join(ROOT, 'plugin');
const MIN_NODE_MAJOR = 20;
const BACKUP_PREFIX = '.medresearch-model-backup-';
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};
const has = (name) => argv.includes(`--${name}`);
const dryRun = has('dry-run');
const dshHome = String(process.env.DSH_HOME || '').trim() || join(homedir(), '.dsh');
const profileDir = resolve(opt('profile', join(dshHome, 'profiles', 'desktop')));
const manifestPath = join(profileDir, 'package.json');
const lockPath = join(profileDir, 'pnpm-lock.yaml');
const registrationPath = installationRecordPath(profileDir);

if (!existsSync(join(PLUGIN_DIR, 'package.json'))) fail(`插件目录不存在：${PLUGIN_DIR}`);
const pluginPkg = JSON.parse(readFileSync(join(PLUGIN_DIR, 'package.json'), 'utf8').replace(/^\uFEFF/, ''));
const PLUGIN_NAME = pluginPkg.name;
const PLUGIN_VERSION = pluginPkg.version;
const linkPath = join(profileDir, 'node_modules', PLUGIN_NAME);
const expectedSpec = `file:${PLUGIN_DIR.replaceAll('\\', '/')}`;
assertNodeVersion();

function fail(message) {
  console.error(`[install] 失败：${message}`);
  process.exit(1);
}
function assertNodeVersion() {
  const major = Number(String(process.versions.node || '').split('.')[0]);
  if (!Number.isFinite(major) || major < MIN_NODE_MAJOR) {
    fail(`需要 Node.js ${MIN_NODE_MAJOR}+（当前 ${process.versions.node}）；Node.js 用于安装器和本地桥接服务。`);
  }
}
function stamp() {
  const d = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    fail(`${label} 无法解析：${error.message}`);
  }
}
function readManifest() {
  if (!existsSync(manifestPath)) fail(`profile package.json 不存在：${manifestPath}`);
  return readJson(manifestPath, 'profile package.json');
}
function writeManifest(manifest) {
  atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
function atomicWrite(file, text) {
  const temp = `${file}.tmp-${process.pid}`;
  let created = false;
  try {
    writeFileSync(temp, text, { encoding: 'utf8', flag: 'wx' });
    created = true;
    renameSync(temp, file);
    created = false;
  } finally {
    if (created) rmSync(temp);
  }
}
function registrationText() {
  const stat = lstatIfExists(registrationPath);
  if (!stat) return null;
  if (!stat.isFile()) fail(`安装登记不是普通文件，拒绝覆盖：${registrationPath}`);
  return readFileSync(registrationPath, 'utf8');
}
function writeRegistration(record) {
  if (record === null) {
    if (lstatIfExists(registrationPath)) rmSync(registrationPath);
  } else {
    atomicWrite(registrationPath, typeof record === 'string' ? record : `${JSON.stringify(record, null, 2)}\n`);
  }
}
function pluginFields(manifest) {
  return { spec: manifest?.dependencies?.[PLUGIN_NAME] ?? null, bundleIndex: bundleIndex(manifest) };
}
function applyPluginFields(manifest, previous) {
  manifest.dependencies = manifest.dependencies || {};
  if (previous.spec) manifest.dependencies[PLUGIN_NAME] = previous.spec;
  else delete manifest.dependencies[PLUGIN_NAME];
  manifest.dsh = manifest.dsh || {};
  manifest.dsh.profile = manifest.dsh.profile || {};
  const bundles = Array.isArray(manifest.dsh.profile.bundles) ? manifest.dsh.profile.bundles.filter((x) => x !== PLUGIN_NAME) : [];
  if (Number.isInteger(previous.bundleIndex) && previous.bundleIndex >= 0) {
    bundles.splice(Math.min(previous.bundleIndex, bundles.length), 0, PLUGIN_NAME);
  }
  manifest.dsh.profile.bundles = bundles;
}
function commitPluginState(manifest, target, record, previous) {
  let changedLink = false;
  let preservedPhysical = '';
  let restoredPhysical = '';
  try {
    if (target !== undefined) {
      const current = linkState();
      if (current.exists && !current.isLink) {
        if (!previous.physicalBackup) throw new Error('实体插件尚未指定保全备份，拒绝替换。');
        assertPhysicalMove(linkPath, previous.physicalBackup);
        renameSync(linkPath, previous.physicalBackup);
        preservedPhysical = previous.physicalBackup;
      } else if (current.exists) removeJunction();
      changedLink = true;
      if (target?.physical) {
        assertPhysicalMove(target.physical, linkPath);
        renameSync(target.physical, linkPath);
        restoredPhysical = target.physical;
      } else if (target) createJunction(linkPath, target);
    }
    writeRegistration(record);
    writeManifest(manifest);
  } catch (error) {
    const failures = [];
    for (const restore of [
      () => {
        if (!changedLink) return;
        if (restoredPhysical) {
          assertPhysicalMove(linkPath, restoredPhysical);
          renameSync(linkPath, restoredPhysical);
        } else if (linkState().exists) removeJunction();
        if (preservedPhysical) {
          assertPhysicalMove(preservedPhysical, linkPath);
          renameSync(preservedPhysical, linkPath);
        } else if (previous.link.exists) createJunction(linkPath, previous.link.target);
      },
      () => writeRegistration(previous.registration),
      () => {
        const current = readManifest();
        applyPluginFields(current, previous.fields);
        writeManifest(current);
      },
    ]) {
      try { restore(); } catch (restoreError) { failures.push(restoreError.message); }
    }
    throw new Error(`安装状态提交失败，已尝试仅恢复本插件：${error.message}${failures.length ? `；恢复失败：${failures.join('；')}` : ''}`);
  }
}
function assertMatchingPhysicalPackage() {
  const loaded = physicalPackageInfo(linkPath);
  if (loaded.version !== PLUGIN_VERSION || pluginRuntimeHash(linkPath) !== pluginRuntimeHash(pluginTarget())) {
    fail('宿主中的实体插件副本与当前发行包代码不一致；请从完整客户目录重新运行安装器以保全备份并升级。');
  }
}
function physicalPackageInfo(target) {
  const stat = lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('实体插件必须是普通目录。');
  const allowed = new Set(['package.json', 'dsh.plugin.json', 'cordis.patch.yml', 'README.md', 'LICENSE', 'LICENSE.txt', 'LICENSE.md', 'lib', 'src']);
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (!allowed.has(entry.name) || entry.isSymbolicLink()) throw new Error(`实体插件含未知目录或文件，拒绝移动：${entry.name}`);
  }
  const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8').replace(/^\uFEFF/, ''));
  const descriptor = JSON.parse(readFileSync(join(target, 'dsh.plugin.json'), 'utf8').replace(/^\uFEFF/, ''));
  if (pkg.name !== 'dsh-medresearch-model' || descriptor.name !== pkg.name || descriptor.entry?.name !== pkg.name
      || !pkg.version || descriptor.version !== pkg.version) throw new Error('实体目录不属于已识别的医学工作台插件，拒绝移动。');
  for (const file of ['cordis.patch.yml', 'lib/index.js', 'lib/client.js', 'src/host/routes.js', 'src/host/service.js', 'src/host/constants.js']) {
    if (!lstatSync(join(target, file)).isFile()) throw new Error(`实体插件运行结构不完整：${file}`);
  }
  if (readdirSync(join(target, 'src')).some((name) => name !== 'host')) throw new Error('实体插件 src 含未知目录，拒绝移动。');
  for (const [directory, names] of [
    ['lib', ['index.js', 'client.js']],
    ['src/host', ['constants.js', 'http.js', 'installation.js', 'market-deployment.js', 'llm.js', 'prompts.js', 'routes.js', 'service.js', 'store.js']],
  ]) {
    for (const entry of readdirSync(join(target, directory), { withFileTypes: true })) {
      if (!entry.isFile() || !names.includes(entry.name)) throw new Error(`实体插件运行目录含未知内容，拒绝移动：${directory}/${entry.name}`);
    }
  }
  return { version: pkg.version, runtimeHash: pluginRuntimeHash(target) };
}
function assertPhysicalScope(target) {
  const profileRoot = realpathSync(profileDir);
  const modulesRoot = realpathSync(dirname(linkPath));
  if (!samePath(modulesRoot, join(profileRoot, 'node_modules'))) throw new Error('node_modules 实际路径不在当前 profile，拒绝移动。');
  const actual = realpathSync(target);
  if (samePath(resolve(target), resolve(linkPath))) {
    if (!samePath(actual, join(modulesRoot, 'dsh-medresearch-model'))) throw new Error('实体插件实际路径不是当前 profile 的精确插件路径。');
  } else {
    const backupRoot = realpathSync(dirname(target));
    if (!samePath(dirname(backupRoot), profileRoot) || !basename(backupRoot).startsWith(BACKUP_PREFIX)
        || lstatSync(dirname(target)).isSymbolicLink() || basename(target) !== 'plugin-copy'
        || !samePath(actual, join(backupRoot, 'plugin-copy'))) throw new Error('实体备份实际路径不在当前 profile 的本插件备份内。');
  }
  return actual;
}
function assertPhysicalMove(source, destination) {
  assertPhysicalScope(source);
  physicalPackageInfo(source);
  if (lstatIfExists(destination)) throw new Error('实体移动目标已存在，拒绝覆盖。');
  const profileRoot = realpathSync(profileDir);
  const parent = realpathSync(dirname(destination));
  if (samePath(resolve(destination), resolve(linkPath))) {
    if (!samePath(parent, join(profileRoot, 'node_modules'))) throw new Error('实体恢复目标不在当前 profile 的 node_modules。');
  } else if (!samePath(dirname(parent), profileRoot) || !basename(parent).startsWith(BACKUP_PREFIX)
      || lstatSync(dirname(destination)).isSymbolicLink() || basename(destination) !== 'plugin-copy') {
    throw new Error('实体保全目标不在当前 profile 的本次备份内。');
  }
}
function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
function specPath(spec) {
  if (typeof spec !== 'string' || !spec.startsWith('file:')) return '';
  return normalizePath(spec.slice('file:'.length));
}
function samePath(left, right) {
  return normalizePath(left) === normalizePath(right);
}
function pluginTarget() {
  try {
    return realpathSync(PLUGIN_DIR);
  } catch {
    return PLUGIN_DIR;
  }
}
function pathError(operation, target, error) {
  fail(`${operation}失败：${target}（${error?.code || 'UNKNOWN'}：${error?.message || error}）`);
}
function lstatIfExists(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    pathError('检查链接', path, error);
  }
}
function readlinkIfExists(path) {
  try {
    return readlinkSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    pathError('读取链接', path, error);
  }
}
function resolveLinkTarget(raw) {
  let target = String(raw || '');
  if (target.startsWith('\\\\?\\')) target = target.slice(4);
  return resolve(dirname(linkPath), target);
}
function linkState() {
  const stat = lstatIfExists(linkPath);
  if (!stat) return { exists: false, isLink: false, target: '', rawTarget: '', realTarget: '' };
  if (!stat.isSymbolicLink()) return { exists: true, isLink: false, target: '', rawTarget: '', realTarget: '' };
  const rawTarget = readlinkIfExists(linkPath);
  if (!rawTarget) return { exists: false, isLink: false, target: '', rawTarget: '', realTarget: '' };
  const target = resolveLinkTarget(rawTarget);
  let realTarget = '';
  try {
    realTarget = realpathSync(linkPath);
  } catch (error) {
    // 目标不存在时 realpath 返回 ENOENT；这不是链接不存在，必须保留 readlink 记录的目标。
    if (error?.code !== 'ENOENT') pathError('解析链接目标', linkPath, error);
  }
  return { exists: true, isLink: true, target, rawTarget, realTarget };
}
function assertOwnedJunction(link) {
  if (!link.exists) return;
  if (!link.isLink) {
    fail(`node_modules/${PLUGIN_NAME} 是实际目录而非 junction，拒绝删除：${linkPath}`);
  }
  // 目标还在时校验 package.json，避免误删指向其他插件的链接。
  if (link.target && existsSync(link.target)) {
    const pkgFile = join(link.target, 'package.json');
    if (!existsSync(pkgFile)) {
      fail(`链接目标不是有效插件目录（缺少 package.json），拒绝删除：${link.target}`);
    }
    const pkg = readJson(pkgFile, 'junction target package.json');
    if (pkg.name !== PLUGIN_NAME) {
      fail(`链接目标属于 ${pkg.name || '未知包'}，不是 ${PLUGIN_NAME}，拒绝删除：${link.target}`);
    }
  }
}
function createJunction(link, target) {
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}
function removeJunction() {
  const link = linkState();
  if (!link.exists) return false;
  assertOwnedJunction(link);
  rmSync(linkPath, { force: true });
  return true;
}
function specAbsolutePath(spec) {
  if (typeof spec !== 'string' || !spec.startsWith('file:')) return '';
  return resolve(profileDir, spec.slice('file:'.length));
}
function assertPluginDirectory(target, label) {
  if (!target || !existsSync(target)) fail(`${label}不存在：${target || '（空路径）'}`);
  const pkgFile = join(target, 'package.json');
  if (!existsSync(pkgFile)) fail(`${label}缺少 package.json：${target}`);
  const pkg = readJson(pkgFile, `${label} package.json`);
  if (pkg.name !== PLUGIN_NAME) fail(`${label}不是 ${PLUGIN_NAME}：${pkg.name || '未知包'}（${target}）`);
}
function previousInstallTarget(state) {
  const previous = state?.previous || {};
  if (!previous.spec) return '';
  return previous.junctionTarget || specAbsolutePath(previous.spec);
}
function bundleIndex(manifest) {
  const bundles = manifest?.dsh?.profile?.bundles;
  return Array.isArray(bundles) ? bundles.indexOf(PLUGIN_NAME) : -1;
}
function listBackups() {
  if (!existsSync(profileDir)) return [];
  return readdirSync(profileDir).filter((x) => x.startsWith(BACKUP_PREFIX)).sort().reverse();
}
function verifyPrereqs(manifest) {
  const bundles = manifest?.dsh?.profile?.bundles || [];
  if (!bundles.includes('dsh-worktable')) {
    fail('缺少 dsh-worktable：当前 profile 未启用药学工作台依赖（要求 >= 0.4.0）。请先在 DSH 插件页安装并启用 dsh-worktable，再重新运行本安装器。');
  }
  const pkgFile = join(profileDir, 'node_modules', 'dsh-worktable', 'package.json');
  if (!existsSync(pkgFile)) {
    fail(`缺少 dsh-worktable 包：${pkgFile}。请先安装 dsh-worktable >= 0.4.0，再重新运行本安装器。`);
  }
  const pkg = readJson(pkgFile, 'dsh-worktable package.json');
  const major = Number(String(pkg.version || '').split('.')[0]);
  const minor = Number(String(pkg.version || '').split('.')[1]);
  if (!Number.isFinite(major) || major < 0 || (major === 0 && (!Number.isFinite(minor) || minor < 4))) {
    fail(`dsh-worktable 版本过低：${pkg.version || '未知'}（要求 >= 0.4.0）。请先升级 dsh-worktable。`);
  }
  console.log(`[install] dsh-worktable ${pkg.version || '未知版本'}（要求 >= 0.4.0）`);
}
function verifyInstall() {
  const manifest = readManifest();
  const dep = manifest?.dependencies?.[PLUGIN_NAME] || '';
  const link = linkState();
  const problems = [];
  if (!samePath(specPath(dep), pluginTarget())) problems.push(`dependency 不指向当前插件：${dep || '（缺失）'}`);
  if (!link.exists) problems.push(`插件加载位置不存在：${linkPath}`);
  else if (link.isLink && !samePath(link.target, pluginTarget())) problems.push(`junction 指向 ${link.target}，不是 ${pluginTarget()}`);
  else if (!link.isLink) assertMatchingPhysicalPackage();
  if (bundleIndex(manifest) < 0) problems.push(`dsh.profile.bundles 未包含 ${PLUGIN_NAME}`);
  const installation = resolveInstallation({ profileDir });
  if (registrationText() === null || !installation.ok || installation.source !== 'registration'
      || !samePath(installation.projectRoot, ROOT)) problems.push(`安装位置登记未通过：${installation.error || '缺少当前目录登记'}`);
  if (problems.length) {
    for (const problem of problems) console.error(`[verify] ${problem}`);
    return false;
  }
  const loadedPkg = join(linkPath, 'package.json');
  if (!existsSync(loadedPkg)) {
    console.error(`[verify] 加载位置缺少 package.json：${loadedPkg}`);
    return false;
  }
  const loaded = readJson(loadedPkg, 'loaded plugin package.json');
  if (loaded.name !== PLUGIN_NAME) {
    console.error(`[verify] 加载位置 name=${loaded.name}，期望 ${PLUGIN_NAME}`);
    return false;
  }
  console.log(`[verify] 实际加载位置：${link.target || linkPath}`);
  console.log(`[verify] 工作台交付目录：${installation.projectRoot}`);
  console.log(`[verify] 插件：${loaded.name}@${loaded.version}；dependency=${dep}`);
  verifyPrereqs(manifest);
  return true;
}
function backupState(previous, link, previousRegistration, physical) {
  let dir = join(profileDir, `${BACKUP_PREFIX}${stamp()}`);
  let suffix = 2;
  while (existsSync(dir)) dir = join(profileDir, `${BACKUP_PREFIX}${stamp()}-${suffix++}`);
  mkdirSync(dir, { recursive: true });
  copyFileSync(manifestPath, join(dir, 'package.json'));
  if (existsSync(lockPath)) copyFileSync(lockPath, join(dir, 'pnpm-lock.yaml'));
  const state = {
    version: 1,
    at: new Date().toISOString(),
    plugin: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    pluginDir: pluginTarget(),
    previous: {
      spec: previous?.dependencies?.[PLUGIN_NAME] ?? null,
      bundleIndex: bundleIndex(previous),
      junctionTarget: link.target || null,
      registration: previousRegistration,
      physical: physical ? {
        directory: 'plugin-copy',
        version: physical.version,
        runtimeHash: physical.runtimeHash,
        assetPluginDir: specAbsolutePath(previous?.dependencies?.[PLUGIN_NAME] || ''),
      } : null,
    },
  };
  writeFileSync(join(dir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return dir;
}
function installOrUpgrade() {
  if (!existsSync(profileDir)) fail(`profile 不存在：${profileDir}`);
  const manifest = readManifest();
  verifyPrereqs(manifest);
  const previousDep = manifest?.dependencies?.[PLUGIN_NAME] || '';
  const previousFields = pluginFields(manifest);
  const link = linkState();
  const previousRegistration = registrationText();
  const newRegistration = createInstallationRecord(ROOT, profileDir);
  const registered = resolveInstallation({ profileDir });
  const physical = link.exists && !link.isLink ? physicalPackageInfo(linkPath) : null;
  if (physical) assertPhysicalScope(linkPath);
  const replacePhysical = physical && (physical.version !== PLUGIN_VERSION || physical.runtimeHash !== pluginRuntimeHash(pluginTarget()));
  const needsDep = !samePath(specPath(previousDep), pluginTarget());
  const needsLink = !link.exists || (link.isLink && !samePath(link.target, pluginTarget())) || replacePhysical;
  const needsBundle = bundleIndex(manifest) < 0;
  const needsRegistration = previousRegistration === null || !registered.ok
    || registered.source !== 'registration' || !samePath(registered.projectRoot, ROOT);

  if (link.exists && link.isLink) assertOwnedJunction(link);

  if (!needsDep && !needsLink && !needsBundle && !needsRegistration) {
    console.log(`[install] ${PLUGIN_NAME} 已是当前目录，无需变更。`);
    if (!verifyInstall()) process.exit(1);
    return;
  }

  const plan = {
    action: previousDep ? 'upgrade' : 'install',
    plugin: `${PLUGIN_NAME}@${PLUGIN_VERSION}`,
    profileDir,
    previousSpec: previousDep || null,
    newSpec: expectedSpec,
    previousJunction: link.target || null,
    newJunction: pluginTarget(),
    addBundle: needsBundle,
    updateRegistration: needsRegistration,
    projectRoot: newRegistration.projectRoot,
    preservePhysicalCopy: Boolean(replacePhysical),
  };
  if (dryRun) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const backup = backupState(manifest, link, previousRegistration, replacePhysical ? physical : null);
  manifest.dependencies = manifest.dependencies || {};
  manifest.dependencies[PLUGIN_NAME] = expectedSpec;
  manifest.dsh = manifest.dsh || {};
  manifest.dsh.profile = manifest.dsh.profile || {};
  manifest.dsh.profile.bundles = Array.isArray(manifest.dsh.profile.bundles) ? manifest.dsh.profile.bundles : [];
  if (!manifest.dsh.profile.bundles.includes(PLUGIN_NAME)) manifest.dsh.profile.bundles.push(PLUGIN_NAME);
  commitPluginState(manifest, needsLink ? pluginTarget() : undefined, newRegistration,
    { fields: previousFields, link, registration: previousRegistration, physicalBackup: replacePhysical ? join(backup, 'plugin-copy') : '' });

  console.log(`[install] ${plan.action} 完成：${plan.plugin}`);
  console.log(`[install] profile：${profileDir}`);
  console.log(`[install] 备份：${backup}`);
  if (replacePhysical) console.log(`[install] 旧实体插件已完整保全（未删除）：${join(backup, 'plugin-copy')}`);
  console.log(`[install] dependency：${expectedSpec}`);
  console.log(`[install] bundles 当前 ${manifest.dsh.profile.bundles.length} 项`);
  if (!verifyInstall()) process.exit(1);
  console.log('[install] 宿主半通常会在运行时热加载；以重启后自检为准。');
}

function rollback() {
  const names = listBackups();
  const target = opt('rollback', '');
  const chosen = target && target.startsWith(BACKUP_PREFIX) ? target : target ? `${BACKUP_PREFIX}${target}` : names[0];
  if (!chosen) fail(`没有找到 ${BACKUP_PREFIX}* 备份`);
  if (chosen.includes('/') || chosen.includes('\\')) fail('备份目录名不能包含路径分隔符');
  const dir = join(profileDir, chosen);
  if (!existsSync(dir) || lstatSync(dir).isSymbolicLink() || !samePath(dirname(realpathSync(dir)), realpathSync(profileDir))) {
    fail('备份目录不在当前 profile，回滚未执行');
  }
  const statePath = join(dir, 'state.json');
  if (!existsSync(statePath)) fail(`备份缺少 state.json：${dir}`);
  const state = readJson(statePath, 'install state.json');
  if (state.plugin !== PLUGIN_NAME) fail('备份不属于本插件，回滚未执行');
  const previous = state.previous || {};
  const previousTarget = previousInstallTarget(state);
  let previousRegistration = previous.registration ?? null;
  let rollbackTarget = previousTarget || '';

  // 回滚预检：任何失败都必须在修改 manifest/link 之前发生，保证当前 B 完全不变。
  if (previous.physical) {
    if (previous.physical.directory !== 'plugin-copy') fail('实体备份目录记录无效，回滚未执行');
    const physicalBackup = join(dir, 'plugin-copy');
    assertPhysicalScope(physicalBackup);
    const savedPhysical = physicalPackageInfo(physicalBackup);
    if (savedPhysical.version !== previous.physical.version || savedPhysical.runtimeHash !== previous.physical.runtimeHash) {
      fail('实体备份身份或代码已变化，回滚未执行');
    }
    const assetPluginDir = previous.physical.assetPluginDir;
    if (!assetPluginDir || !existsSync(assetPluginDir)) fail('旧版本目录不存在或无法确认，回滚未执行；实体备份仍保留');
    const oldInstallation = validateInstallationRoot(dirname(realpathSync(assetPluginDir)));
    if (!oldInstallation.ok || !samePath(oldInstallation.pluginDir, realpathSync(assetPluginDir))
        || oldInstallation.version !== savedPhysical.version || pluginRuntimeHash(oldInstallation.pluginDir) !== savedPhysical.runtimeHash) {
      fail('旧版本交付资产与实体备份不一致，回滚未执行；实体备份仍保留');
    }
    if (previousRegistration !== null) {
      let saved;
      try { saved = JSON.parse(previousRegistration); } catch { fail('旧安装登记损坏，回滚未执行'); }
      const oldRecord = createInstallationRecord(oldInstallation.projectRoot, profileDir);
      for (const field of ['schemaVersion', 'plugin', 'pluginVersion', 'runtimeHash']) {
        if (saved[field] !== oldRecord[field]) fail('旧安装登记与旧版本代码不一致，回滚未执行');
      }
      for (const field of ['projectRoot', 'pluginDir', 'profileDir']) {
        if (typeof saved[field] !== 'string' || !samePath(saved[field], oldRecord[field])) fail('旧安装登记目录不一致，回滚未执行');
      }
    }
    rollbackTarget = { physical: physicalBackup };
  } else if (previous.spec) {
    if (!previousTarget || !existsSync(previousTarget)) {
      fail('旧版本目录不存在，回滚未执行');
    }
    assertPluginDirectory(previousTarget, '旧版本目录');
    const oldInstallation = validateInstallationRoot(dirname(realpathSync(previousTarget)));
    if (!oldInstallation.ok || !samePath(oldInstallation.pluginDir, realpathSync(previousTarget))) {
      fail(`旧版本不是完整交付目录，回滚未执行：${oldInstallation.error}`);
    }
    const oldRecord = createInstallationRecord(oldInstallation.projectRoot, profileDir);
    if (previousRegistration !== null) {
      let saved;
      try { saved = JSON.parse(previousRegistration); }
      catch { fail('旧安装登记损坏，回滚未执行'); }
      for (const field of ['schemaVersion', 'plugin', 'pluginVersion', 'runtimeHash']) {
        if (saved[field] !== oldRecord[field]) fail('旧安装登记与旧版本代码不一致，回滚未执行');
      }
      for (const field of ['projectRoot', 'pluginDir', 'profileDir']) {
        if (typeof saved[field] !== 'string' || !samePath(saved[field], oldRecord[field])) fail('旧安装登记目录不一致，回滚未执行');
      }
    } else {
      // 升级自没有登记的旧安装时，只在完整校验旧交付目录后补齐登记。
      previousRegistration = oldRecord;
    }
  }
  const currentRegistration = registrationText();
  const currentLink = linkState();
  if (currentLink.exists) assertOwnedJunction(currentLink);

  const manifest = readManifest();
  const currentFields = pluginFields(manifest);
  // 只改本插件的 dependency 和 bundle，其他插件配置原样保留。
  applyPluginFields(manifest, previous);
  commitPluginState(manifest, rollbackTarget, previousRegistration,
    { fields: currentFields, link: currentLink, registration: currentRegistration });
  if (rollbackTarget?.physical) {
    console.log(`[rollback] 已恢复此前完整实体插件：${linkPath}`);
  } else if (previousTarget) {
    console.log(`[rollback] junction 恢复到：${previousTarget}`);
  } else {
    console.log('[rollback] 首次安装回滚：已移除本插件 junction，无旧版本可恢复。');
  }

  console.log(`[rollback] 已只撤销 ${PLUGIN_NAME} 的变更 ← ${dir}`);
  console.log('[rollback] 其他 dependencies/bundles 未覆盖；未恢复整个 package.json。');
  if (previous.spec) console.log(`[rollback] dependency 恢复为：${previous.spec}`);
}
catchUnhandled();

function catchUnhandled() {
  process.on('uncaughtException', (error) => {
    console.error(`[install] 未处理错误：${error?.stack || error}`);
    process.exit(1);
  });
}

if (has('verify')) {
  if (!verifyInstall()) process.exit(1);
  process.exit(0);
}
if (has('rollback')) {
  rollback();
  process.exit(0);
}
installOrUpgrade();


