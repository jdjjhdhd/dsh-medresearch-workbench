/**
 * 把 src/shell.html + src/*.js 构建为可交付的单文件窗口。
 * PDF.js 保留在 vendor/（体积大且需要独立 worker），其余脚本全部内联。
 *
 * 用法：node scripts/build-single.mjs
 * 产物：医学研究工作台.html
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shell = fs.readFileSync(path.join(root, 'src', 'shell.html'), 'utf8');
const order = ['core', 'model', 'views', 'reader', 'search', 'cases', 'events', 'boot'];
let out = shell;
let missing = [];
for (const name of order) {
  const tag = `<script src="./src/${name}.js"></script>`;
  if (!out.includes(tag)) { missing.push(tag); continue; }
  let js = fs.readFileSync(path.join(root, 'src', `${name}.js`), 'utf8');
  js = js.replace(/<\/script/gi, '<\\/script');
  const block = `<script>\n/* ===== ${name}.js ===== */\n${js}\n</script>`;
  // 用函数替换，避免 JS 中的 $$ / $& / $' 被当作 replace 的替换模板。
  out = out.replace(tag, () => block);
}
if (missing.length) {
  console.error('missing script tags:', missing.join('\n'));
  process.exit(1);
}
if (out.includes('<script src="./src/')) {
  console.error('some src scripts were not inlined');
  process.exit(1);
}
const target = path.join(root, '医学研究工作台.html');
fs.writeFileSync(target, out, 'utf8');
console.log(JSON.stringify({
  target,
  bytes: Buffer.byteLength(out),
  lines: out.split(/\r?\n/).length,
  remainingScripts: [...out.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]),
  pdfjsVendor: fs.existsSync(path.join(root, 'vendor', 'pdfjs', 'pdf.min.js'))
}, null, 2));

