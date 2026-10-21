import assert from 'node:assert/strict';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { createInstallationRecord, installationRecordPath } from '../plugin/src/host/installation.js';

const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function copy(source, destination) {
  const stat = lstatSync(source);
  assert.equal(stat.isSymbolicLink(), false);
  if (stat.isDirectory()) {
    mkdirSync(destination, { recursive: true });
    for (const name of readdirSync(source)) copy(join(source, name), join(destination, name));
  } else {
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
}
async function call(routes, suffix, method = 'GET') {
  const req = Readable.from(method === 'GET' ? [] : ['{}']);
  req.url = `/api/medresearch/model/${suffix}`;
  req.method = method;
  let status;
  let body;
  const res = { writableEnded: false, writeHead(code) { status = code; },
    end(text) { body = JSON.parse(text); this.writableEnded = true; } };
  await routes.get(req.url)(req, res);
  return { status, body };
}

test('copied host routes use the registered customer directory and reject a missing registration', async (t) => {
  const temp = mkdtempSync(join(tmpdir(), 'medwb-route-installation-'));
  t.after(() => {
    assert.ok(resolve(temp).startsWith(resolve(tmpdir()) + sep));
    rmSync(temp, { recursive: true, force: true });
  });
  const customer = join(temp, 'customer'), profile = join(temp, 'profile');
  mkdirSync(join(customer, 'bridge'), { recursive: true });
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(customer, '医学研究工作台.html'), '<title>customer fixture</title>');
  writeFileSync(join(customer, 'bridge/server.mjs'), '// fixture: never executed');
  copy(join(SOURCE, 'plugin'), join(customer, 'plugin'));
  copy(join(customer, 'plugin'), join(profile, 'node_modules/dsh-medresearch-model'));
  writeFileSync(installationRecordPath(profile), JSON.stringify(createInstallationRecord(customer, profile)));

  let healthCalls = 0;
  const occupied = http.createServer((req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/health');
    healthCalls++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'different-fixture-service' }));
  });
  await new Promise((done) => occupied.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => occupied.close(done)));
  const oldPort = process.env.MEDWB_PORT;
  process.env.MEDWB_PORT = String(occupied.address().port);
  t.after(() => { if (oldPort === undefined) delete process.env.MEDWB_PORT; else process.env.MEDWB_PORT = oldPort; });

  const { apply } = await import(pathToFileURL(join(profile, 'node_modules/dsh-medresearch-model/src/host/routes.js')).href);
  const routes = new Map();
  const services = { profileContext: { dir: profile }, connection: { requestRejection: () => undefined },
    webServer: { register: ({ path, handler }) => routes.set(path, handler) } };
  apply({ get: (name) => services[name], logger: { error() {}, warn() {} } });
  const valid = await call(routes, 'worktable-info');
  assert.equal(valid.status, 200);
  assert.equal(valid.body.projectRoot, customer);
  assert.equal(valid.body.installationSource, 'registration');
  assert.equal(valid.body.pageExists, true);
  assert.equal(valid.body.bridge.online, false);
  assert.equal(healthCalls, 1);
  assert.match(valid.body.pageUrl, new RegExp(encodeURIComponent(customer).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(existsSync(join(customer, 'runtime')), false);

  rmSync(installationRecordPath(profile));
  for (const [suffix, method] of [['worktable-info', 'GET'], ['service/ensure', 'POST']]) {
    const missing = await call(routes, suffix, method);
    assert.equal(missing.status, 503);
    assert.equal(missing.body.error.code, 'installation-unavailable');
    assert.match(missing.body.error.message, /完整客户目录/);
    assert.equal(missing.body.projectRoot, undefined);
  }
  assert.equal(healthCalls, 1);
  assert.equal((await call(routes, 'health')).status, 200);
});
