import assert from 'node:assert/strict';
import test from 'node:test';
import { detectBiomcp } from '../bridge/server.mjs';

test('missing BioMCP files are reported separately from execution failure', () => {
  const result = detectBiomcp({ candidates: ['missing.exe'], exists: () => false, exec: () => assert.fail('must not execute a missing file') });
  assert.equal(result.found, false);
  assert.equal(result.installed, false);
  assert.equal(result.reason, 'not-found');
  assert.match(result.note, /不是 BioMCP/);
});

test('an existing executable that cannot start is not marked installed', () => {
  const result = detectBiomcp({
    candidates: ['cannot-run.exe'], exists: () => true,
    exec: () => { throw Object.assign(new Error('test execution failure'), { code: 'EACCES' }); },
  });
  assert.equal(result.found, true);
  assert.equal(result.installed, false);
  assert.equal(result.reason, 'execution-failed');
  assert.equal(result.failures[0].code, 'EACCES');
  assert.match(result.note, /可能/);
});

test('empty, unrelated and malformed version output is rejected', () => {
  for (const output of ['', '   ', 'node 24.14.0', 'biomcp unknown', 'biomcp 0.9', 'error\nbiomcp 0.9.3']) {
    const result = detectBiomcp({ candidates: ['bad-version.exe'], exists: () => true, exec: () => output });
    assert.equal(result.found, true);
    assert.equal(result.installed, false, JSON.stringify(output));
    assert.equal(result.reason, 'invalid-version');
  }
});

test('a working later candidate is selected after missing and broken candidates', () => {
  const calls = [];
  const result = detectBiomcp({
    candidates: ['missing.exe', 'broken.exe', 'valid.exe'],
    exists: (file) => file !== 'missing.exe',
    exec: (file, args, options) => {
      calls.push(file);
      assert.deepEqual(args, ['--version']);
      assert.equal(options.windowsHide, true);
      assert.equal(options.timeout, 8000);
      if (file === 'broken.exe') throw Object.assign(new Error('test timeout'), { code: 'ETIMEDOUT' });
      return 'biomcp 0.9.3\r\n';
    },
  });
  assert.deepEqual(calls, ['broken.exe', 'valid.exe']);
  assert.equal(result.found, true);
  assert.equal(result.installed, true);
  assert.equal(result.path, 'valid.exe');
  assert.equal(result.mode, 'binary');
  assert.equal(result.version, '0.9.3');
});

test('an invalid-version candidate does not hide a later released or development build', () => {
  const result = detectBiomcp({
    candidates: ['wrong-tool.exe', 'development.exe'], exists: () => true,
    exec: (file) => file === 'wrong-tool.exe' ? 'another-tool 1.2.3' : 'biomcp 0.9.3-dev+g123abc',
  });
  assert.equal(result.installed, true);
  assert.equal(result.version, '0.9.3-dev+g123abc');
});

test('repeated paths are tested only once and never become unknown installed versions', () => {
  let attempts = 0;
  const result = detectBiomcp({
    candidates: ['same.exe', 'same.exe'], exists: () => true,
    exec: () => { attempts++; return 'biomcp unknown'; },
  });
  assert.equal(attempts, 1);
  assert.equal(result.installed, false);
  assert.equal(result.version, undefined);
});
