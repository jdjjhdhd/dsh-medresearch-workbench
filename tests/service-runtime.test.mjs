import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createBridgeService } from '../plugin/src/host/service.js';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function inside(target, temp) {
  const relative = path.relative(path.resolve(temp), path.resolve(target));
  assert.ok(relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)));
}

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  assert.notEqual(port, 8765);
  return port;
}

test('project services survive host restarts, move away from occupied ports and never cross project data', { timeout: 60000 }, async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'medwb-service-'));
  const projects = ['A-old', 'B-upgrade', 'C-stranger', 'D-concurrent', 'E-old-directory-gone', 'F-same-host', 'G-slow-health'].map((name) => path.join(temp, name));
  const bridgePids = new Set();
  const hosts = new Set();
  const strangers = [];
  const env = { ZOTERO_BASE_URL: `http://127.0.0.1:${await freePort()}/api`, MEDWB_LOG: '0' };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  if (process.env.WINDIR) env.WINDIR = process.env.WINDIR;
  t.after(async () => {
    for (const host of hosts) if (host.exitCode === null && host.signalCode === null) host.kill();
    // 只结束本测试 ensure 返回 started:true 的 PID，不读取/结束正式运行记录中的进程。
    for (const pid of bridgePids) {
      assert.ok(Number.isInteger(pid) && pid > 0 && pid !== process.pid);
      try { process.kill(pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    for (const server of strangers) await new Promise((done) => server.close(done));
    await delay(150);
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith('medwb-service-'));
    for (const root of projects) inside(root, temp);
    await fs.rm(temp, { recursive: true, force: true });
  });
  for (const root of projects) {
    inside(root, temp);
    await fs.mkdir(path.join(root, 'bridge'), { recursive: true });
    await fs.mkdir(path.join(root, 'data'), { recursive: true });
    await fs.copyFile(new URL('../bridge/server.mjs', import.meta.url), path.join(root, 'bridge', 'server.mjs'));
    await fs.writeFile(path.join(root, 'data', 'workbench-data.json'), JSON.stringify({ version: 1, items: [], notes: [], tasks: [], topics: [], cases: [], searches: [] }));
  }
  const runner = path.join(temp, 'host.mjs');
  inside(runner, temp);
  await fs.writeFile(runner, `import { createBridgeService } from ${JSON.stringify(new URL('../plugin/src/host/service.js', import.meta.url).href)};
const service = createBridgeService({ projectRoot: process.argv[2], environment: process.env, nodeExecutable: process.execPath });
const before = await service.bridgeStatus();
const result = await service.ensureBridge();
console.log('MEDWB_RESULT=' + JSON.stringify({ before, result }));
`);

  async function runHost(root, port) {
    inside(root, temp);
    assert.notEqual(port, 8765);
    const child = spawn(process.execPath, [runner, root], {
      cwd: temp, env: { ...env, MEDWB_PORT: String(port) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    hosts.add(child);
    let output = '';
    let errorOutput = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { errorOutput += chunk; });
    const timeout = setTimeout(() => child.kill(), 35000);
    let code;
    try { [code] = await once(child, 'exit'); } finally { clearTimeout(timeout); hosts.delete(child); }
    const line = output.split(/\r?\n/).find((value) => value.startsWith('MEDWB_RESULT='));
    assert.equal(code, 0, errorOutput || output);
    assert.ok(line, errorOutput || output);
    const value = JSON.parse(line.slice('MEDWB_RESULT='.length));
    if (value.result.started && value.result.pid) bridgePids.add(value.result.pid);
    assert.equal(value.result.online, true, JSON.stringify(value));
    assert.equal(value.result.health.projectRoot, await fs.realpath(root));
    return value;
  }

  const aPort = await freePort();
  const a = await runHost(projects[0], aPort);
  assert.equal(a.result.started, true);
  const aData = path.join(projects[0], 'data', 'workbench-data.json');
  const aHash = digest(await fs.readFile(aData));
  const b = await runHost(projects[1], aPort);
  assert.equal(b.result.started, true);
  assert.notEqual(b.result.url, a.result.url);
  assert.match(b.result.note, /目录.*不一致.*自动使用/);
  const beforeB = digest(await fs.readFile(path.join(projects[1], 'data', 'workbench-data.json')));
  const denied = await fetch(a.result.url + '/data/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-medresearch-project-root': encodeURIComponent(projects[1]) },
    body: JSON.stringify({ data: { items: [{ id: 'must-not-cross' }] } }),
    signal: AbortSignal.timeout(2500),
  });
  assert.equal(denied.status, 403);
  assert.equal(digest(await fs.readFile(aData)), aHash);
  assert.equal(digest(await fs.readFile(path.join(projects[1], 'data', 'workbench-data.json'))), beforeB);
  assert.equal((await (await fetch(a.result.url + '/health')).json()).projectRoot, projects[0]);

  // 全新宿主进程先 status 读 runtime，再 ensure 复用同一地址/服务，不新建进程。
  const bAgain = await runHost(projects[1], aPort);
  assert.equal(bAgain.before.online, true);
  assert.equal(bAgain.before.url, b.result.url);
  assert.equal(bAgain.result.url, b.result.url);
  assert.equal(bAgain.result.started, false);
  const bRecord = JSON.parse(await fs.readFile(path.join(projects[1], 'runtime', 'bridge-service.json'), 'utf8'));
  assert.equal(bRecord.pid, b.result.pid);

  // 记录的动态端口已失活，但首选端口已由用户手动启动同根服务时，应复用首选服务。
  const bRecordFile = path.join(projects[1], 'runtime', 'bridge-service.json');
  await fs.writeFile(bRecordFile, JSON.stringify({ ...bRecord, port: await freePort() }));
  const bOnPreferred = await runHost(projects[1], Number(new URL(b.result.url).port));
  assert.equal(bOnPreferred.result.started, false);
  assert.equal(bOnPreferred.result.url, b.result.url);

  const stranger = http.createServer((request, response) => { response.writeHead(503, { 'content-type': 'text/plain' }); response.end('stranger-stays-alive'); });
  stranger.listen(0, '127.0.0.1');
  strangers.push(stranger);
  await once(stranger, 'listening');
  const strangerPort = stranger.address().port;
  assert.notEqual(strangerPort, 8765);
  await fs.mkdir(path.join(projects[2], 'runtime'), { recursive: true });
  // 复制来的 A 记录不可授权 C 复用 A 服务。
  await fs.copyFile(path.join(projects[0], 'runtime', 'bridge-service.json'), path.join(projects[2], 'runtime', 'bridge-service.json'));
  const c = await runHost(projects[2], strangerPort);
  assert.notEqual(c.result.url, `http://127.0.0.1:${strangerPort}`);
  assert.notEqual(c.result.url, a.result.url);
  assert.match(c.result.note, /HTTP 503.*自动使用/);
  assert.equal(await (await fetch(`http://127.0.0.1:${strangerPort}/health`)).text(), 'stranger-stays-alive');

  // 模拟已退出宿主留下的、明确属于 D 的锁，然后从两个独立宿主并发 ensure。
  const exited = spawn(process.execPath, ['-e', ''], { env, windowsHide: true, stdio: 'ignore' });
  await once(exited, 'exit');
  await fs.mkdir(path.join(projects[3], 'runtime'), { recursive: true });
  await fs.writeFile(path.join(projects[3], 'runtime', 'bridge-start.lock'), JSON.stringify({ token: 'confirmed-dead-host', pid: exited.pid, projectRoot: projects[3], at: Date.now() - 60000 }));
  const dPort = await freePort();
  const [d1, d2] = await Promise.all([runHost(projects[3], dPort), runHost(projects[3], dPort)]);
  assert.equal(d1.result.url, d2.result.url);
  assert.equal([d1, d2].filter((value) => value.result.started).length, 1);
  assert.equal(await fs.stat(path.join(projects[3], 'runtime', 'bridge-start.lock')).then(() => true, () => false), false);
  const dRecord = JSON.parse(await fs.readFile(path.join(projects[3], 'runtime', 'bridge-service.json'), 'utf8'));
  assert.ok(bridgePids.has(dRecord.pid));
  assert.equal(bridgePids.size, 4);
  assert.equal(digest(await fs.readFile(aData)), aHash);

  // Windows 会锁住运行进程的 cwd；用同协议的健康响应模拟目录已删而服务仍存的情况。
  const goneRoot = path.join(temp, 'removed-previous-installation');
  inside(goneRoot, temp);
  await fs.mkdir(goneRoot);
  await fs.rmdir(goneRoot);
  const oldMissing = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, service: 'medresearch-workbench-bridge', projectRoot: goneRoot }));
  });
  oldMissing.listen(0, '127.0.0.1');
  strangers.push(oldMissing);
  await once(oldMissing, 'listening');
  const missingPort = oldMissing.address().port;
  assert.notEqual(missingPort, 8765);
  const e = await runHost(projects[4], missingPort);
  assert.notEqual(e.result.url, `http://127.0.0.1:${missingPort}`);
  assert.match(e.result.note, /目录.*不一致.*自动使用/);
  assert.equal((await (await fetch(`http://127.0.0.1:${missingPort}/health`)).json()).projectRoot, goneRoot);

  const sameHost = createBridgeService({ projectRoot: projects[5], preferredPort: aPort, environment: env, nodeExecutable: process.execPath });
  const first = sameHost.ensureBridge();
  const second = sameHost.ensureBridge();
  assert.equal(first, second);
  const f = await first;
  if (f.started && f.pid) bridgePids.add(f.pid);
  assert.equal(f.online, true, JSON.stringify(f));
  assert.equal(f.health.projectRoot, projects[5]);
  assert.equal(bridgePids.size, 6);

  // 真实子进程的健康响应超过旧 1.2 秒阈值，启动器仍应等待就绪，不能误杀后另启。
  await fs.writeFile(path.join(projects[6], 'bridge', 'server.mjs'), `import http from 'node:http';
const body = JSON.stringify({ ok: true, service: 'medresearch-workbench-bridge', projectRoot: ${JSON.stringify(projects[6])} });
http.createServer((req, res) => setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(body); }, 1800)).listen(Number(process.env.MEDWB_PORT), '127.0.0.1');
`);
  const started = Date.now();
  const g = await runHost(projects[6], await freePort());
  assert.equal(g.result.started, true);
  assert.ok(Date.now() - started >= 1800);
  assert.equal(bridgePids.size, 7);
});
