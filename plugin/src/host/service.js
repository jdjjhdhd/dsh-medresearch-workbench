/** 本地文件服务按项目启动；只探测环回地址，不终止已有端口占用者。 */
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVICE = 'medresearch-workbench-bridge';
const starts = new Map();
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const portNumber = (value) => Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) < 65536 ? Number(value) : 8765;
const sameRoot = (a, b) => Boolean(a && b && resolve(a).toLowerCase() === resolve(b).toLowerCase());
const localUrl = (port) => `http://127.0.0.1:${port}`;

// 兼容原目录/junction 的调用；实体副本必须由宿主安装定位器提供 projectRoot。
const sourceRoot = resolve(dirname(realpathSync(fileURLToPath(import.meta.url))), '..', '..', '..');
export const PROJECT_ROOT = existsSync(join(sourceRoot, 'bridge', 'server.mjs')) ? sourceRoot : '';
export const BRIDGE_SCRIPT = PROJECT_ROOT ? join(PROJECT_ROOT, 'bridge', 'server.mjs') : '';
export const BRIDGE_PORT = portNumber(process.env.MEDWB_PORT || 8765);
export const BRIDGE_URL = localUrl(BRIDGE_PORT);

export function matchesBridgeProject(body, root = PROJECT_ROOT) {
  return Boolean(body?.ok === true && body.service === SERVICE
    && typeof body.projectRoot === 'string' && sameRoot(body.projectRoot, root));
}

export function checkNodeVersion(executable, exec = execFileSync) {
  try {
    const version = String(exec(executable, ['-p', 'process.versions.node'], {
      encoding: 'utf8', windowsHide: true, timeout: 4000,
    })).trim();
    return { ok: /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version) && Number(version.split('.')[0]) >= 20, version };
  } catch { return { ok: false, version: '' }; }
}

function findNode(environment, explicit) {
  if (explicit) return existsSync(explicit) && checkNodeVersion(explicit).ok ? explicit : '';
  const candidates = [];
  if (/node(\.exe)?$/i.test(process.execPath || '')) candidates.push(process.execPath);
  candidates.push(environment.DSH_DESKTOP_NODE_EXECUTABLE, environment.MEDRESEARCH_NODE);
  candidates.push(join(dirname(process.execPath), 'resources', 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'));
  try {
    candidates.push(...String(execFileSync('where.exe', ['node.exe'], {
      encoding: 'utf8', windowsHide: true, timeout: 4000, env: environment,
    })).split(/\r?\n/).map((x) => x.trim()));
  } catch { /* 继续检查常见安装位置。 */ }
  candidates.push('C:\\Program Files\\nodejs\\node.exe', 'C:\\Program Files (x86)\\nodejs\\node.exe');
  return [...new Set(candidates)].find((candidate) => candidate && existsSync(candidate) && checkNodeVersion(candidate).ok) || '';
}

async function unusedPort() {
  const listener = net.createServer();
  return new Promise((done, fail) => {
    listener.once('error', fail);
    listener.listen(0, '127.0.0.1', () => {
      const port = listener.address().port;
      listener.close((error) => error ? fail(error) : done(port));
    });
  });
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

export function createBridgeService({ projectRoot, preferredPort, environment = process.env, nodeExecutable } = {}) {
  let root = '';
  if (typeof projectRoot === 'string' && projectRoot.trim() && isAbsolute(projectRoot)) {
    try { root = realpathSync(projectRoot); } catch { /* 未能验证的目录不能作为启动 cwd。 */ }
  }
  const preferred = portNumber(preferredPort ?? environment.MEDWB_PORT ?? 8765);
  const script = root ? join(root, 'bridge', 'server.mjs') : '';
  const runtime = root ? join(root, 'runtime') : '';
  const recordFile = root ? join(runtime, 'bridge-service.json') : '';
  const lockFile = root ? join(runtime, 'bridge-start.lock') : '';
  const lockAddress = process.platform === 'win32'
    ? `\\\\.\\pipe\\medwb-bridge-start-${createHash('sha256').update(root.toLowerCase()).digest('hex')}`
    : root ? join(runtime, 'bridge-start.sock') : '';
  const unavailable = (error, port = preferred) => ({ online: false, started: false, url: localUrl(port), error });

  function record() {
    const value = root ? readJson(recordFile) : null;
    return value?.service === SERVICE && sameRoot(value.projectRoot, root)
      && Number.isInteger(value.port) && value.port > 0 && value.port < 65536 ? value : null;
  }

  function saveRecord(port, pid, note = '') {
    const temp = `${recordFile}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, JSON.stringify({ version: 1, service: SERVICE, projectRoot: root, port, pid, note, at: new Date().toISOString() }) + '\n');
      renameSync(temp, recordFile);
    } finally {
      try { unlinkSync(temp); } catch { /* 原子重命名成功后临时文件已不存在。 */ }
    }
  }

  async function probePort(port, timeoutMs = 4000) {
    const url = localUrl(port);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${url}/health`, { signal: controller.signal });
      const body = await response.json().catch(() => null);
      if (response.ok && matchesBridgeProject(body, root)) return { online: true, health: body, url };
      return {
        online: false, blocked: true, conflict: true, url,
        error: body?.service === SERVICE
          ? `端口 ${port} 的服务目录与当前项目不一致或未提供目录信息`
          : response.ok ? `端口 ${port} 的响应不是医学工作台文件服务` : `端口 ${port} 返回 HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        online: false,
        blocked: error?.cause?.code !== 'ECONNREFUSED' && error?.code !== 'ECONNREFUSED',
        url,
        error: error?.name === 'AbortError' ? `端口 ${port} 的本地文件服务响应超时` : `端口 ${port} 的本地文件服务未启动`,
      };
    } finally { clearTimeout(timer); }
  }

  async function locate() {
    if (!root) return { state: unavailable('无法确定工作台安装目录，请重新安装插件后重试。'), port: preferred };
    const saved = record();
    let savedState;
    if (saved) {
      const state = await probePort(saved.port);
      if (state.online) return { state: { ...state, ...(saved.note ? { note: saved.note } : {}) }, port: saved.port };
      if (saved.port === preferred) return { state, port: saved.port };
      savedState = state;
    }
    const preferredState = await probePort(preferred);
    if (preferredState.online) return { state: preferredState, port: preferred };
    if (savedState && !savedState.blocked) return { state: savedState, port: saved.port };
    return { state: preferredState, port: preferred };
  }

  async function acquireLock() {
    mkdirSync(runtime, { recursive: true });
    if (!sameRoot(realpathSync(runtime), runtime)) throw new Error('runtime 必须是当前项目内的独立目录，不能指向其他目录。');
    const token = randomUUID();
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      let guard;
      try {
        guard = await new Promise((done, fail) => {
          const listener = net.createServer((socket) => socket.destroy());
          listener.once('error', fail);
          listener.listen(lockAddress, () => { listener.unref(); done(listener); });
        });
        // Windows 命名管道由内核排他持有，宿主退出自动释放；取得后才能回收旧文件锁。
        const owner = readJson(lockFile);
        if (existsSync(lockFile) && owner?.token && sameRoot(owner.projectRoot, root) && !pidAlive(owner.pid)) {
          unlinkSync(lockFile);
        }
        writeFileSync(lockFile, JSON.stringify({ token, pid: process.pid, projectRoot: root, at: Date.now() }), { flag: 'wx' });
        const ownedGuard = guard;
        return async () => {
          try {
            if (readJson(lockFile)?.token === token) {
              try { unlinkSync(lockFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
            }
          } finally {
            await new Promise((done) => ownedGuard.close(done));
          }
        };
      } catch (error) {
        if (guard) await new Promise((done) => guard.close(done));
        if (error.code !== 'EEXIST' && error.code !== 'EADDRINUSE') throw error;
        // 未知/仍存活的文件锁只等待，不删除；管道占用也不会结束其拥有者。
        await sleep(150);
      }
    }
    throw new Error('同一项目的文件服务仍在启动，等待 30 秒超时；未终止任何进程，请稍后重试。');
  }

  async function launch(node, port) {
    let child;
    try {
      child = await new Promise((done, fail) => {
        const next = spawn(node, [script], {
          cwd: root, detached: true, windowsHide: true, stdio: 'ignore',
          env: { ...environment, MEDWB_PORT: String(port) },
        });
        next.once('error', fail);
        next.once('spawn', () => { next.unref(); done(next); });
      });
      const deadline = Date.now() + 18000;
      while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) break;
        await sleep(200);
        const state = await probePort(port, Math.max(1, Math.min(12000, deadline - Date.now())));
        if (state.online) return { ...state, started: true, pid: child.pid, child };
        // 自己启动的服务可能正在检测 Zotero/BioMCP，网络超时不能证明端口属于其他项目。
        if (state.conflict) break;
      }
      // 只终止本次启动且未就绪的子进程，绝不按端口/PID 记录结束已有服务。
      if (child.exitCode === null && child.signalCode === null) child.kill();
      return unavailable('本地文件服务启动后未就绪；请重试或检查 Node.js 与项目目录。', port);
    } catch (error) {
      if (child?.pid && child.exitCode === null && child.signalCode === null) child.kill();
      return unavailable(`启动本地文件服务失败：${error?.message || error}`, port);
    }
  }

  async function start() {
    if (!root) return unavailable('无法确定工作台安装目录，请重新安装插件后重试。');
    if (!existsSync(script)) return unavailable(`找不到桥接服务：${script}`);
    const current = await locate();
    if (current.state.online) return { ...current.state, started: false };
    const node = findNode(environment, nodeExecutable);
    if (!node) return unavailable('需要可运行的 Node.js 20+ 才能启动本地文件服务；请安装或配置 Node.js 20+ 后重试。');
    let release;
    try {
      release = await acquireLock();
      const checked = await locate();
      if (checked.state.online) return { ...checked.state, started: false };
      let port = checked.state.blocked ? await unusedPort() : checked.port;
      let reason = checked.state.blocked ? checked.state.error : '';
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await launch(node, port);
        if (result.online) {
          const { child, ...publicResult } = result;
          const note = reason ? `${reason}；已为当前项目自动使用 ${result.url}，未关闭原服务。` : '';
          try { saveRecord(port, result.pid, note); } catch (error) {
            if (child.exitCode === null && child.signalCode === null) child.kill();
            throw error;
          }
          return { ...publicResult, ...(note ? { note } : {}) };
        }
        // OS 分配的空闲端口在启动前仍可能被抢占，最多重新分配两次，不扫描端口。
        const state = await probePort(port, 800);
        if (!state.conflict || attempt === 2) return result;
        reason ||= state.error;
        port = await unusedPort();
      }
    } catch (error) {
      return unavailable(`本地文件服务启动失败：${error?.message || error}`);
    } finally { if (release) await release(); }
  }

  function ensureBridge() {
    if (!root) return Promise.resolve(unavailable('无法确定工作台安装目录，请重新安装插件后重试。'));
    const key = root.toLowerCase();
    if (starts.has(key)) return starts.get(key);
    const pending = start().finally(() => { if (starts.get(key) === pending) starts.delete(key); });
    starts.set(key, pending);
    return pending;
  }

  async function bridgeStatus() { return (await locate()).state; }
  async function probe(timeoutMs = 2500) { return probePort(record()?.port || preferred, timeoutMs); }
  return { ensureBridge, bridgeStatus, probe };
}

const defaultService = createBridgeService({ projectRoot: PROJECT_ROOT });
export const ensureBridge = (...args) => defaultService.ensureBridge(...args);
export const bridgeStatus = (...args) => defaultService.bridgeStatus(...args);
export const probe = (...args) => defaultService.probe(...args);
