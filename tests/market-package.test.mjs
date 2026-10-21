import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { BIOMCP_ASSET, MARKET_PAYLOAD, buildMarketPackage, collectMarketPayload } from '../scripts/build-market-package.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TREE_PATHS = new Set(['plugin', 'vendor/pdfjs', 'fixtures']);
const digest = (value) => createHash('sha256').update(value).digest('hex');

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'medresearch-market-package-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function put(path, value = `fixture:${path}\n`) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  }
  for (const path of MARKET_PAYLOAD) put(TREE_PATHS.has(path) ? `${path}/fixture.txt` : path);
  for (const path of ['package.json', 'dsh.plugin.json', 'cordis.patch.yml']) cpSync(join(ROOT, path), join(root, path));
  return { root, put };
}

test('市场根包沿用唯一插件身份、入口与客户端契约', (t) => {
  const { root } = fixture(t);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const descriptor = JSON.parse(readFileSync(join(root, 'dsh.plugin.json'), 'utf8'));
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8');
  assert.equal(pkg.name, 'dsh-medresearch-model');
  assert.equal(pkg.version, '0.2.4');
  assert.equal(descriptor.name, pkg.name);
  assert.equal(descriptor.version, pkg.version);
  assert.equal(descriptor.entry.name, pkg.name);
  assert.equal(pkg.main, './plugin/lib/index.js');
  assert.deepEqual(pkg.exports, {
    '.': './plugin/lib/index.js',
    './client': './plugin/lib/client.js',
    './package.json': './package.json',
  });
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.deepEqual(pkg.dsh.client, { platform: 'web', inject: [] });
  assert.deepEqual(pkg.medresearchWorkbench, { formatVersion: 1, manifest: 'market-assets.json' });
  assert.deepEqual([...patch.matchAll(/^\s*- id:\s*(\S+)/gm)].map((match) => match[1]), ['medresearch-workbench-market']);
  assert.deepEqual([...patch.matchAll(/^\s*name:\s*(\S+)/gm)].map((match) => match[1]), [pkg.name]);
});

test('npm 文件白名单包含运行资源与压缩工具，不发布原始 EXE 或本地状态', (t) => {
  const { root } = fixture(t);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const path of MARKET_PAYLOAD) {
    assert.ok(pkg.files.includes(TREE_PATHS.has(path) ? `${path}/` : path), `缺少打包白名单：${path}`);
  }
  for (const path of [BIOMCP_ASSET.source, 'market-assets.json', 'dsh.plugin.json', 'cordis.patch.yml', 'README.md']) {
    assert.ok(pkg.files.includes(path), `缺少根声明或市场资产：${path}`);
  }
  assert.equal(pkg.files.includes('tools/biomcp.exe'), false);
  assert.equal(pkg.files.includes('tools/'), false);
  assert.equal(pkg.files.includes('assets/'), false);
  assert.ok(pkg.files.every((path) => !/[*?]|(?:^|\/)(?:data|runtime|backups|logs|verify|dist|release|node_modules)(?:\/|$)/u.test(path)));
});

test('仅声明显式开发命令，不设置安装生命周期、下载或自动依赖安装', (t) => {
  const { root } = fixture(t);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.scripts, {
    build: 'node scripts/build-single.mjs',
    'build:market': 'node scripts/build-market-package.mjs',
    test: 'node --test tests/*.test.mjs',
  });
  for (const name of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly']) {
    assert.equal(Object.hasOwn(pkg.scripts, name), false);
  }
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.optionalDependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.ok(Object.values(pkg.scripts).every((command) => !/https?:|curl|wget|(?:npm|pnpm|yarn)\s+(?:add|install)/iu.test(command)));
});

test('临时资源树只为白名单生成大小与哈希，不读取业务状态或清单自身', (t) => {
  const { root, put } = fixture(t);
  for (const path of ['data/private.json', 'runtime/state.json', 'backups/old.json', 'logs/run.log', 'verify/local.txt', 'dist/old.txt', 'release/old.txt', 'node_modules/unrelated/index.js', 'market-assets.json', 'assets/old.gz', 'tools/biomcp.exe']) {
    put(path, 'excluded');
  }
  put('plugin/src/host/example.js', 'export const fixture = true;\n');
  put('vendor/pdfjs/LICENSE', 'license fixture\n');
  const assets = collectMarketPayload(root);
  assert.equal(assets.length, MARKET_PAYLOAD.length + 2);
  assert.deepEqual(assets.map((asset) => asset.path), assets.map((asset) => asset.path).sort());
  for (const asset of assets) {
    assert.equal(asset.source, asset.path);
    const bytes = readFileSync(join(root, asset.path));
    assert.equal(asset.size, bytes.length);
    assert.equal(asset.sha256, digest(bytes));
    assert.equal(asset.compression, undefined);
  }
  assert.equal(assets.some((asset) => /(?:^|\/)(?:data|runtime|backups|logs|verify|dist|release|node_modules)(?:\/|$)/u.test(asset.path)), false);
  assert.equal(assets.some((asset) => asset.path === 'market-assets.json' || asset.path === 'tools/biomcp.exe'), false);
  assert.equal(assets.some((asset) => asset.path.startsWith('assets/')), false);
});

test('白名单目录中出现运行状态也停止构建，不能混入完整 plugin 树', (t) => {
  const { root, put } = fixture(t);
  put('plugin/runtime/private.json', 'private fixture');
  assert.throws(() => collectMarketPayload(root), /不允许业务、运行或凭据文件/u);
});

test('拒绝指向包外目录的符号链接，不生成越界资源', (t) => {
  const { root } = fixture(t);
  const outside = mkdtempSync(join(tmpdir(), 'medresearch-market-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'outside.txt'), 'outside fixture');
  symlinkSync(outside, join(root, 'plugin', 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => collectMarketPayload(root), /不允许符号链接/u);
});

test('BioMCP 固定官方大小、哈希与唯一 gzip 路径，错误文件不会生成资产', (t) => {
  const { root, put } = fixture(t);
  assert.deepEqual(BIOMCP_ASSET, {
    path: 'tools/biomcp.exe',
    source: 'assets/biomcp-0.9.3-windows-x64.exe.gz',
    size: 47588352,
    sha256: '2e7a82c7e1a3c7bd056cb22d858c477f6f7f285d5f2dcacdc54324f4e5710d9b',
    compression: 'gzip',
  });
  put('tools/biomcp.exe', 'not the official binary');
  assert.throws(() => buildMarketPackage({ root, log: () => {} }), /官方 0\.9\.3/u);
  assert.equal(existsSync(join(root, BIOMCP_ASSET.source)), false);
  assert.equal(existsSync(join(root, 'market-assets.json')), false);
});

test('无原始 EXE 时可用包内官方 gzip 重建，不写回原始 EXE', (t) => {
  const { root, put } = fixture(t);
  const packagedGzip = join(ROOT, BIOMCP_ASSET.source);
  const compressed = existsSync(packagedGzip)
    ? readFileSync(packagedGzip)
    : gzipSync(readFileSync(join(ROOT, BIOMCP_ASSET.path)), { level: 9 });
  put(BIOMCP_ASSET.source, compressed);
  assert.equal(existsSync(join(root, BIOMCP_ASSET.path)), false);
  const result = buildMarketPackage({ root, log: () => {} });
  const rebuilt = readFileSync(join(root, BIOMCP_ASSET.source));
  const binary = gunzipSync(rebuilt);
  assert.equal(binary.length, BIOMCP_ASSET.size);
  assert.equal(digest(binary), BIOMCP_ASSET.sha256);
  assert.ok(rebuilt.length < 25 * 1024 * 1024);
  assert.equal(result.gzipSha256, digest(rebuilt));
  assert.deepEqual(result.manifest.assets.find((asset) => asset.path === BIOMCP_ASSET.path), BIOMCP_ASSET);
  assert.equal(result.manifest.assets.length, MARKET_PAYLOAD.length + 1);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'market-assets.json'), 'utf8')), result.manifest);
  assert.equal(existsSync(join(root, BIOMCP_ASSET.path)), false);
});

test('无原始 EXE 时拒绝损坏 gzip，保留原文件且不生成清单', (t) => {
  const { root, put } = fixture(t);
  put(BIOMCP_ASSET.source, 'broken gzip fixture');
  assert.throws(() => buildMarketPackage({ root, log: () => {} }), /本地 BioMCP gzip 损坏/u);
  assert.equal(readFileSync(join(root, BIOMCP_ASSET.source), 'utf8'), 'broken gzip fixture');
  assert.equal(existsSync(join(root, 'market-assets.json')), false);
});

test('gzip 解压后仍须匹配固定官方大小与哈希', (t) => {
  const { root, put } = fixture(t);
  put(BIOMCP_ASSET.source, gzipSync('unofficial binary fixture'));
  assert.throws(() => buildMarketPackage({ root, log: () => {} }), /官方 0\.9\.3/u);
  assert.equal(existsSync(join(root, 'market-assets.json')), false);
});

test('EXE 与 gzip 均缺失时给出本地文件提示，不生成资产', (t) => {
  const { root } = fixture(t);
  assert.throws(() => buildMarketPackage({ root, log: () => {} }), /缺少本地 BioMCP.*不会联网下载/u);
  assert.equal(existsSync(join(root, BIOMCP_ASSET.source)), false);
  assert.equal(existsSync(join(root, 'market-assets.json')), false);
});
