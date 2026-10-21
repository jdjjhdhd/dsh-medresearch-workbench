import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync,
  renameSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const PLUGIN = 'dsh-medresearch-model';
const MANIFEST = 'market-assets.json';
const RECORD = '.medresearch-workbench-installation.json';
const OWNER = '.medresearch-market-deployment.json';
const LOCK = '.medresearch-market-deployment.lock';
const PROTECTED = new Set(['data', 'runtime', 'logs', 'backups', 'node_modules', OWNER, RECORD, LOCK]);
const BIOMCP = { size: 47588352, sha256: '2e7a82c7e1a3c7bd056cb22d858c477f6f7f285d5f2dcacdc54324f4e5710d9b' };
const REQUIRED = ['医学研究工作台.html', 'bridge/server.mjs', 'plugin/package.json', 'plugin/dsh.plugin.json', 'plugin/cordis.patch.yml', 'plugin/lib/index.js', 'plugin/lib/client.js'];
const digest = (value) => createHash('sha256').update(value).digest('hex');
const pathKey = (value) => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
const samePath = (left, right) => pathKey(left) === pathKey(right);
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

function relativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\\\x00-\x1f<>:"|?*]/.test(value)
      || isAbsolute(value) || value.split('/').some((part) => !part || part === '.' || part === '..'
        || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error('资源清单包含不安全的相对路径。');
  }
  if (PROTECTED.has(value.split('/')[0].toLowerCase()) || value.split('/').some((part) => part.toLowerCase() === 'node_modules')) {
    throw new Error(`资源清单不能覆盖业务或运行目录：${value}`);
  }
  return value;
}

function regularPath(root, relative, { optional = false, directory = false } = {}) {
  let current = root;
  const parts = relative.split('/');
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    let stat;
    try { stat = lstatSync(current); }
    catch (error) { if (optional && error.code === 'ENOENT') return current; throw error; }
    if (stat.isSymbolicLink()) throw new Error(`资源路径不能包含链接：${relative}`);
    const needDirectory = index < parts.length - 1 || directory;
    if (needDirectory ? !stat.isDirectory() : !stat.isFile()) throw new Error(`资源路径不是${needDirectory ? '目录' : '普通文件'}：${relative}`);
  }
  return current;
}

function plainRoot(root) {
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error('部署根必须是独立目录，不能是链接。');
  const real = realpathSync(root);
  if (real.split(/[\\/]+/).some((part) => part.toLowerCase() === 'node_modules')) throw new Error('node_modules 不能作为工作台部署目录。');
  return real;
}

export function isMarketPackageRoot(root) {
  try {
    regularPath(root, 'package.json');
    const pkg = readJson(join(root, 'package.json'));
    return pkg?.name === PLUGIN && typeof pkg.version === 'string' && Boolean(pkg.version)
      && pkg.medresearchWorkbench?.formatVersion === 1 && pkg.medresearchWorkbench.manifest === MANIFEST;
  } catch { return false; }
}

function assetMetadata(asset) {
  const path = relativePath(asset?.path);
  if (!Number.isSafeInteger(asset.size) || asset.size < 0 || asset.size > 128 * 1024 * 1024
      || !/^[a-f0-9]{64}$/.test(asset.sha256 || '')) throw new Error(`资源尺寸或 SHA-256 无效：${path}`);
  return { path, size: asset.size, sha256: asset.sha256 };
}

function loadManifest(packageRoot) {
  if (!isMarketPackageRoot(packageRoot)) throw new Error('安装源不是医学工作台市场包。');
  regularPath(packageRoot, MANIFEST);
  if (lstatSync(join(packageRoot, MANIFEST)).size > 8 * 1024 * 1024) throw new Error('市场资源清单过大。');
  const bytes = readFileSync(join(packageRoot, MANIFEST));
  const manifest = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  const pkg = readJson(join(packageRoot, 'package.json'));
  if (manifest?.formatVersion !== 1 || manifest.plugin !== PLUGIN || manifest.version !== pkg.version
      || !Array.isArray(manifest.assets) || !manifest.assets.length || manifest.assets.length > 10000) {
    throw new Error('市场资源清单身份、格式或版本无效。');
  }
  const paths = new Set();
  let totalSize = 0;
  const assets = manifest.assets.map((asset) => {
    const meta = assetMetadata(asset);
    const source = relativePath(asset.source);
    const key = meta.path.toLowerCase();
    if (paths.has(key) || [...paths].some((previous) => previous.startsWith(`${key}/`) || key.startsWith(`${previous}/`))) {
      throw new Error(`资源清单路径重复或冲突：${meta.path}`);
    }
    paths.add(key);
    if (asset.compression !== undefined && asset.compression !== 'gzip') throw new Error(`不支持的资源压缩格式：${meta.path}`);
    if (key === 'tools/biomcp.exe' && (meta.size !== BIOMCP.size || meta.sha256 !== BIOMCP.sha256
        || source !== 'assets/biomcp-0.9.3-windows-x64.exe.gz' || asset.compression !== 'gzip')) {
      throw new Error('BioMCP 官方二进制尺寸、SHA-256 或压缩来源不一致。');
    }
    totalSize += meta.size;
    if (totalSize > 512 * 1024 * 1024) throw new Error('市场资源总尺寸超出允许范围。');
    return { ...meta, source, compression: asset.compression };
  });
  if (REQUIRED.some((file) => !paths.has(file.toLowerCase()))) throw new Error('市场资源清单缺少工作台必要文件。');
  return { version: manifest.version, manifestHash: digest(bytes), assets };
}

function contents(packageRoot, asset) {
  regularPath(packageRoot, asset.source);
  if (lstatSync(join(packageRoot, asset.source)).size > 128 * 1024 * 1024) throw new Error(`压缩资源过大：${asset.path}`);
  const compressed = readFileSync(join(packageRoot, asset.source));
  const bytes = asset.compression === 'gzip'
    ? gunzipSync(compressed, { maxOutputLength: Math.max(1, asset.size) }) : compressed;
  if (bytes.length !== asset.size || digest(bytes) !== asset.sha256) throw new Error(`资源尺寸或 SHA-256 校验失败：${asset.path}`);
  return bytes;
}

function ownerInfo(root, profile) {
  regularPath(root, OWNER);
  const owner = readJson(join(root, OWNER));
  if (owner?.formatVersion !== 1 || owner.plugin !== PLUGIN || typeof owner.profileDir !== 'string'
      || !isAbsolute(owner.profileDir) || !samePath(owner.profileDir, profile)
      || typeof owner.projectRoot !== 'string' || !isAbsolute(owner.projectRoot) || !samePath(owner.projectRoot, root)
      || typeof owner.version !== 'string' || !owner.version
      || !/^[a-f0-9]{64}$/.test(owner.manifestHash || '') || !Array.isArray(owner.assets) || !owner.assets.length || owner.assets.length > 10000) {
    throw new Error('部署目录缺少当前 profile 的有效所有权标记，拒绝覆盖。');
  }
  const seen = new Set();
  owner.assets = owner.assets.map((asset) => {
    const meta = assetMetadata(asset);
    if (seen.has(meta.path.toLowerCase())) throw new Error('部署所有权标记含重复路径。');
    seen.add(meta.path.toLowerCase());
    return meta;
  });
  return owner;
}

function verifyAssets(root, assets) {
  for (const asset of assets) {
    regularPath(root, asset.path);
    const bytes = readFileSync(join(root, asset.path));
    if (bytes.length !== asset.size || digest(bytes) !== asset.sha256) throw new Error(`现有部署资源已被修改，未覆盖：${asset.path}`);
  }
}

function readRecord(profile, validateRoot, runtimeHash) {
  const file = join(profile, RECORD);
  if (!existsSync(file)) {
    try { lstatSync(file); throw new Error('安装登记不是普通文件。'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  regularPath(profile, RECORD);
  const record = readJson(file);
  if (record?.schemaVersion !== 1 || record.plugin !== PLUGIN || typeof record.profileDir !== 'string'
      || !isAbsolute(record.profileDir) || !samePath(record.profileDir, profile)) throw new Error('安装登记不属于当前插件或当前 profile。');
  const installation = validateRoot(record.projectRoot);
  if (!installation?.ok) throw new Error(`安装登记已过期：${installation?.error || '无法验证旧目录'}`);
  if (typeof record.pluginDir !== 'string' || !isAbsolute(record.pluginDir) || !samePath(record.pluginDir, installation.pluginDir)
      || record.pluginVersion !== installation.version || !/^[a-f0-9]{64}$/.test(record.runtimeHash || '')
      || runtimeHash(installation.pluginDir) !== record.runtimeHash) throw new Error('旧安装登记的目录、版本或运行代码校验失败。');
  return installation;
}

function atomicWrite(file, bytes) {
  const temp = join(dirname(file), `.medresearch-write-${randomUUID()}.tmp`);
  try { writeFileSync(temp, bytes, { flag: 'wx' }); renameSync(temp, file); }
  finally { try { unlinkSync(temp); } catch { /* 写入或重命名的原始结果决定事务是否成功。 */ } }
}

function acquireLock(profile) {
  const file = join(profile, LOCK);
  const token = randomUUID();
  let descriptor;
  try {
    descriptor = openSync(file, 'wx');
    writeFileSync(descriptor, JSON.stringify({ plugin: PLUGIN, profileDir: profile, pid: process.pid, token }));
  } catch (error) {
    if (descriptor !== undefined) { try { unlinkSync(file); } catch { /* 保留原始写锁错误。 */ } }
    if (error.code === 'EEXIST') throw new Error('医学工作台部署锁仍存在；请等待另一安装完成后重试。若上次安装异常退出，请确认没有部署进程后移除 .medresearch-market-deployment.lock。');
    throw error;
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
  return () => {
    if (readJson(file)?.token !== token) throw new Error('部署锁所有权发生变化，未删除其他进程的锁。');
    unlinkSync(file);
  };
}

function checkBridgeUpgrade(root, assets) {
  const bridge = assets.find((asset) => asset.path === 'bridge/server.mjs');
  if (!bridge || digest(readFileSync(join(root, 'bridge/server.mjs'))) === bridge.sha256) return;
  const file = join(root, 'runtime', 'bridge-service.json');
  try { regularPath(root, 'runtime/bridge-service.json'); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  let record;
  try { record = readJson(file); } catch { throw new Error('旧本地服务登记无法核对；请先停止旧本地服务并重试。'); }
  if (record?.service !== 'medresearch-workbench-bridge' || typeof record.projectRoot !== 'string'
      || !samePath(record.projectRoot, root) || !Number.isInteger(record.pid) || record.pid < 1) {
    throw new Error('旧本地服务登记无法核对；请先停止旧本地服务并重试。');
  }
  try { process.kill(record.pid, 0); }
  catch (error) { if (error.code === 'ESRCH') return; }
  throw new Error('旧本地服务仍在运行；请先停止旧本地服务并重试升级，未启动第二个服务或修改现有资源。');
}

export function ensureMarketDeployment({ packageRoot, profileDir, validateRoot, createRecord, runtimeHash } = {}) {
  let profile = '';
  let release;
  let stage = '';
  try {
    if (typeof profileDir !== 'string' || !isAbsolute(profileDir)) throw new Error('市场部署需要宿主提供绝对 profile 目录。');
    profile = realpathSync(profileDir);
    if (typeof packageRoot !== 'string' || !isAbsolute(packageRoot)) throw new Error('市场包目录必须是绝对路径。');
    const sourceRoot = realpathSync(packageRoot);
    const manifest = loadManifest(sourceRoot);
    if (![validateRoot, createRecord, runtimeHash].every((callback) => typeof callback === 'function')) throw new Error('市场部署缺少安装校验能力。');
    const root = join(profile, 'medresearch-workbench');
    if (root.split(/[\\/]+/).some((part) => part.toLowerCase() === 'node_modules')) throw new Error('node_modules 不能作为工作台部署目录。');
    release = acquireLock(profile);
    const registered = readRecord(profile, validateRoot, runtimeHash);
    if (registered && !samePath(registered.projectRoot, root)) {
      return { ok: true, projectRoot: registered.projectRoot, pluginDir: registered.pluginDir, profileDir: profile, source: 'market-existing-workspace', error: '' };
    }
    let owner = null;
    try {
      lstatSync(root);
      plainRoot(root);
      owner = ownerInfo(root, profile);
    } catch (error) { if (error.code !== 'ENOENT' || existsSync(root)) throw error; }
    if (registered && !owner) throw new Error('已登记部署目录缺少所有权标记，拒绝覆盖。');
    if (owner) {
      verifyAssets(root, owner.assets);
      if (owner.manifestHash === manifest.manifestHash && owner.version === manifest.version) {
        const metadata = (assets) => JSON.stringify(assets.map(({ path, size, sha256 }) => ({ path, size, sha256 })).sort((left, right) => left.path.localeCompare(right.path)));
        if (metadata(owner.assets) !== metadata(manifest.assets)) throw new Error('部署所有权标记与资源清单不一致。');
        const installation = validateRoot(root);
        if (!installation?.ok) throw new Error(installation?.error || '现有部署目录校验失败。');
        if (runtimeHash(installation.pluginDir) !== runtimeHash(join(sourceRoot, 'plugin'))) throw new Error('市场插件与现有部署运行代码不一致。');
        if (!registered) atomicWrite(join(profile, RECORD), `${JSON.stringify(createRecord(root, profile), null, 2)}\n`);
        return { ok: true, projectRoot: root, pluginDir: installation.pluginDir, profileDir: profile, source: 'market-reuse', error: '' };
      }
      checkBridgeUpgrade(root, manifest.assets);
    }
    stage = join(profile, `.medresearch-market-stage-${randomUUID()}`);
    mkdirSync(stage);
    for (const asset of manifest.assets) {
      const bytes = contents(sourceRoot, asset);
      mkdirSync(dirname(join(stage, asset.path)), { recursive: true });
      writeFileSync(join(stage, asset.path), bytes, { flag: 'wx' });
    }
    const staged = validateRoot(stage);
    if (!staged?.ok || staged.version !== manifest.version) throw new Error(staged?.error || '暂存部署的插件版本不一致。');
    if (runtimeHash(staged.pluginDir) !== runtimeHash(join(sourceRoot, 'plugin'))) throw new Error('暂存插件与市场包运行代码不一致。');
    const nextOwner = { formatVersion: 1, plugin: PLUGIN, profileDir: profile, projectRoot: root, version: manifest.version,
      manifestHash: manifest.manifestHash, assets: manifest.assets.map(({ path, size, sha256 }) => ({ path, size, sha256 })) };
    writeFileSync(join(stage, OWNER), `${JSON.stringify(nextOwner, null, 2)}\n`);
    const previousRecord = registered ? readFileSync(join(profile, RECORD)) : null;
    if (!owner) {
      renameSync(stage, root);
      stage = '';
      try { atomicWrite(join(profile, RECORD), `${JSON.stringify(createRecord(root, profile), null, 2)}\n`); }
      catch (error) {
        stage = join(profile, `.medresearch-market-stage-${randomUUID()}`);
        renameSync(root, stage);
        throw error;
      }
    } else {
      const known = new Map(owner.assets.map((asset) => [asset.path.toLowerCase(), asset]));
      const next = new Set(manifest.assets.map((asset) => asset.path.toLowerCase()));
      const changes = [];
      for (const asset of manifest.assets) {
        regularPath(root, asset.path, { optional: true });
        const file = join(root, asset.path);
        if (existsSync(file) && !known.has(asset.path.toLowerCase())) throw new Error(`新资源会覆盖未登记文件，未执行升级：${asset.path}`);
        changes.push({ path: asset.path, before: existsSync(file) ? readFileSync(file) : null, after: readFileSync(join(stage, asset.path)) });
      }
      for (const asset of owner.assets) if (!next.has(asset.path.toLowerCase())) changes.push({ path: asset.path, before: readFileSync(join(root, asset.path)), after: null });
      const previousOwner = readFileSync(join(root, OWNER));
      const applied = [];
      try {
        for (const change of changes) {
          mkdirSync(dirname(join(root, change.path)), { recursive: true });
          if (change.after === null) unlinkSync(join(root, change.path));
          else atomicWrite(join(root, change.path), change.after);
          applied.push(change);
        }
        atomicWrite(join(root, OWNER), readFileSync(join(stage, OWNER)));
        atomicWrite(join(profile, RECORD), `${JSON.stringify(createRecord(root, profile), null, 2)}\n`);
      } catch (error) {
        for (const change of applied.reverse()) {
          if (change.before === null) unlinkSync(join(root, change.path));
          else atomicWrite(join(root, change.path), change.before);
        }
        atomicWrite(join(root, OWNER), previousOwner);
        if (previousRecord) atomicWrite(join(profile, RECORD), previousRecord);
        else if (existsSync(join(profile, RECORD))) unlinkSync(join(profile, RECORD));
        throw error;
      }
    }
    return { ok: true, projectRoot: root, pluginDir: join(root, 'plugin'), profileDir: profile, source: 'market-deployment', error: '' };
  } catch (error) {
    return { ok: false, projectRoot: '', pluginDir: '', profileDir: profile, source: '', error: `医学工作台市场部署失败：${error.message}` };
  } finally {
    if (stage) { try { rmSync(stage, { recursive: true, force: true }); } catch { /* 只遗留本次未发布的暂存副本。 */ } }
    if (release) { try { release(); } catch { /* 所有权改变时保留锁，后续部署会明确失败。 */ } }
  }
}
