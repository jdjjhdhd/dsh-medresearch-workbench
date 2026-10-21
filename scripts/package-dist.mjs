#!/usr/bin/env node
/**
 * 生成 Windows x64 客户交付目录 dist/：只复制运行所需文件及核验过的 BioMCP。
 * 不复制任何密钥或业务数据。
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const BIOMCP_SHA256 = '2e7a82c7e1a3c7bd056cb22d858c477f6f7f285d5f2dcacdc54324f4e5710d9b';

function fail(message) {
  console.error(`[package] ${message}`);
  process.exit(1);
}
function copy(rel) {
  const src = join(ROOT, rel);
  if (!existsSync(src)) fail(`缺少：${rel}`);
  const dest = join(DIST, rel);
  copyTree(src, dest);
  console.log(`[copy] ${rel}`);
}
function copyTree(src, dest) {
  if (!statSync(src).isDirectory()) {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    return;
  }
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    copyTree(join(src, entry.name), join(dest, entry.name));
  }
}

function assertNoSecret(rel) {
  const path = join(DIST, rel);
  if (!existsSync(path) || !statSync(path).isFile()) return;
  if (rel === 'tools/biomcp.exe') return; // 官方二进制按固定 SHA-256 核验，不按文本扫描。
  const text = readFileSync(path, 'utf8');
  for (const needle of ['test-ok', 'sk-', 'DEEPSEEK_API_KEY=', 'OPENAI_API_KEY=']) {
    if (text.includes(needle)) fail(`交付文件中出现敏感字符串 ${needle}：${rel}`);
  }
}
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
function fsIsLink(file) {
  try { return lstatSync(file).isSymbolicLink(); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

const binaryHash = createHash('sha256').update(readFileSync(join(ROOT, 'tools', 'biomcp.exe'))).digest('hex');
if (binaryHash !== BIOMCP_SHA256) fail('BioMCP 与已核验的官方 0.9.3 二进制不一致');

if (resolve(DIST) !== join(resolve(ROOT), 'dist') || !resolve(DIST).startsWith(resolve(ROOT) + sep)) {
  fail('交付清理目录必须是项目内的 dist');
}
if (fsIsLink(DIST)) fail('dist 不能是符号链接，已停止打包');
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

copy('医学研究工作台.html');
copy('vendor/pdfjs');
copy('fixtures');
copy('tools/biomcp.exe');
copy('tools/BioMCP-LICENSE.txt');
copy('tools/biomcp-manifest.json');
copy('bridge/server.mjs');
copy('bridge/README.md');
copy('plugin/package.json');
copy('plugin/dsh.plugin.json');
copy('plugin/cordis.patch.yml');
copy('plugin/lib');
copy('plugin/src');
copy('plugin/README.md');
copy('scripts/install-model-plugin.mjs');
copy('scripts/prepare-market-install.mjs');
copy('scripts/start-bridge.ps1');
copy('安装或升级医学工作台.cmd');
copy('旧版转市场安装.cmd');
copy('启动医学工作台服务（后台）.cmd');
copy('启动医学工作台服务.cmd');
copy('docs/客户安装与模型配置.md');
copy('README-客户版.md');
copy('LICENSE');
copy('THIRD-PARTY-NOTICES.md');

mkdirSync(join(DIST, 'data'), { recursive: true });
writeFileSync(join(DIST, 'data/README.txt'), '工作台业务数据将在首次保存时写入本目录。交付包不包含任何客户数据。\n', 'utf8');

for (const file of walk(DIST)) assertNoSecret(file.slice(DIST.length + 1).replaceAll('\\', '/'));

const files = walk(DIST);
const bytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
console.log(`[package] ${DIST}`);
console.log(`[package] files=${files.length} bytes=${bytes}`);
console.log('[package] tools 仅包含已核验的 BioMCP 程序/许可/来源；已排除业务数据、备份、日志、测试、src 与 node_modules。');

