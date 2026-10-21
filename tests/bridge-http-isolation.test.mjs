import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');

function assertInsideTemp(target, temp) {
  const relative = path.relative(path.resolve(temp), path.resolve(target));
  assert.ok(relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)));
}

async function freePort() {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  assert.notEqual(port, 8765);
  return port;
}

async function snapshot(directory, temp) {
  assertInsideTemp(directory, temp);
  const result = {};
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    assertInsideTemp(file, temp);
    assert.equal(entry.isSymbolicLink(), false);
    if (entry.isDirectory()) {
      const children = await snapshot(file, temp);
      for (const [name, digest] of Object.entries(children)) result[`${entry.name}/${name}`] = digest;
    } else {
      result[entry.name] = hash(await fs.readFile(file));
    }
  }
  return result;
}

async function startBridge(root, zoteroPort) {
  const port = await freePort();
  assert.notEqual(port, zoteroPort);
  const env = {
    MEDWB_PORT: String(port),
    MEDWB_LOG: '0',
    ZOTERO_BASE_URL: `http://127.0.0.1:${zoteroPort}/api`,
  };
  // 子进程只接收系统必需项，不继承开发者的账号、模型或其他服务凭据。
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  if (process.env.WINDIR) env.WINDIR = process.env.WINDIR;
  const child = spawn(process.execPath, [path.join(root, 'bridge', 'server.mjs')], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let spawnError = null;
  child.stdout.on('data', (chunk) => { output = (output + chunk).slice(-4000); });
  child.stderr.on('data', (chunk) => { output = (output + chunk).slice(-4000); });
  child.on('error', (error) => { spawnError = error; });
  const closed = new Promise((resolve) => child.once('close', resolve));
  const bridge = { child, closed, url: `http://127.0.0.1:${port}` };
  try {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`临时桥接提前退出：${output}`);
      try {
        const response = await fetch(bridge.url + '/health', { signal: AbortSignal.timeout(700) });
        const health = await response.json();
        if (response.ok && health.ok) return { ...bridge, health };
      } catch {
        // 随机端口上的本测试进程正在启动，只重试该地址。
      }
      await delay(60);
    }
    throw new Error(`临时桥接未就绪：${output}`);
  } catch (error) {
    await stopBridge(bridge);
    throw error;
  }
}

async function stopBridge(bridge) {
  if (!bridge || !bridge.child.pid) return;
  const child = bridge.child;
  if (child.exitCode !== null || child.signalCode !== null) {
    await bridge.closed;
    return;
  }
  child.kill('SIGTERM');
  const deadline = Date.now() + 2500;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await delay(25);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await bridge.closed;
}

async function request(bridge, route, { root, method = 'GET', body } = {}) {
  const headers = {};
  if (root !== undefined) headers['x-medresearch-project-root'] = encodeURIComponent(root);
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(bridge.url + route, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, body: await response.json() };
}

test('isolated HTTP bridge rejects another project and persists a PDF without Zotero across a process restart', { timeout: 30000 }, async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'medwb-http-'));
  assert.equal(path.dirname(temp), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temp).startsWith('medwb-http-'));
  const a = path.join(temp, 'A');
  const b = path.join(temp, 'B');
  let bridge = null;
  t.after(async () => {
    await stopBridge(bridge);
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith('medwb-http-'));
    assertInsideTemp(a, temp);
    assertInsideTemp(b, temp);
    await fs.rm(temp, { recursive: true, force: true });
  });
  const blank = { version: 1, updatedAt: 1, items: [], topics: [], notes: [], tasks: [], cases: [], searches: [] };
  for (const root of [a, b]) {
    assertInsideTemp(root, temp);
    await fs.mkdir(path.join(root, 'bridge'), { recursive: true });
    await fs.mkdir(path.join(root, 'data', 'uploads'), { recursive: true });
    await fs.copyFile(new URL('../bridge/server.mjs', import.meta.url), path.join(root, 'bridge', 'server.mjs'));
    await fs.writeFile(path.join(root, 'data', 'workbench-data.json'), JSON.stringify(blank));
    await fs.writeFile(path.join(root, 'data', 'uploads', 'keep.pdf'), `unchanged-${path.basename(root)}`);
  }
  const pdf = await fs.readFile(new URL('../fixtures/sample-paper.pdf', import.meta.url));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const zoteroPort = await freePort();
  bridge = await startBridge(a, zoteroPort);
  assert.equal(bridge.health.service, 'medresearch-workbench-bridge');
  assert.equal(bridge.health.projectRoot, await fs.realpath(a));
  assert.equal(bridge.health.zotero.connected, false);
  assert.equal(bridge.health.llm.configured, false);
  const beforeA = await snapshot(path.join(a, 'data'), temp);
  const beforeB = await snapshot(path.join(b, 'data'), temp);
  const upload = { name: 'paper.pdf', mime: 'application/pdf', base64: pdf.toString('base64') };
  for (const root of [b, undefined]) {
    for (const [route, options] of [
      ['/data/load', {}],
      ['/data/save', { method: 'POST', body: { data: { ...blank, updatedAt: 2 } } }],
      ['/files/upload', { method: 'POST', body: upload }],
    ]) {
      const denied = await request(bridge, route, { root, ...options });
      assert.equal(denied.status, 403, `${route} must reject ${root === undefined ? 'missing identity' : 'project B'}`);
    }
  }
  const preflight = await fetch(bridge.url + '/files/upload', {
    method: 'OPTIONS',
    headers: { origin: 'dsh-app://app', 'access-control-request-headers': 'content-type,x-medresearch-project-root' },
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-headers'), /x-medresearch-project-root/);
  assert.deepEqual(await snapshot(path.join(a, 'data'), temp), beforeA);
  assert.deepEqual(await snapshot(path.join(b, 'data'), temp), beforeB);

  const uploaded = await request(bridge, '/files/upload', { root: a, method: 'POST', body: upload });
  assert.equal(uploaded.status, 200);
  assert.match(uploaded.body.path, /^data\/uploads\//);
  assert.equal(path.isAbsolute(uploaded.body.path), false);
  const pdfFile = path.resolve(a, uploaded.body.path);
  assertInsideTemp(pdfFile, temp);
  assert.equal(hash(await fs.readFile(pdfFile)), hash(pdf));
  const data = {
    ...blank,
    updatedAt: Date.now(),
    items: [{ id: 'paper-1', title: 'Temporary integration paper', filePath: uploaded.body.path }],
    notes: [{ id: 'note-1', itemId: 'paper-1', body: 'Temporary note kept across restart' }],
    tasks: [{ id: 'task-1', subjectType: 'item', subjectId: 'paper-1', title: 'Temporary linked task', status: 'todo' }],
  };
  const saved = await request(bridge, '/data/save', { root: a, method: 'POST', body: { data } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.pathWarnings, []);
  const savedDigest = hash(await fs.readFile(path.join(a, 'data', 'workbench-data.json')));
  await stopBridge(bridge);
  bridge = null;
  bridge = await startBridge(a, zoteroPort);
  assert.equal(bridge.health.projectRoot, await fs.realpath(a));
  assert.equal(bridge.health.zotero.connected, false);
  const restored = await request(bridge, '/data/load', { root: a });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.items[0].filePath, uploaded.body.path);
  assert.deepEqual(restored.body.notes, data.notes);
  assert.deepEqual(restored.body.tasks, data.tasks);
  assert.deepEqual(restored.body.pathWarnings, []);
  assert.equal(hash(await fs.readFile(path.join(a, 'data', 'workbench-data.json'))), savedDigest);
  assert.equal(hash(await fs.readFile(path.resolve(a, restored.body.items[0].filePath))), hash(pdf));
  assert.deepEqual(await snapshot(path.join(b, 'data'), temp), beforeB);
});
