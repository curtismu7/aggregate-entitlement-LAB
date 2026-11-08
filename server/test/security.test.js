import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedHostNames, assertBindAllowed, bindHost, hostCheck, isLoopbackHost, sameOriginWrites } from '../src/security.js';

const run = (mw, req) => new Promise((resolve) => {
  const res = { status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
  mw(req, res, () => resolve({ code: 200 }));
});

test('loopback names are recognised, others are not', () => {
  for (const h of ['localhost', '127.0.0.1', '127.9.9.9', '::1', '[::1]', 'LOCALHOST']) assert.ok(isLoopbackHost(h), h);
  for (const h of ['public.example', '10.0.0.1', '0.0.0.0', '127.0.0.1.evil.invalid', '']) assert.ok(!isLoopbackHost(h), h);
});

test('bind: loopback by default, anything else needs AGG_ENT_BIND', () => {
  assert.equal(bindHost({}), '127.0.0.1');
  assert.equal(assertBindAllowed('127.0.0.1', {}), '127.0.0.1');
  assert.throws(() => assertBindAllowed('0.0.0.0', {}), /AGG_ENT_BIND/);
  assert.equal(assertBindAllowed('0.0.0.0', { AGG_ENT_BIND: '0.0.0.0' }), '0.0.0.0');
});

test('Host check: loopback passes, a rebinding name is refused, an operator-listed name passes', async () => {
  const mw = hostCheck({});
  assert.equal((await run(mw, { headers: { host: '127.0.0.1:7802' } })).code, 200);
  assert.equal((await run(mw, { headers: { host: 'localhost:7802' } })).code, 200);
  assert.equal((await run(mw, { headers: { host: '[::1]:7802' } })).code, 200);
  assert.equal((await run(mw, { headers: { host: 'evil.example:7802' } })).code, 403);
  assert.equal((await run(mw, { headers: {} })).code, 403);
  const listed = hostCheck({ AGG_ENT_BIND: '0.0.0.0', AGG_ENT_ALLOWED_HOSTS: 'tools.lan', LAB_ALLOWED_HOSTS: 'lab.example' });
  assert.equal((await run(listed, { headers: { host: 'tools.lan:80' } })).code, 200);
  assert.equal((await run(listed, { headers: { host: 'lab.example:80' } })).code, 200);
  assert.deepEqual(allowedHostNames({ AGG_ENT_BIND: '192.168.1.5' }), ['192.168.1.5']);
});

test('same-origin writes: GET is free; a write needs an Origin equal to Host', async () => {
  const mw = sameOriginWrites();
  assert.equal((await run(mw, { method: 'GET', headers: {} })).code, 200);
  assert.equal((await run(mw, { method: 'POST', headers: { host: 'localhost:1', origin: 'http://localhost:1' } })).code, 200);
  assert.equal((await run(mw, { method: 'POST', headers: { host: 'localhost:1' } })).code, 403);
  assert.equal((await run(mw, { method: 'POST', headers: { host: 'localhost:1', origin: 'http://evil.example' } })).code, 403);
  assert.equal((await run(mw, { method: 'DELETE', headers: { host: 'localhost:1', origin: 'http://localhost:2' } })).code, 403);
  assert.equal((await run(mw, { method: 'POST', headers: { host: 'localhost:1', origin: 'null' } })).code, 403);
});

test('behind the lab-proxy: a write is accepted only with the proxy\'s forwarded origin AND a listed Host', async () => {
  const env = { LAB_ALLOWED_HOSTS: 'aggregate-entitlement-lab.local.ping-devops.com' };
  const mw = sameOriginWrites(env);
  const proxyHost = 'aggregate-entitlement-lab.local.ping-devops.com:7802';
  const fwd = { 'x-forwarded-host': 'local.ping-devops.com:8443', 'x-forwarded-proto': 'https' };
  const via = (headers, host = proxyHost, m = mw) => run(m, { method: 'POST', headers: { host, ...headers } });
  // what the browser and the proxy really send for a same-origin POST
  assert.equal((await via({ ...fwd, origin: 'https://local.ping-devops.com:8443', 'sec-fetch-site': 'same-origin' })).code, 200);
  assert.equal((await via({ ...fwd, origin: 'https://local.ping-devops.com:8443' })).code, 200);
  assert.equal((await via({ 'x-forwarded-host': 'local.ping-devops.com:8443', origin: 'https://local.ping-devops.com:8443' })).code, 200, 'proto defaults to https');
  // refused: a foreign origin, a mismatched forwarded host, a wrong scheme, a cross-site fetch, no forwarded host at all
  for (const headers of [
    { ...fwd, origin: 'https://evil.example' },
    { ...fwd, origin: 'https://local.ping-devops.com:9999' },
    { ...fwd, origin: 'http://local.ping-devops.com:8443' },
    { ...fwd, origin: 'https://local.ping-devops.com:8443', 'sec-fetch-site': 'cross-site' },
    { origin: 'https://local.ping-devops.com:8443' },
    { 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https', origin: 'https://local.ping-devops.com:8443' },
    { ...fwd, 'x-forwarded-proto': 'ftp', origin: 'ftp://local.ping-devops.com:8443' },
  ]) assert.equal((await via(headers)).code, 403, JSON.stringify(headers));
  // the forwarded headers are not believed on a loopback Host, nor on an unlisted one
  for (const host of ['127.0.0.1:7802', 'localhost:7802', 'other.example:7802']) {
    assert.equal((await via({ ...fwd, origin: 'https://local.ping-devops.com:8443' }, host)).code, 403, host);
  }
  // and without LAB_ALLOWED_HOSTS the same request is refused
  assert.equal((await via({ ...fwd, origin: 'https://local.ping-devops.com:8443' }, proxyHost, sameOriginWrites({}))).code, 403);
});

test('behind the lab-proxy, end to end: POST /api/mode with the proxy\'s headers reaches the handler, and is refused on a loopback Host', async () => {
  const { startApp } = await import('./helpers.js');
  const { request } = await import('node:http');
  const app = await startApp({ env: { LAB_ALLOWED_HOSTS: 'aggregate-entitlement-lab.local.ping-devops.com' } });
  try {
    const post = (host) => new Promise((resolve, reject) => {
      const body = JSON.stringify({ source: 'mock' });
      const r = request({ host: '127.0.0.1', port: app.port, path: '/api/mode', method: 'POST', setHost: false, headers: {
        host, origin: 'https://local.ping-devops.com:8443', 'x-forwarded-host': 'local.ping-devops.com:8443', 'x-forwarded-proto': 'https',
        'content-type': 'application/json', 'content-length': Buffer.byteLength(body), connection: 'close' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      r.on('error', reject); r.end(body);
    });
    assert.equal(await post(`aggregate-entitlement-lab.local.ping-devops.com:${app.port}`), 200);
    assert.equal(await post(`127.0.0.1:${app.port}`), 403);
  } finally { await app.close(); }
});
