import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureMarketDeployment, isMarketPackageRoot } from './market-deployment.js';

export const INSTALLATION_FILENAME = '.medresearch-workbench-installation.json';
export const INSTALLATION_PLUGIN_ID = 'dsh-medresearch-model';
const HTML_FILE = '医学研究工作台.html';
const REINSTALL = '请在完整客户目录执行安装脚本以登记位置。';

function samePath(left, right) {
  const normalize = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
  return normalize(resolve(left)) === normalize(resolve(right));
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function assertFile(file) {
  if (!lstatSync(file).isFile()) throw new Error(`不是普通文件：${file}`);
}

function packageInfo(pluginDir) {
  const pkg = readJson(join(pluginDir, 'package.json'));
  const descriptor = readJson(join(pluginDir, 'dsh.plugin.json'));
  if (pkg.name !== INSTALLATION_PLUGIN_ID || descriptor.name !== INSTALLATION_PLUGIN_ID
      || descriptor.entry?.name !== INSTALLATION_PLUGIN_ID) {
    throw new Error('目录不属于医学工作台插件，拒绝使用。');
  }
  if (!pkg.version || descriptor.version !== pkg.version) throw new Error('插件版本声明不一致。');
  return pkg;
}

// 仅遍历本插件的两处运行代码目录；不读取业务资料或宿主的其他插件。
export function pluginRuntimeHash(pluginDir) {
  const files = ['package.json', 'dsh.plugin.json', 'cordis.patch.yml'];
  function walk(relative) {
    if (!lstatSync(join(pluginDir, relative)).isDirectory()) throw new Error('插件运行代码目录无效或指向其他目录。');
    for (const entry of readdirSync(join(pluginDir, relative), { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error('插件运行代码中存在链接，无法安全校验副本。');
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) files.push(child);
      else throw new Error('插件运行代码中存在非普通文件。');
    }
  }
  walk('lib');
  walk('src/host');
  const hash = createHash('sha256');
  for (const relative of files.sort()) {
    const file = join(pluginDir, relative);
    assertFile(file);
    hash.update(relative).update('\0').update(readFileSync(file)).update('\0');
  }
  return hash.digest('hex');
}

export function validateInstallationRoot(projectRoot) {
  try {
    if (typeof projectRoot !== 'string' || !isAbsolute(projectRoot)) throw new Error('工作台目录必须是绝对路径。');
    const root = realpathSync(projectRoot);
    if (root.split(/[\\/]+/).some((part) => part.toLowerCase() === 'node_modules')) {
      throw new Error('node_modules 不能作为工作台交付目录。');
    }
    assertFile(join(root, HTML_FILE));
    assertFile(join(root, 'bridge', 'server.mjs'));
    const pluginDir = realpathSync(join(root, 'plugin'));
    if (!samePath(dirname(pluginDir), root)) throw new Error('交付目录中的 plugin 不能指向其他目录。');
    const pkg = packageInfo(pluginDir);
    return { ok: true, projectRoot: root, pluginDir, version: pkg.version, error: '' };
  } catch (error) {
    return { ok: false, projectRoot: '', pluginDir: '', version: '', error: `工作台目录校验失败：${error.message}` };
  }
}

export function installationRecordPath(profileDir) {
  return join(resolve(profileDir), INSTALLATION_FILENAME);
}

export function createInstallationRecord(projectRoot, profileDir) {
  const installation = validateInstallationRoot(projectRoot);
  if (!installation.ok) throw new Error(installation.error);
  if (!isAbsolute(profileDir)) throw new Error('profile 目录必须是绝对路径。');
  return {
    schemaVersion: 1,
    plugin: INSTALLATION_PLUGIN_ID,
    profileDir: realpathSync(profileDir),
    projectRoot: installation.projectRoot,
    pluginDir: installation.pluginDir,
    pluginVersion: installation.version,
    runtimeHash: pluginRuntimeHash(installation.pluginDir),
    registeredAt: new Date().toISOString(),
  };
}

export function resolveInstallation({ moduleUrl = import.meta.url, profileDir = '' } = {}) {
  let profile = '';
  try {
    const loadedPluginDir = realpathSync(resolve(dirname(fileURLToPath(moduleUrl)), '..', '..'));
    const loadedPackage = packageInfo(loadedPluginDir);
    const direct = validateInstallationRoot(dirname(loadedPluginDir));
    // 市场包位于 node_modules；业务资料需放到独立、持久的工作台目录。
    if (!direct.ok && isMarketPackageRoot(dirname(loadedPluginDir))) {
      return ensureMarketDeployment({
        packageRoot: dirname(loadedPluginDir),
        profileDir,
        validateRoot: validateInstallationRoot,
        createRecord: createInstallationRecord,
        runtimeHash: pluginRuntimeHash,
      });
    }
    if (profileDir) {
      if (typeof profileDir !== 'string' || !isAbsolute(profileDir)) throw new Error('宿主 profile 目录无效。');
      profile = realpathSync(profileDir);
      const recordFile = installationRecordPath(profile);
      let recordStat;
      try { recordStat = lstatSync(recordFile); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (recordStat) {
        if (!recordStat.isFile()) throw new Error('安装登记不是普通文件。');
        let record;
        try { record = readJson(recordFile); }
        catch { throw new Error('安装登记无法解析。'); }
        if (record?.schemaVersion !== 1 || record.plugin !== INSTALLATION_PLUGIN_ID
            || typeof record.profileDir !== 'string' || !isAbsolute(record.profileDir)
            || !samePath(record.profileDir, profile)) throw new Error('安装登记不属于当前插件或当前 profile。');
        const registered = validateInstallationRoot(record.projectRoot);
        if (!registered.ok) throw new Error(`安装登记已过期。${registered.error}`);
        if (typeof record.pluginDir !== 'string' || !isAbsolute(record.pluginDir)
            || !samePath(record.pluginDir, registered.pluginDir)
            || record.pluginVersion !== registered.version || record.pluginVersion !== loadedPackage.version) {
          throw new Error('安装登记与当前插件目录或版本不一致。');
        }
        if (direct.ok && !samePath(loadedPluginDir, registered.pluginDir)) {
          throw new Error('当前加载的原目录插件与安装登记来自不同交付目录。');
        }
        if (!/^[a-f0-9]{64}$/.test(record.runtimeHash || '')
            || pluginRuntimeHash(registered.pluginDir) !== record.runtimeHash
            || pluginRuntimeHash(loadedPluginDir) !== record.runtimeHash) {
          throw new Error('插件运行代码与安装登记不一致；可能仍加载同版本旧副本。');
        }
        return { ok: true, projectRoot: registered.projectRoot, pluginDir: registered.pluginDir, profileDir: profile, source: 'registration', error: '' };
      }
    }
    if (direct.ok && samePath(direct.pluginDir, loadedPluginDir)) {
      return { ok: true, projectRoot: direct.projectRoot, pluginDir: direct.pluginDir, profileDir: profile, source: 'module-realpath', error: '' };
    }
    throw new Error(profile ? '当前 profile 缺少医学工作台安装登记。' : '无法确认实体插件副本所属的宿主 profile。');
  } catch (error) {
    return { ok: false, projectRoot: '', pluginDir: '', profileDir: profile, source: '', error: `${error.message} ${REINSTALL}` };
  }
}

export function resolveHostInstallation(ctx, options = {}) {
  let profileDir = '';
  try { profileDir = ctx?.get?.('profileContext')?.dir || ''; }
  catch { /* 旧宿主没有 profileContext 时仍可校验原目录，但不会猜测副本所属 profile。 */ }
  return resolveInstallation({ ...options, profileDir });
}
