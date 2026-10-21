import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesBridgeProject, createBridgeService, checkNodeVersion, PROJECT_ROOT } from '../plugin/src/host/service.js';

test('the host rejects missing roots, wrong services and other projects', () => {
  assert.equal(matchesBridgeProject({ ok: true, service: 'medresearch-workbench-bridge' }), false);
  assert.equal(matchesBridgeProject({ ok: true, service: 'other', projectRoot: PROJECT_ROOT }), false);
  assert.equal(matchesBridgeProject({ ok: true, service: 'medresearch-workbench-bridge', projectRoot: 'C:\\another-project' }), false);
  assert.equal(matchesBridgeProject({ ok: true, service: 'medresearch-workbench-bridge', projectRoot: PROJECT_ROOT }), true);
});

test('status refuses an occupied wrong-project endpoint without starting a process', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, service: 'medresearch-workbench-bridge', projectRoot: 'C:\\another-project' }) });
  try {
    const result = await createBridgeService({ projectRoot: PROJECT_ROOT, preferredPort: 49199 }).bridgeStatus();
    assert.equal(result.online, false);
    assert.equal(result.blocked, true);
    assert.match(result.error, /目录.*不一致/);
  } finally { globalThis.fetch = previous; }
});

test('an unresolved installation root cannot start a bridge', async () => {
  const result = await createBridgeService({ projectRoot: '' }).ensureBridge();
  assert.equal(result.online, false);
  assert.equal(result.started, false);
  assert.match(result.error, /安装目录/);
});

test('Node version detection rejects old, malformed and unavailable runtimes', () => {
  for (const version of ['18.20.4', '19.0.0', '', 'not node']) {
    assert.equal(checkNodeVersion('unused', () => version).ok, false);
  }
  assert.equal(checkNodeVersion('unused', () => { throw new Error('not executable'); }).ok, false);
  assert.equal(checkNodeVersion('unused', () => '20.18.0').ok, true);
  assert.equal(checkNodeVersion('unused', () => '22.12.0').ok, true);
});
