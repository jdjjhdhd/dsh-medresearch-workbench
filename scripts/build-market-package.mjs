#!/usr/bin/env node
/** 生成市场安装所需的资源清单与 BioMCP 压缩资产；不下载或安装依赖。 */
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MARKET_PLUGIN = 'dsh-medresearch-model';
export const MARKET_VERSION = '0.2.4';
export const BIOMCP_ASSET = Object.freeze({
  path: 'tools/biomcp.exe',
  source: 'assets/biomcp-0.9.3-windows-x64.exe.gz',
  size: 47588352,
  sha256: '2e7a82c7e1a3c7bd056cb22d858c477f6f7f285d5f2dcacdc54324f4e5710d9b',
  compression: 'gzip',
});
export const MARKET_PAYLOAD = Object.freeze([
  '医学研究工作台.html',
  'vendor/pdfjs',
  'fixtures',
  'plugin',
  'bridge/server.mjs',
  'bridge/README.md',
  'tools/BioMCP-LICENSE.txt',
  'tools/biomcp-manifest.json',
  'scripts/install-model-plugin.mjs',
  'scripts/prepare-market-install.mjs',
  'scripts/start-bridge.ps1',
  '安装或升级医学工作台.cmd',
  '旧版转市场安装.cmd',
  '启动医学工作台服务（后台）.cmd',
  '启动医学工作台服务.cmd',
  'docs/客户安装与模型配置.md',
  'README-客户版.md',
  'LICENSE',
  'THIRD-PARTY-NOTICES.md',
]);
const FORBIDDEN_SEGMENTS = new Set([
  'data', 'runtime', 'backups', 'logs', 'verify', 'dist', 'release', 'node_modules', '.git',
  '.dsh-worktable', '.medresearch-workbench-installation.json',
  '.medresearch-market-deployment.json', '.medresearch-market-deployment.lock',
]);
const MAX_COMPRESSED_BYTES = 25 * 1024 * 1024;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertRelativePath(path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || /[\\:\0]/u.test(path)
      || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`资源路径必须是包内的相对路径：${path}`);
  }
  if (path.split('/').some((part) => FORBIDDEN_SEGMENTS.has(part.toLowerCase())
      || /^\.env(?:\.|$)/iu.test(part)
      || /(?:credentials|\.pem$|\.key$|\.pfx$|\.p12$)/iu.test(part))) {
    throw new Error(`资源白名单中不允许业务、运行或凭据文件：${path}`);
  }
}

/** 检查每级路径，避免目录符号链接绕过根目录约束。 */
function checkedPath(root, path, { missing = false } = {}) {
  assertRelativePath(path);
  const absolute = resolve(root, ...path.split('/'));
  const withinRoot = relative(root, absolute);
  if (!withinRoot || withinRoot === '..' || withinRoot.startsWith(`..${sep}`) || isAbsolute(withinRoot)) {
    throw new Error(`资源路径超出包根目录：${path}`);
  }
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    let info;
    try { info = lstatSync(current); }
    catch (error) {
      if (missing && error.code === 'ENOENT') continue;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error(`资源不允许符号链接：${path}`);
  }
  return absolute;
}

function checkedRoot(root) {
  const absolute = resolve(root);
  const info = lstatSync(absolute);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('包根目录必须是普通目录，不能是符号链接');
  return absolute;
}

/** 只遍历明确列出的运行资源；根清单与压缩产物不会参与自我哈希。 */
export function collectMarketPayload(root = ROOT) {
  root = checkedRoot(root);
  const assets = [];
  function visit(path) {
    const absolute = checkedPath(root, path);
    const info = lstatSync(absolute);
    if (info.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) visit(`${path}/${name}`);
      return;
    }
    if (!info.isFile()) throw new Error(`资源必须是普通文件：${path}`);
    const bytes = readFileSync(absolute);
    assets.push({ path, source: path, size: bytes.length, sha256: sha256(bytes) });
  }
  for (const path of MARKET_PAYLOAD) visit(path);
  return assets.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

function outputPath(root, path) {
  const absolute = checkedPath(root, path, { missing: true });
  try {
    if (!lstatSync(absolute).isFile()) throw new Error(`输出路径必须是普通文件：${path}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  mkdirSync(dirname(absolute), { recursive: true });
  return absolute;
}

function readBiomcpBinary(root) {
  try {
    return readFileSync(checkedPath(root, BIOMCP_ASSET.path));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let compressed;
  try {
    compressed = readFileSync(checkedPath(root, BIOMCP_ASSET.source));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(`缺少本地 BioMCP：需要 ${BIOMCP_ASSET.path} 或 ${BIOMCP_ASSET.source}；构建不会联网下载`);
  }
  try {
    // 在固定官方大小附近停止解压，避免损坏或异常压缩文件占用过量内存。
    return gunzipSync(compressed, { maxOutputLength: BIOMCP_ASSET.size + 1 });
  } catch (error) {
    throw new Error(`本地 BioMCP gzip 损坏或解压后超出官方大小：${BIOMCP_ASSET.source}`, { cause: error });
  }
}

export function buildMarketPackage({ root = ROOT, log = console.log } = {}) {
  root = checkedRoot(root);
  const metadata = JSON.parse(readFileSync(checkedPath(root, 'package.json'), 'utf8'));
  if (metadata.name !== MARKET_PLUGIN || metadata.version !== MARKET_VERSION) {
    throw new Error(`根包必须是 ${MARKET_PLUGIN}@${MARKET_VERSION}`);
  }
  const binary = readBiomcpBinary(root);
  if (binary.length !== BIOMCP_ASSET.size || sha256(binary) !== BIOMCP_ASSET.sha256) {
    throw new Error('BioMCP 必须是已核验的官方 0.9.3 Windows x64 EXE（大小与 SHA-256 均须匹配）');
  }
  const assets = [...collectMarketPayload(root), { ...BIOMCP_ASSET }]
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const compressed = gzipSync(binary, { level: 9 });
  if (compressed.length >= MAX_COMPRESSED_BYTES) throw new Error('BioMCP gzip 必须小于 25 MiB，无法用于网页上传');
  const manifest = { formatVersion: 1, plugin: MARKET_PLUGIN, version: MARKET_VERSION, assets };
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  // 先验证两个输出路径，再写文件，避免输出符号链接造成部分写入。
  const compressedPath = outputPath(root, BIOMCP_ASSET.source);
  const manifestPath = outputPath(root, 'market-assets.json');
  writeFileSync(compressedPath, compressed);
  writeFileSync(manifestPath, serialized, 'utf8');
  const summary = {
    assets: assets.length,
    payloadBytes: assets.reduce((sum, asset) => sum + asset.size, 0),
    gzipBytes: compressed.length,
    gzipSha256: sha256(compressed),
    manifestSha256: sha256(serialized),
    biomcpSha256: BIOMCP_ASSET.sha256,
  };
  log(`[market-package] ${JSON.stringify(summary)}`);
  return { manifest, manifestPath, compressedPath, ...summary };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { buildMarketPackage(); }
  catch (error) {
    console.error(`[market-package] ${error.message}`);
    process.exitCode = 1;
  }
}
