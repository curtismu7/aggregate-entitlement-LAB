import assert from 'node:assert/strict';
import test from 'node:test';
import { allPassed, runChecks } from '../src/doctor.js';
import { createHealth } from '../src/health.js';

const level = (checks, id) => checks.find((c) => c.id === id)?.level;

test('doctor: defaults pass; a non-loopback bind without opt-in fails', () => {
  assert.ok(allPassed(runChecks({ env: {} })));
  assert.equal(level(runChecks({ env: { AGG_ENT_BIND: '0.0.0.0' } }), 'bind'), 'pass');
  assert.equal(level(runChecks({ env: {} }), 'real'), 'pass');
});

test('doctor says whether Real is configured and never prints a URL or a key', () => {
  const env = { AGG_ENT_GW_URL: 'https://gw-should-not-print.example.invalid', AGG_ENT_GW_APPS: 'a', AGG_ENT_GW_KEY_X: 'key-should-not-print' };
  const checks = runChecks({ env });
  assert.equal(level(checks, 'real'), 'info');
  assert.ok(!JSON.stringify(checks).includes('should-not-print'));
});

test('health: demo-health/1, no counts or detail, and the state follows the doctor', () => {
  const body = (runChecks) => { const h = createHealth({ runChecks, env: {} }); let b; h.router.handle({ method: 'GET', url: '/', headers: {} }, { set() {}, json(x) { b = x; } }, () => {}); h.stop(); return b; };
  assert.equal(body(() => [{ level: 'pass' }]).schema, 'demo-health/1');
  assert.equal(body(() => [{ level: 'pass' }]).state, 'ready');
  assert.equal(body(() => [{ level: 'setup' }]).state, 'needs-setup');
  assert.equal(body(() => [{ level: 'fail' }, { level: 'setup' }]).state, 'broken');
  assert.equal(body(() => { throw new Error('x'); }).state, 'unknown');
  assert.equal(body(() => [{ level: 'pass' }]).demo.id, 'aggregate-entitlement');
});
