// "What Privilege did" (rule 25): the traces this lab builds. Mock traces come from the simulation and are `checked`; Real traces come from the
// exchanges the lab's own MCP client captured against a loopback stub gateway and may only be `inferred` or `observed`. Every trace passes the
// shared assertTrace, and no key or full session id is in any of them.
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { normalizeConfig } from '../src/gateway/config.js';
import { freshConfig } from '../src/gateway/fixture.js';
import { mockCallTrace, mockListTrace } from '../src/gateway/aggregateTrace.js';
import { audit, callAggregate, callMember, callerOf, listAggregate, listMember, memberOf } from '../src/gateway/sim.js';
import { assertTrace } from '../src/gatewayTrace.js';
import { startApp } from './helpers.js';
import { installGuard } from './netguard.js';

const T = { timeout: 60_000 };
// Fake secrets, built at run time from parts so nothing key-shaped sits in the source.
const KEY_A = ['lab', 'analyst', 'key', '0123456789'].join('-');
const KEY_B = ['lab', 'guest', 'key', '9876543210'].join('-');
const KEY_BAD = ['lab', 'unknown', 'key', '5555555555'].join('-');
const SESSION = ['sess', 'abcdefghij', 'klmnopqrst'].join('-');

const cfg = normalizeConfig(freshConfig());
const ids = (t) => t.decisions.map((d) => `${d.id}:${d.outcome}`);
const only = (t, outcome) => t.decisions.filter((d) => d.outcome === outcome).map((d) => d.id);

// ---- Mock: the simulation's own checks -------------------------------------------------------------------------------------------------
test('mock tools/list trace: every caller and view passes assertTrace, every decision is checked, and the host is not a real one', T, () => {
  for (const callerId of ['analyst', 'operator', 'guest']) {
    const caller = callerOf(cfg, callerId);
    for (const [view, member] of [['aggregate', null], ...cfg.members.map((m) => ['direct', m])]) {
      const listed = view === 'direct' ? listMember(cfg, member, callerId) : listAggregate(cfg, callerId);
      const t = mockListTrace({ cfg, caller, view, member, listed });
      assert.deepEqual(assertTrace(t), [], `${callerId} ${view} ${member?.id}`);
      assert.equal(t.source, 'mock');
      assert.ok(t.decisions.every((d) => d.basis === 'checked'));
      assert.match(t.request.url, /^https:\/\/gateway\.aggregate-lab\.invalid\//);
      assert.deepEqual(t.response.body.tools, listed.tools, 'the body is exactly what the simulation returned');
      assert.equal(t.request.body.method, 'tools/list');
    }
  }
});

test('mock tools/list trace: the counts per check are the simulation\'s own (analyst through the aggregate)', T, () => {
  const caller = callerOf(cfg, 'analyst');
  const t = mockListTrace({ cfg, caller, view: 'aggregate', member: null, listed: listAggregate(cfg, 'analyst') });
  const rows = audit(cfg, 'analyst');
  const by = (layer) => rows.filter((r) => r.layer === layer).length;
  assert.equal(rows.filter((r) => r.visible).length, 4);
  for (const layer of ['unreachable', 'upstream-sign-in', 'tool-filter', 'member-policy', 'aggregate-cap']) {
    const d = t.decisions.find((x) => x.id === `check-${layer}`);
    assert.equal(d.outcome, by(layer) ? 'info' : 'pass', layer);
    if (by(layer)) assert.match(d.evidence, new RegExp(`removed ${by(layer)} from the list`));
  }
  assert.ok(t.decisions.find((d) => d.id === 'check-member-policy').outcome === 'info', 'the member policy removes some tools for an analyst');
});

test('mock tools/list trace: a member used directly runs only its own three checks; the ToolFilter and the cap are not run', T, () => {
  const member = memberOf(cfg, 'crm');
  const t = mockListTrace({ cfg, caller: callerOf(cfg, 'operator'), view: 'direct', member, listed: listMember(cfg, member, 'operator') });
  assert.deepEqual(only(t, 'skipped'), ['check-tool-filter', 'check-aggregate-cap']);
  assert.match(t.request.url, /\/crm\/mcp$/);
});

test('mock tools/call trace: allowed, stopped at each of the entry checks, stopped at the unknown name, and the direct view', T, () => {
  const run = (callerId, view, memberId, tool) => {
    const member = memberId ? memberOf(cfg, memberId) : null;
    const out = view === 'direct' ? callMember(cfg, member, callerId, tool) : callAggregate(cfg, callerId, tool);
    const t = mockCallTrace({ caller: callerOf(cfg, callerId), view, member, tool, out });
    assert.deepEqual(assertTrace(t), [], `${callerId} ${tool}`);
    assert.ok(t.decisions.every((d) => d.basis === 'checked'));
    return { t, out };
  };
  // allowed: all six checks and the hop pass, HTTP 200, and the body is the simulation's result
  const ok = run('operator', 'aggregate', null, 'crm__update_customer');
  assert.equal(ok.t.response.status, 200);
  assert.equal(only(ok.t, 'pass').length, 7);
  assert.deepEqual(ok.t.response.body, { result: ok.out.result });
  // hidden by the member policy: refused at check 5, the later checks never ran
  const policy = run('analyst', 'aggregate', null, 'crm__update_customer');
  assert.equal(policy.t.response.status, 403);
  assert.deepEqual(only(policy.t, 'fail'), ['check-member-policy']);
  assert.deepEqual(only(policy.t, 'skipped'), ['check-aggregate-cap', 'hop']);
  // a name no member has: refused at check 1, nothing after it ran
  const unknown = run('operator', 'aggregate', null, 'crm__no_such_tool');
  assert.deepEqual(only(unknown.t, 'fail'), ['check-unknown']);
  assert.equal(only(unknown.t, 'skipped').length, 6);
  // not exposed by the aggregate ToolFilter: refused at check 4, so checks 5 and 6 and the hop never ran
  const filtered = run('operator', 'aggregate', null, 'wiki__edit_page');
  assert.deepEqual(only(filtered.t, 'fail'), ['check-tool-filter']);
  assert.deepEqual(only(filtered.t, 'skipped'), ['check-member-policy', 'check-aggregate-cap', 'hop']);
  // direct use of a member: only the member's own checks, so the cap does not stop export_all
  const direct = run('operator', 'direct', 'crm', 'export_all');
  assert.equal(direct.t.response.status, 200);
  assert.deepEqual(only(direct.t, 'skipped'), ['check-tool-filter', 'check-aggregate-cap']);
  const directNo = run('analyst', 'direct', 'crm', 'export_all');
  assert.deepEqual(only(directNo.t, 'fail'), ['check-member-policy']);
});

test('mock tools/call trace: an entry pass followed by a hop refusal names the hop (the second enforcement point)', T, () => {
  // sim.js stageHop re-checks the cap with the tool's own name: drive it by a config whose entry passes but whose cap is not applied at the entry
  const out = { ok: false, error: 'tool_not_available', message: 'That tool is not available to this caller.', trace: [{ stage: 'entry', layer: 'none', decision: 'passed' }, { stage: 'member-hop', layer: 'aggregate-cap', decision: 'refused' }] };
  const t = mockCallTrace({ caller: callerOf(cfg, 'guest'), view: 'aggregate', member: null, tool: 'crm__find_customer', out });
  assert.deepEqual(assertTrace(t), []);
  assert.deepEqual(only(t, 'fail'), ['hop']);
  assert.equal(only(t, 'pass').length, 6);
});

// ---- Mock over HTTP: the routes carry the trace beside the existing fields ------------------------------------------------------------
test('POST /api/gateway/list and /call carry a trace beside the existing fields, and the credential rules still hold', T, async () => {
  const g = installGuard();
  const app = await startApp({ env: {} });
  try {
    g.allow(app.port);
    const list = await app.call('POST', '/api/gateway/list', { caller: 'analyst' });
    assert.equal(list.status, 200);
    assert.deepEqual(assertTrace(list.json.trace), []);
    assert.equal(list.json.trace.response.body.tools.length, list.json.tools.length);
    assert.ok(Array.isArray(list.json.members) && list.json.claim, 'the existing fields are still there');
    const denied = await app.call('POST', '/api/gateway/call', { caller: 'analyst', tool: 'crm__update_customer', arguments: { id: 'c-1' } });
    assert.equal(denied.status, 403);
    assert.ok(denied.json.demoTrace.steps.length >= 1, 'the existing demoTrace is kept');
    assert.deepEqual(assertTrace(denied.json.trace), []);
    assert.equal(denied.json.trace.response.status, 403);
    assert.deepEqual(denied.json.trace.request.body.params, { name: 'crm__update_customer', arguments: { id: 'c-1' } });
    assert.equal(denied.json.trace.response.body.message, denied.json.message, 'the reply shown is the reply sent');
    const direct = await app.call('POST', '/api/gateway/call', { caller: 'operator', view: 'direct', member: 'crm', tool: 'export_all' });
    assert.equal(direct.status, 200);
    assert.deepEqual(assertTrace(direct.json.trace), []);
    assert.equal(g.attempts.length, 0, 'building a mock trace opens no socket and no DNS lookup');
  } finally { await app.close(); g.uninstall(); }
});

// ---- Real: the exchanges the lab's own client captured, against a loopback stub ----------------------------------------------------------
// One stub: app "full" lists for A and B; "limited" hides crm__export (tools/call is refused and echoes the key on purpose); "stream"
// answers as an event stream; an unknown key is a 401 whose body echoes the key; "forbid" answers 403 after the handshake.
async function startStub() {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const key = (req.headers.authorization || '').replace(/^Bearer /, '');
      const app = req.url.split('/')[1];
      if (req.method === 'DELETE') { seen.push({ app, method: 'DELETE' }); res.writeHead(200).end(); return; }
      const msg = JSON.parse(body || '{}');
      seen.push({ app, method: msg.method, auth: req.headers.authorization });
      const reply = (o, headers = {}) => {
        const json = JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...o });
        if (app === 'stream') { res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': SESSION, ...headers }); res.end(`event: message\ndata: ${json}\n\n`); return; }
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': SESSION, ...headers }); res.end(json);
      };
      if (![KEY_A, KEY_B].includes(key)) { res.writeHead(401, { 'content-type': 'text/plain', 'set-cookie': 'sid=abc' }).end(`unauthorized ${key}`); return; }
      if (msg.method === 'initialize') return reply({ result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'stub' } } });
      if (msg.id === undefined) { res.writeHead(202).end(); return; }
      if (app === 'forbid') { res.writeHead(403, { 'content-type': 'text/plain', 'x-request-id': 'req-77' }).end(`caller ${key} refused by policy`); return; }
      if (msg.method === 'tools/list') return reply({ result: { tools: (app === 'limited' ? ['crm__find'] : ['crm__find', 'crm__export']).map((name) => ({ name, description: `tool ${name}` })) } });
      if (msg.method === 'tools/call') return reply({ error: { code: -32600, message: `"${msg.params.name}" is not exposed by this aggregate (caller ${key})` } });
      return reply({ error: { code: -32601, message: 'no' } });
    });
  });
  await new Promise((ok, no) => { srv.once('error', no); srv.listen(0, '127.0.0.1', ok); });
  return { port: srv.address().port, seen, close: () => new Promise((r) => srv.close(r)) };
}
async function withReal(fn, extra = {}) {
  const stub = await startStub();
  const env = { AGG_ENT_GW_URL: `http://127.0.0.1:${stub.port}`, AGG_ENT_GW_APPS: 'full,limited,stream,forbid', AGG_ENT_GW_KEY_ANALYST: KEY_A, AGG_ENT_GW_KEY_GUEST: KEY_B, AGG_ENT_GW_KEY_STRANGER: KEY_BAD, ...extra };
  const app = await startApp({ env });
  try {
    await app.call('POST', '/api/mode', { source: 'real' });
    return await fn(app, stub);
  } finally { await app.close(); await stub.close(); }
}
const list = (app, a, c) => app.call('POST', '/api/gateway/real/list', { app: a, caller: c });
const noSecrets = (r) => {
  for (const s of [KEY_A, KEY_B, KEY_BAD, SESSION, 'sid=abc']) assert.ok(!r.text.includes(s), `a secret reached the reply: ${s.slice(0, 8)}...`);
  return r;
};
const realChecks = (t) => { assert.deepEqual(assertTrace(t), []); assert.equal(t.source, 'real'); assert.ok(t.decisions.every((d) => d.basis !== 'checked'), 'a real trace has no checked decision'); return t; };

test('real tools/list: the exact request and reply, the key only as its length, the session calls around it, decisions inferred', T, async () => {
  await withReal(async (app, stub) => {
    const r = noSecrets(await list(app, 'full', 'analyst'));
    const t = realChecks(r.json.trace);
    assert.equal(t.request.method, 'POST');
    assert.equal(t.request.url, `http://127.0.0.1:${stub.port}/full/mcp`);
    assert.equal(t.request.body.method, 'tools/list');
    assert.equal(t.request.headers.authorization, `Bearer <token, ${KEY_A.length} characters, kept on the server>`);
    assert.match(t.request.headers['mcp-session-id'], /shortened/);
    assert.equal(t.request.headers['mcp-protocol-version'], '2025-06-18');
    assert.equal(t.response.status, 200);
    assert.deepEqual(t.response.body.result.tools.map((x) => x.name), ['crm__find', 'crm__export'], 'the reply body is whole, not the lab\'s clipped copy');
    assert.deepEqual(t.setup.map((s) => s.label), ['initialize', 'notifications/initialized', 'close session']);
    assert.deepEqual(t.setup.map((s) => s.status), [200, 202, 200]);
    assert.deepEqual(ids(t), ['authenticated:pass', 'grant:pass']);
    assert.ok(t.decisions.every((d) => d.basis === 'inferred'));
    assert.match(t.decisions[1].evidence, /crm__find, crm__export/);
    assert.ok(stub.seen.every((s) => !s.auth || s.auth === `Bearer ${KEY_A}`), 'the stub did receive the real key; the trace never showed it');
  });
});

test('real tools/call of a hidden name: the refusal is a JSON-RPC error, observed, and the key the gateway echoed is scrubbed from the trace', T, async () => {
  await withReal(async (app) => {
    const r = noSecrets(await app.call('POST', '/api/gateway/real/call', { app: 'limited', caller: 'analyst', tool: 'crm__export', confirm: true }));
    const t = realChecks(r.json.trace);
    assert.equal(t.request.body.method, 'tools/call');
    assert.deepEqual(t.request.body.params, { name: 'crm__export', arguments: {} });
    assert.match(t.response.body.error.message, /\[redacted\]/);
    assert.deepEqual(ids(t), ['authenticated:pass', 'result:fail']);
    assert.equal(t.decisions[1].basis, 'observed');
    // the listing that decided the call was a real call too, so it is shown too
    const before = realChecks(r.json.listTrace);
    assert.equal(before.request.body.method, 'tools/list');
    assert.deepEqual(before.response.body.result.tools.map((x) => x.name), ['crm__find']);
  });
});

test('real refusals: a 401 and a 403 are inferred, never checked, and an echoed key never reaches the page', T, async () => {
  await withReal(async (app) => {
    const no = noSecrets(await list(app, 'full', 'stranger'));
    const t401 = realChecks(no.json.trace);
    assert.equal(t401.response.status, 401);
    assert.deepEqual(ids(t401), ['authenticated:fail', 'grant:skipped']);
    assert.ok(!('set-cookie' in t401.response.headers), 'response headers are an allowlist');
    assert.equal(t401.request.body.method, 'initialize', 'a refusal at the handshake: the last POST is the call shown');
    const f = noSecrets(await list(app, 'forbid', 'analyst'));
    const t403 = realChecks(f.json.trace);
    assert.equal(t403.response.status, 403);
    assert.deepEqual(ids(t403), ['authenticated:pass', 'grant:fail']);
    assert.equal(t403.response.headers['x-request-id'], 'req-77');
    assert.match(t403.decisions[1].evidence, /refused by policy/);
  });
});

test('real over an event stream: the body is the JSON-RPC message that answers, and the trace says so', T, async () => {
  await withReal(async (app) => {
    const r = noSecrets(await list(app, 'stream', 'analyst'));
    const t = realChecks(r.json.trace);
    assert.match(t.response.headers['content-type'], /event-stream/);
    assert.equal(t.response.body.result.tools.length, 2);
    const fmt = t.decisions.find((d) => d.id === 'reply-format');
    assert.equal(fmt.outcome, 'info');
    assert.equal(fmt.basis, 'observed');
    assert.equal(realChecks(t).decisions.filter((d) => d.outcome === 'pass').length, 2, 'the info line is not counted as a pass');
  });
});

test('real, gateway not reachable: a trace with the request and no response, observed', T, async () => {
  const stub = await startStub();
  const port = stub.port;
  await stub.close(); // nothing listens on this port any more
  const app = await startApp({ env: { AGG_ENT_GW_URL: `http://127.0.0.1:${port}`, AGG_ENT_GW_APPS: 'full', AGG_ENT_GW_KEY_ANALYST: KEY_A } });
  try {
    await app.call('POST', '/api/mode', { source: 'real' });
    const r = noSecrets(await list(app, 'full', 'analyst'));
    const t = realChecks(r.json.trace);
    assert.equal(t.response, null);
    assert.equal(t.decisions[0].id, 'reach');
    assert.equal(t.decisions[0].basis, 'observed');
    assert.equal(t.request.headers.authorization, `Bearer <token, ${KEY_A.length} characters, kept on the server>`);
  } finally { await app.close(); }
});

test('a listed tool is still never sent, and the 409 carries the listing that decided it', T, async () => {
  await withReal(async (app, stub) => {
    const r = noSecrets(await app.call('POST', '/api/gateway/real/call', { app: 'full', caller: 'analyst', tool: 'crm__find', confirm: true }));
    assert.equal(r.status, 409);
    assert.equal(r.json.error, 'listed_tool');
    realChecks(r.json.listTrace);
    assert.ok(!stub.seen.some((s) => s.method === 'tools/call'));
  });
});
