// Rule 27: the lab's half of the run-observability panel (runObs.js and the /api/gateway/run route). The vendored collector has its own tests in the shared folder.
// Real is tested against an in-process fake gateway on loopback only; the shared settings file is pointed at one that does not exist and HOME is unset.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { assertRunObservability, classify, createMasker, layerMatchers } from '../src/runObservability.js';
import { freshConfig } from '../src/gateway/fixture.js';
import { createGatewayRouter } from '../src/gateway/routes.js';
import { callAggregate, callMember, listAggregate, listMember } from '../src/gateway/sim.js';
import { normalizeConfig } from '../src/gateway/config.js';
import { readRefusal } from '../src/gateway/real.js';
import { KEEP_RUNS, SERVICE, createRunLog, decisionLine, lineValue, mockCallEvents, mockListEvents, replyOf } from '../src/runObs.js';
import { startApp } from './helpers.js';

const T = { timeout: 60_000 };
const NO_ENV = { STANDALONE_ENV: '/nonexistent/none.env' }; // the shared settings file is read live by real.js: never the owner's
const WORDS = /refused|denied|rejected|forbidden|failed|invalid|expired|mismatch|token|audience|scope|served|unauthori[sz]ed|insufficient|not allowed/i;
const LINE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z aggregate-entitlement-lab decision step=[A-Za-z0-9._:/@-]+ layer=[a-z]+ actor=[A-Za-z0-9._:/@-]+ result=(?:passed|stopped|unclear|no-reply) cause=[A-Za-z0-9._:/@-]+ run=[A-Za-z0-9._:/@-]+$/;
const PRODUCTS = [...new Set(layerMatchers.map((m) => m.product))];
const part = (...p) => p.join('');
const KEY_A = part('lab-analyst-key-', 'qqqqqqqqqq-end');
const KEY_B = part('lab-guest-key-', 'wwwwwwwwww-end');
const EV = { layer: 'agent', product: 'p', step: 'ask', outcome: 'info', cause: '-', who: 'analyst', message: 'x' };
const rows = (rec) => rec.rows.filter((r) => r.origin !== 'not-logged');
const shape = (rec) => rows(rec).map((r) => [r.layer, r.outcome]);
// No shared matcher reads a line, in any of the shapes a collector could hand it (the whole line: no field is cut out first).
const noMatcherReads = (line) => {
  const at = line.split(' ')[0];
  for (const product of PRODUCTS) {
    for (const message of [line, `[${at}] INFO: ${line.split(' ').slice(1).join(' ')}`, `[${at}] WARN: ${line.split(' ').slice(1).join(' ')}`]) {
      assert.equal(classify({ product, message, at: Date.parse(at), atExact: at }, []), null, `${product}: ${message}`);
    }
  }
};

function capture(extra = {}) {
  const lines = [];
  return { lines, runLog: createRunLog({ write: (l) => lines.push(l), ...extra }) };
}
async function withApp(env, fn, runLog) {
  const app = await startApp({ env: { ...NO_ENV, ...env }, ...(runLog ? { runLog } : {}) });
  try { return await fn(app); } finally { await app.close(); }
}
const post = (app, p, body) => app.call('POST', `/api/gateway/${p}`, body);
const record = (app, id) => app.call('GET', `/api/gateway/run?runId=${encodeURIComponent(id)}`);
const withCfg = (edit) => { const c = freshConfig(); edit(c); return c; };
const stderrOf = async (fn) => {
  const orig = process.stderr.write; let text = '';
  process.stderr.write = (chunk, ...rest) => { text += String(chunk); return typeof rest.at(-1) === 'function' ? rest.at(-1)() : true; };
  try { await fn(); } finally { process.stderr.write = orig; }
  return text;
};

// ---- Mock: one request, the steps the simulation computed -------------------------------------------------------------------------------------------
test('Mock listing: the rows are the simulation\'s own, simulated, never logged, one stdout line each, and each row is at its line\'s time', T, async () => {
  const { lines, runLog } = capture();
  await withApp({}, async (app) => {
    const l = await post(app, 'list', { caller: 'analyst' });
    assert.equal(l.status, 200);
    assert.match(l.json.run.id, /^list-[0-9a-f]{6}-\d+$/);
    const r = await record(app, l.json.run.id);
    assert.equal(r.status, 200);
    const rec = r.json.record;
    assert.deepEqual(assertRunObservability(rec), []);
    assert.equal(rec.source, 'mock');
    assert.deepEqual(shape(rec), [['agent', 'info'], ['privilege', 'info'], ['gateway', 'allowed']]);
    assert.ok(rows(rec).every((x) => x.origin === 'simulated'));
    assert.deepEqual(rec.coverage, { person: 'not-logged', agent: 'simulated', authorize: 'not-logged', privilege: 'simulated', gateway: 'simulated', resource: 'not-logged' });
    assert.match(rows(rec)[1].message, /left 4 of 8 tools/);
    assert.deepEqual(rec.summary, { allowed: 1, refused: 0, blocked: 0, info: 2, unverified: 0 });
    // one line per row, in the rows' order, stamped with the row's own time
    assert.equal(lines.length, 3);
    assert.deepEqual(lines.map((x) => x.split(' ')[0]), rows(rec).map((x) => x.at));
    lines.forEach((x) => { assert.match(x, LINE); noMatcherReads(x); });
    assert.deepEqual(lines.map((x) => / step=(\S+)/.exec(x)[1]), ['ask', 'list-filter', 'gateway-list']);
    assert.ok(/ result=passed /.test(lines[2]) && /result=unclear/.test(lines[0]) && /result=unclear/.test(lines[1]), 'a listing answer carrying tools is a pass; the filter and the ask are information');
    assert.ok(!r.text.includes('crm__export_all'), 'the listing record names no tool the caller was not shown');
  }, runLog);
});

test('Mock listing: a member the configuration marks unreachable or needing sign-in is a Resource server row (information), and an empty listing is not a pass', T, async () => {
  await withApp({}, async (app) => {
    const cfg = withCfg((c) => { c.members[0].reachable = false; });
    const a = await post(app, 'list', { config: cfg, caller: 'operator' });
    const rec = (await record(app, a.json.run.id)).json.record;
    assert.deepEqual(assertRunObservability(rec), []);
    assert.deepEqual(shape(rec), [['agent', 'info'], ['resource', 'info'], ['privilege', 'info'], ['gateway', 'allowed']]);
    assert.match(rows(rec)[1].message, /member crm unreachable.*simulated fault, not a policy decision/);
    const guest = await post(app, 'list', { caller: 'guest' }); // guest has no sign-in to bill (per-user)
    const g = (await record(app, guest.json.run.id)).json.record;
    assert.ok(rows(g).some((x) => x.layer === 'resource' && /needs each caller's own sign-in/.test(x.message) && x.outcome === 'info'));
    const nothing = withCfg((c) => { for (const m of c.members) m.reachable = false; });
    const e = await post(app, 'list', { config: nothing, caller: 'operator' });
    const er = (await record(app, e.json.run.id)).json.record;
    const gw = rows(er).find((x) => x.layer === 'gateway');
    assert.equal(gw.outcome, 'info', 'a listing with no tools is no pass');
    assert.match(gw.message, /no tools/);
    assert.equal(er.summary.allowed, 0);
  });
});

const CALLS = [
  // [what, config edit, body, rows (layer, outcome) after the ask, the cause on the privilege / resource / gateway line]
  ['a tool the ToolFilter does not expose', (c) => { c.members[0].toolFilter = ['find_customer', 'update_customer']; }, { caller: 'operator', tool: 'crm__export_all' }, [['privilege', 'refused'], ['gateway', 'info']], 'tool-filter'],
  ['a tool the member\'s own policy does not allow', () => {}, { caller: 'analyst', tool: 'crm__update_customer' }, [['privilege', 'refused'], ['gateway', 'info']], 'member-policy'],
  ['a tool the aggregate cap does not allow', (c) => { c.cap[1].tools = c.cap[1].tools.filter((t) => t !== 'crm__update_customer'); }, { caller: 'operator', tool: 'crm__update_customer' }, [['privilege', 'refused'], ['gateway', 'info']], 'aggregate-cap'],
  ['a member the configuration marks unreachable', (c) => { c.members[0].reachable = false; }, { caller: 'operator', tool: 'crm__find_customer' }, [['resource', 'info'], ['gateway', 'info']], 'member-down'],
  ['a member the caller has not signed in to', () => {}, { caller: 'guest', tool: 'bill__get_invoice' }, [['resource', 'info'], ['gateway', 'info']], 'needs-sign-in'],
  ['a name no member has', () => {}, { caller: 'operator', tool: 'crm__nothing_here' }, [['gateway', 'info']], 'no-such-tool'],
  ['a tool every check lets through', () => {}, { caller: 'operator', tool: 'crm__update_customer' }, [['privilege', 'allowed'], ['privilege', 'allowed'], ['gateway', 'info']], 'entry-passed'],
  ['a member used directly, its own policy refusing', () => {}, { caller: 'analyst', view: 'direct', member: 'crm', tool: 'update_customer' }, [['privilege', 'refused'], ['gateway', 'info']], 'member-policy'],
  ['a member used directly, its own policy allowing', () => {}, { caller: 'operator', view: 'direct', member: 'crm', tool: 'export_all' }, [['privilege', 'allowed'], ['gateway', 'info']], 'member-passed'],
  ['a name the member used directly does not have', () => {}, { caller: 'operator', view: 'direct', member: 'crm', tool: 'nothing_here' }, [['gateway', 'info']], 'no-such-tool'],
];
for (const [what, edit, body, expected, cause] of CALLS) {
  test(`Mock call, ${what}: each step the simulation computed is one row in the layer that decides it, and the answer is information`, T, async () => {
    const { lines, runLog } = capture();
    await withApp({}, async (app) => {
      const r = await post(app, 'call', { ...body, config: withCfg(edit) });
      const rec = (await record(app, r.json.run.id)).json.record;
      assert.deepEqual(assertRunObservability(rec), []);
      assert.deepEqual(shape(rec), [['agent', 'info'], ...expected]);
      assert.ok(rows(rec).every((x) => x.origin === 'simulated'));
      assert.ok(lines.some((x) => x.includes(`cause=${cause}`)), `${cause} is on a line`);
      assert.equal(lines.length, rows(rec).length);
      assert.deepEqual(lines.map((x) => x.split(' ')[0]), rows(rec).map((x) => x.at), 'each row is at its line\'s time');
      lines.forEach((x) => { assert.match(x, LINE); noMatcherReads(x); });
      // a stop is never shown as a plain allow, and a pass never as a refusal
      const refusedRows = rows(rec).filter((x) => x.outcome === 'refused');
      assert.equal(refusedRows.length, r.status === 403 && expected[0][1] === 'refused' ? 1 : 0);
      assert.equal(rec.summary.allowed, expected.filter(([, o]) => o === 'allowed').length);
      // the reply row repeats the decision above it: never a second allowed or refused
      assert.equal(rows(rec).filter((x) => x.layer === 'gateway' && x.outcome !== 'info').length, 0);
    }, runLog);
  });
}

test('Mock call: a call the simulation stopped early has no row for a check it never ran, and the privilege layer says why', T, async () => {
  await withApp({}, async (app) => {
    const r = await post(app, 'call', { caller: 'operator', tool: 'crm__nothing_here' });
    const rec = (await record(app, r.json.run.id)).json.record;
    assert.equal(rec.coverage.privilege, 'not-logged');
    assert.match(rec.reasons.privilege, /stopped before any policy check ran/);
    const hidden = await post(app, 'call', { caller: 'analyst', tool: 'crm__update_customer' });
    const h = (await record(app, hidden.json.run.id)).json.record;
    assert.equal(rows(h).filter((x) => x.layer === 'privilege').length, 1, 'the checks after the first stop were never run, so no row');
    assert.equal(h.coverage.resource, 'not-logged');
    assert.match(h.reasons.resource, /no member server and nothing is run/);
    assert.equal(rows(h).find((x) => x.layer === 'privilege').detail.check, 'member-policy');
  });
});

test('a request that fails validation begins no run: no row, no line, `run: null` in the answer, and nothing a record route could find', T, async () => {
  const { lines, runLog } = capture();
  await withApp({}, async (app) => {
    const bad = [
      ['list', { caller: 'nobody' }], ['list', { caller: 'analyst', view: 'sideways' }], ['list', { caller: 'analyst', extra: 1 }], ['list', { caller: 'analyst', config: { schema: 'nope' } }],
      ['call', { caller: 'operator', tool: 'not a tool name' }], ['call', { caller: 'operator', tool: 'crm__find_customer', arguments: { k: part('sk-', 'live-', 'Abcdefgh1234567890XyZ') } }],
      ['call', { caller: 'operator', tool: 'crm__find_customer', arguments: [1] }], ['call', { caller: 'ghost', tool: 'crm__find_customer' }],
    ];
    for (const [p, body] of bad) {
      const r = await post(app, p, body);
      assert.equal(r.status, 400, `${p} ${JSON.stringify(body).slice(0, 40)}`);
      assert.equal(r.json.run, null);
      assert.match(r.json.runNote, /began no run/);
    }
    assert.equal(lines.length, 0, 'validation writes no stdout line');
    // audit and scan begin no run at all: no field either
    const a = await post(app, 'audit', { caller: 'nobody' });
    assert.equal(a.status, 400);
    assert.ok(!('run' in a.json));
    // a run that began is the only one the record route finds
    const ok = await post(app, 'list', { caller: 'analyst' });
    assert.equal((await record(app, ok.json.run.id)).json.record.runId, ok.json.run.id);
    assert.equal(lines.length, 3);
  }, runLog);
});

test('an audit or a scan is no gateway request: neither writes a line or begins a run', T, async () => {
  const { lines, runLog } = capture();
  await withApp({}, async (app) => {
    const a = await post(app, 'audit', { caller: 'operator' });
    const s = await post(app, 'scan', { caller: 'operator' });
    assert.equal(a.status, 200); assert.equal(s.status, 200);
    assert.ok(!('run' in a.json) && !('run' in s.json));
    assert.equal(lines.length, 0);
  }, runLog);
});

// ---- The route ---------------------------------------------------------------------------------------------------------------------------------------
test('the run route: errors are {error, message} JSON, only its own parameter, GET only with an Allow header, same-origin and Host rules as the rest', T, async () => {
  await withApp({}, async (app) => {
    for (const q of ['', '?runId=', '?runId=list-xyz', '?runId=list-065d5b-1&runId=list-065d5b-2', '?runId[a]=1', '?runId=call-065d5b-1x', '?runId=real-065d5b-1']) {
      const r = await app.call('GET', `/api/gateway/run${q}`);
      assert.equal(r.status, 400, q);
      assert.equal(r.json.error, 'bad_run_id');
      assert.equal(typeof r.json.message, 'string');
    }
    const extra = await app.call('GET', '/api/gateway/run?runId=list-065d5b-1&x=1');
    assert.equal(extra.status, 400); assert.equal(extra.json.error, 'unknown_field');
    const unknown = await app.call('GET', '/api/gateway/run?runId=list-065d5b-1');
    assert.equal(unknown.status, 200);
    assert.match(unknown.json.message, /no longer kept/);
    assert.equal(unknown.json.record, null);
    for (const m of ['POST', 'PUT', 'DELETE']) {
      const r = await app.call(m, '/api/gateway/run?runId=list-065d5b-1', {});
      assert.equal(r.status, 405, m);
      assert.equal(r.headers.get('allow'), 'GET, HEAD');
      assert.equal(r.json.error, 'method_not_allowed');
    }
    // a foreign Host and a cross-origin write are refused as everywhere else
    const foreign = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: app.port, path: '/api/gateway/run?runId=list-065d5b-1', headers: { Host: 'evil.example' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject); req.end();
    });
    assert.equal(foreign, 403);
    assert.equal((await app.call('POST', '/api/gateway/run', {}, { origin: 'http://evil.example' })).status, 403);
    assert.equal((await app.call('GET', '/api/gateway/run?runId=list-065d5b-1')).headers.get('cache-control'), 'no-store');
  });
});

test('the route branches on the mode explicitly: a mode that is neither Mock nor Real answers a plain note and no record', T, async () => {
  const runs = createRunLog({ write: () => {} });
  const mockId = runs.mock('list', () => [EV]);
  const begun = runs.begin('list', 'analyst', 'full');
  await begun.step('tools/list', async () => ({ ok: true, tools: [{}], ms: 1 }));
  begun.end();
  for (const mode of ['live', 'hosted', '', undefined, null, 'Mock', 'REAL']) {
    const app = express(); app.use('/api/gateway', createGatewayRouter({ getMode: () => mode, runs }));
    const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    try {
      for (const want of [mockId, begun.id]) {
        const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/gateway/run?runId=${want}`);
        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.record, null, String(mode));
        assert.doesNotMatch(body.message, /Real|Mock|gateway reply/, 'a plain note, no Real wording');
      }
    } finally { srv.close(); }
  }
});

test('the mode is stored on the run: a Mock run is never answered while the header is on Real, and a Real run never while it is on Mock', T, async () => {
  const gw = await fakeGateway();
  try {
    await withApp({ AGG_ENT_GW_URL: gw.url, AGG_ENT_GW_APPS: 'full', AGG_ENT_GW_KEY_ANALYST: KEY_A }, async (app) => {
      assert.equal((await app.call('POST', '/api/mode', { source: 'mock' })).status, 200);
      const m = await post(app, 'list', { caller: 'analyst' });
      assert.equal((await record(app, m.json.run.id)).json.record.source, 'mock');
      assert.equal((await app.call('POST', '/api/mode', { source: 'real' })).status, 200);
      const r = await post(app, 'real/list', { app: 'full', caller: 'analyst' });
      assert.equal((await record(app, r.json.run.id)).json.record.source, 'real');
      const mockNow = await record(app, m.json.run.id);
      assert.equal(mockNow.json.record, null, 'a Mock run, asked for while the header is on Real');
      assert.match(mockNow.json.message, /made in Mock mode/);
      assert.equal((await app.call('POST', '/api/mode', { source: 'mock' })).status, 200);
      const realNow = await record(app, r.json.run.id);
      assert.equal(realNow.json.record, null, 'a Real run, asked for while the header is on Mock');
      assert.match(realNow.json.message, /made in Real mode/);
      assert.equal((await record(app, m.json.run.id)).json.record.source, 'mock', 'and back');
    });
  } finally { await gw.close(); }
});

test('Reset clears the records and ids never repeat; the mode toggle, GET /api/info and the page\'s own routes answer as before', T, async () => {
  await withApp({}, async (app) => {
    const first = await post(app, 'list', { caller: 'analyst' });
    assert.ok((await record(app, first.json.run.id)).json.record);
    const info = (await app.call('GET', '/api/info')).json;
    assert.deepEqual(Object.keys(info).sort(), ['realAvailable', 'realReason', 'source', 'version']);
    assert.equal(info.source, 'mock');
    assert.equal((await app.call('POST', '/api/reset', {})).status, 200);
    const gone = await record(app, first.json.run.id);
    assert.equal(gone.json.record, null);
    assert.match(gone.json.message, /Reset clears them/);
    const second = await post(app, 'list', { caller: 'analyst' });
    assert.notEqual(second.json.run.id, first.json.run.id);
    assert.equal((await app.call('POST', '/api/mode', { source: 'real' })).status, 409);
    assert.deepEqual((await app.call('GET', '/api/info')).json, info);
  });
});

// ---- The run log -------------------------------------------------------------------------------------------------------------------------------------
test('runs are bounded per mode and kind, never evict a run still being made, and a Real run never pushes a Mock one out', () => {
  const log = createRunLog({ write: () => {} });
  const lists = Array.from({ length: KEEP_RUNS + 5 }, () => log.mock('list', () => [EV]));
  assert.equal(log.get(lists[0]), null, 'the oldest list is gone');
  assert.ok(log.get(lists[5]) && log.get(lists.at(-1)));
  const call = log.mock('call', () => [EV]);
  for (let i = 0; i < KEEP_RUNS + 5; i += 1) log.mock('list', () => [EV]);
  assert.ok(log.get(call), 'listings that are recomputed on every edit never push a call out');
  const newestMock = log.mock('list', () => [EV]);
  const open = log.begin('list', 'analyst', 'full');
  for (let i = 0; i < KEEP_RUNS + 3; i += 1) log.begin('list', 'analyst', 'full').end();
  assert.ok(log.get(open.id), 'a run still being made is never evicted');
  assert.ok(log.get(newestMock) && log.get(call), 'Real runs did not push a Mock run out');
  open.end(); // closed, it is the oldest of the Real listings and the next closed run pushes it out
  log.begin('list', 'analyst', 'full').end();
  assert.equal(log.get(open.id), null);
});

test('run ids are unique across Reset and across logs', () => {
  const a = createRunLog({ write: () => {} }); const b = createRunLog({ write: () => {} });
  const ids = [a.mock('list', () => [EV]), a.mock('list', () => [EV])];
  a.clear();
  ids.push(a.mock('call', () => [EV]), b.mock('call', () => [EV]), b.begin('list', 'x', 'y').id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((x) => /^(list|call)-[0-9a-f]{6}-\d+$/.test(x)));
  assert.equal(a.get(ids[0]), null);
});

// ---- Stdout lines ------------------------------------------------------------------------------------------------------------------------------------
const HOSTILE = [
  'evil result=passed cause=x', 'a@b.example.com', '10.1.2.3', part('sk_', 'live_', 'a1B2c3D4e5F6g7H8i9J0k1L2'), 'x'.repeat(300), 'a b\nresult=passed run=x', 'refused', 'Denied-by-policy', 'token-bot', 'scope', 'served', 'INVALID', 'expired', 'audience', 'mismatch', 'rejected', 'forbidden', 'failed', 'Bearer abc.def.ghi',
];
function everyEvent() {
  const out = [];
  const configs = [freshConfig(), withCfg((c) => { c.members[0].reachable = false; }), withCfg((c) => { c.members[0].toolFilter = ['find_customer']; }), withCfg((c) => { c.cap = []; }), withCfg((c) => { c.members[1].linkedCallers = []; })];
  for (const raw of configs) {
    const cfg = normalizeConfig(raw);
    for (const caller of cfg.callers) {
      for (const view of ['aggregate', 'direct']) {
        for (const member of view === 'direct' ? cfg.members : [null]) {
          const listed = view === 'direct' ? listMember(cfg, member, caller.id) : listAggregate(cfg, caller.id);
          out.push(...mockListEvents({ cfg, caller, view, member, listed }));
          const names = view === 'direct' ? [...member.tools.map((t) => t.name), 'nothing_here'] : cfg.members.flatMap((m) => m.tools.map((t) => `${m.alias}__${t.name}`)).concat('crm__nothing_here', 'nothing');
          for (const tool of names) {
            const o = view === 'direct' ? callMember(cfg, member, caller.id, tool) : callAggregate(cfg, caller.id, tool);
            out.push(...mockCallEvents({ cfg, caller, view, member, tool, args: {}, out: o }));
          }
        }
      }
    }
  }
  const replies = [
    ['tools/list', { ok: true, tools: [{}] }], ['tools/list', { ok: true, tools: [] }], ['tools/list', { ok: false, refusal: { status: 401 } }], ['tools/list', { ok: false, refusal: { status: 403 } }], ['tools/list', { ok: false, refusal: { status: 500 } }],
    ['tools/call', { ok: true, isError: true, text: 'x' }], ['tools/call', { ok: true, isError: false, text: 'x' }], ['tools/call', { ok: true, isError: false, text: '' }], ['tools/call', { ok: false, refusal: { status: null, message: 'boom' } }],
    ['tools/call', { ok: false, refusal: { status: null, message: 'reply is not JSON' } }], ['tools/call', { ok: false, refusal: { status: 403 } }],
  ];
  for (const [step, r] of replies) out.push({ ...replyOf(step, r, 'full'), step: step === 'tools/list' ? 'gateway-list' : 'gateway-call', layer: 'gateway' });
  out.push({ step: 'gateway-list', layer: 'gateway', noReply: true, cause: 'no-reply' });
  return out;
}

test('every step and cause the lab can write passes the shared matchers, with any typed actor: no field is cut out before the check', () => {
  const evs = everyEvent();
  const kinds = new Set(evs.map((e) => `${e.step}/${e.cause}`));
  for (const k of ['ask/-', 'list-filter/-', 'gateway-list/tools-listed', 'gateway-list/empty-list', 'member-state/member-down', 'member-state/needs-sign-in', 'entry/tool-filter', 'entry/member-policy', 'entry/aggregate-cap', 'entry/entry-passed', 'member-hop/hop-passed',
    'member/member-passed', 'member/member-policy', 'entry/member-down', 'entry/needs-sign-in', 'no-such-tool/no-such-tool', 'answer/answered-200', 'answer/answered-403', 'gateway-list/status-401', 'gateway-call/status-403', 'gateway-list/status-500', 'gateway-call/tool-error',
    'gateway-call/tool-ran', 'gateway-call/no-content', 'gateway-call/jsonrpc-error', 'gateway-call/unreadable', 'gateway-list/no-reply']) {
    // member-hop never stops a call the entry let through (it re-checks the same two policies), so only its pass is reachable through the aggregate
    assert.ok(kinds.has(k), `no event of kind ${k}`);
  }
  const at = '2026-11-22T10:00:00.000Z';
  for (const ev of evs) {
    for (const who of ['analyst', ...HOSTILE]) {
      const line = decisionLine({ ...ev, who }, at, 'call-065d5b-1');
      assert.match(line, LINE, line);
      assert.ok(!WORDS.test(line), `a matcher word is in: ${line}`);
      assert.equal(line.split('\n').length, 1);
      for (const key of ['step', 'layer', 'actor', 'result', 'cause', 'run']) assert.equal(line.split(' ').filter((p) => p.startsWith(`${key}=`)).length, 1, `${key} once in ${line}`);
      noMatcherReads(line);
    }
  }
  // typed names are masked like the rows, and a name cannot add a second result or a second line
  const masked = createMasker().mask;
  assert.equal(masked('10.1.2.3'), '<ip>');
  assert.match(decisionLine({ step: 'ask', layer: 'agent', who: 'a@b.example.com', outcome: 'info', cause: '-' }, 'T', 'r'), /actor=_email_ /);
  assert.match(decisionLine({ step: 'ask', layer: 'agent', who: '10.1.2.3', outcome: 'info', cause: '-' }, 'T', 'r'), /actor=_ip_ /);
  assert.equal(decisionLine({ step: 'ask', layer: 'agent', who: 'a b\nresult=passed run=x', outcome: 'info', cause: '-' }, 'T', 'r').split(' ').filter((p) => p.startsWith('result=')).length, 1);
  assert.equal(lineValue('a b\nc=d'), 'a_b_c_d'); assert.equal(lineValue(''), '-'); assert.equal(lineValue(undefined), '-');
  assert.match(decisionLine({ step: 'ask', layer: 'agent', who: 'x', noReply: true, cause: 'no-reply' }, 'T', 'r'), / result=no-reply cause=no-reply run=r$/);
});

test('no row message can reach the panel\'s 300-character cut, even with the longest caller label, alias, tool name and reading', () => {
  const evs = everyEvent().filter((e) => e.message); // the no-reply line has no row
  assert.ok(evs.length > 100);
  for (const e of evs) assert.ok(e.message.length <= 300, `${e.step}/${e.cause}: ${e.message.length}`);
  const cfg = normalizeConfig(withCfg((c) => { c.callers[0].label = 'L'.repeat(40); c.members[0].alias = 'm'.repeat(16); c.members[0].reachable = false; c.cap = c.cap.map((g) => ({ ...g, tools: g.tools.map((n) => n.replace(/^crm__/, `${'m'.repeat(16)}__`)) })); }));
  const caller = cfg.callers[0]; const member = cfg.members[0]; const tool = 'T'.repeat(64);
  const out = callAggregate(cfg, caller.id, `${member.alias}__find_customer`);
  for (const e of [...mockCallEvents({ cfg, caller, view: 'aggregate', member: null, tool, args: { a: 1 }, out }), ...mockCallEvents({ cfg, caller, view: 'direct', member, tool, args: {}, out: callMember(cfg, member, caller.id, 'find_customer') }), ...mockListEvents({ cfg, caller, view: 'aggregate', member: null, listed: listAggregate(cfg, caller.id) })]) {
    assert.ok(e.message.length <= 300, `${e.step}/${e.cause}: ${e.message.length}`);
  }
  for (const layer of ['key', 'policy', 'tool-filter', 'unreachable', 'unknown', 'other']) {
    for (const r of [{ status: 401 }, { status: 403 }, { status: null, message: 'x' }]) assert.ok(replyOf('tools/call', { ok: false, refusal: { ...r, layer } }, 'a'.repeat(63)).message.length <= 300, `${layer} ${r.status}`);
  }
});

test('a hostile caller label, caller id and tool name reach neither a stdout line nor an unmasked row', T, async () => {
  const { lines, runLog } = capture();
  await withApp({}, async (app) => {
    const cfg = JSON.parse(JSON.stringify(freshConfig()).replaceAll('"analyst"', '"token-bot"'));
    cfg.callers[0].label = 'a@b.example.com 10.1.2.3';
    const r = await post(app, 'call', { config: cfg, caller: 'token-bot', tool: 'crm__nothing_here' });
    assert.equal(r.status, 403);
    const rec = (await record(app, r.json.run.id)).json.record;
    assert.deepEqual(assertRunObservability(rec), []);
    const text = JSON.stringify(rec);
    assert.ok(!text.includes('a@b.example.com') && !text.includes('10.1.2.3'));
    assert.ok(lines.length > 0 && lines.every((x) => LINE.test(x) && !WORDS.test(x) && !x.includes('crm__nothing_here') && !x.includes('example.com')));
    lines.forEach(noMatcherReads);
  }, runLog);
});

test('the agent\'s arguments are counted, never recorded: a value typed into them is in no row and no line', T, async () => {
  const { lines, runLog } = capture();
  await withApp({}, async (app) => {
    const r = await post(app, 'call', { caller: 'operator', tool: 'crm__find_customer', arguments: { name: 'Zed Quux', note: 'unique-marker-value' } });
    const rec = (await record(app, r.json.run.id)).json.record;
    assert.match(rows(rec)[0].message, /with 2 arguments \(the values are never recorded\)/);
    assert.ok(!JSON.stringify(rec).includes('unique-marker-value') && !lines.join('\n').includes('unique-marker-value') && !lines.join('\n').includes('find_customer'));
  }, runLog);
});

// ---- A recorder that throws ---------------------------------------------------------------------------------------------------------------------------
const baselineOf = (r) => { const { run, runNote, ...rest } = r.json; return { status: r.status, rest }; };

test('a writer that throws never breaks the answer or the run: the answer is the baseline\'s, the run is reachable, one failed line drops one line, and stderr names a code, never the error\'s text', T, async () => {
  const SECRET = part('agent-key-', 'must-not-reach-stderr');
  let ok;
  await withApp({}, async (app) => { ok = baselineOf(await post(app, 'call', { caller: 'operator', tool: 'crm__update_customer' })); });
  const lines = []; let n = 0;
  const flaky = createRunLog({ write: (l) => { n += 1; if (n === 2) { const e = new Error(SECRET); e.code = 'EPIPE'; throw e; } lines.push(l); } });
  const err = await stderrOf(async () => {
    await withApp({}, async (app) => {
      const r = await post(app, 'call', { caller: 'operator', tool: 'crm__update_customer' });
      assert.deepEqual(baselineOf(r), ok, 'the answer is the one a healthy log gives');
      assert.ok(r.json.run.id, 'the run is still named');
      const rec = (await record(app, r.json.run.id)).json.record;
      assert.equal(rows(rec).length, 4, 'and its record is whole');
    }, flaky);
  });
  assert.equal(lines.length, 3, 'four lines, one failed: the other three were written');
  assert.match(err, /run observability: line EPIPE \(the error's text is not logged\)/);
  assert.ok(!err.includes(SECRET));
  // every write throwing
  const dead = createRunLog({ write: () => { throw new Error(SECRET); } });
  const err2 = await stderrOf(async () => {
    await withApp({}, async (app) => {
      assert.deepEqual(baselineOf(await post(app, 'call', { caller: 'operator', tool: 'crm__update_customer' })), ok);
      const l = await post(app, 'list', { caller: 'analyst' });
      assert.ok((await record(app, l.json.run.id)).json.record);
    }, dead);
  });
  assert.ok(!err2.includes(SECRET));
  assert.match(err2, /run observability: line Error \(the error's text is not logged\)/);
});

test('a recorder that throws while building the events leaves the answer as it was, says so in the answer, and keeps the error\'s text out of stderr', T, async () => {
  const SECRET = part('agent-key-', 'must-not-reach-stderr');
  let ok;
  await withApp({}, async (app) => { ok = baselineOf(await post(app, 'call', { caller: 'analyst', tool: 'crm__export_all' })); });
  const real = createRunLog({ write: () => {} });
  const broken = { ...real, mock: (kind, build) => real.mock(kind, () => { build(); throw new TypeError(SECRET); }) };
  const err = await stderrOf(async () => {
    await withApp({}, async (app) => {
      const r = await post(app, 'call', { caller: 'analyst', tool: 'crm__export_all' });
      assert.deepEqual(baselineOf(r), ok);
      assert.equal(r.json.run, null);
      assert.match(r.json.runNote, /could not keep a record/);
      const l = await post(app, 'list', { caller: 'analyst' });
      assert.equal(l.status, 200); assert.equal(l.json.run, null);
    }, broken);
  });
  assert.match(err, /mock-run TypeError/);
  assert.ok(!err.includes(SECRET));
});

// ---- Real, against a fake gateway on loopback ----------------------------------------------------------------------------------------------------------
async function fakeGateway() {
  const g = { script: { list: null, call: null }, seen: [], deleteDelay: 0, initStatus: 0, url: '', port: 0 };
  const json = (res, obj, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'mcp-session-id': 's1' }); res.end(JSON.stringify(obj)); };
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.method === 'DELETE') { setTimeout(() => { res.writeHead(200); res.end(); }, g.deleteDelay); return; }
      const m = JSON.parse(body || '{}');
      g.seen.push({ method: m.method, auth: req.headers.authorization, url: req.url });
      if (m.method === 'initialize' && g.initStatus) return json(res, { message: `refusing ${req.headers.authorization}` }, g.initStatus);
      if (m.method === 'initialize') return json(res, { jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'fake-gateway' }, capabilities: {} } });
      if (m.method === 'notifications/initialized') { res.writeHead(202); return res.end(); }
      const step = m.method === 'tools/list' ? g.script.list : g.script.call;
      return step({ m, res, req, json: (o, s) => json(res, o, s) });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  g.port = server.address().port; g.url = `http://127.0.0.1:${g.port}`;
  g.close = () => new Promise((r) => { server.closeAllConnections(); server.close(r); });
  g.script.list = tools(['crm__find_customer', 'wiki__search_pages']);
  g.script.call = rpcError('"crm__export_all" is not exposed by this aggregate');
  return g;
}
const tools = (names) => ({ m, json }) => json({ jsonrpc: '2.0', id: m.id, result: { tools: names.map((name) => ({ name, description: 'a tool' })) } });
const rpcError = (message) => ({ m, json }) => json({ jsonrpc: '2.0', id: m.id, error: { code: -32600, message } });
const rpcResult = (result) => ({ m, json }) => json({ jsonrpc: '2.0', id: m.id, result });
const status = (code, text = 'no') => ({ json }) => json({ message: text }, code);
const drop = ({ req }) => req.socket.destroy();
const rawText = ({ res }) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('<html>not json</html>'); };
async function withGateway(fn, { runLog, gw: tweak } = {}) {
  const gw = await fakeGateway();
  if (tweak) tweak(gw);
  try {
    await withApp({ AGG_ENT_GW_URL: gw.url, AGG_ENT_GW_APPS: 'full,limited', AGG_ENT_GW_KEY_ANALYST: KEY_A, AGG_ENT_GW_KEY_LAB_AGENT: KEY_B }, async (app) => { await app.call('POST', '/api/mode', { source: 'real' }); return fn(app, gw); }, runLog);
  } finally { await gw.close(); }
}
const rlist = (app, caller = 'analyst', a = 'full') => post(app, 'real/list', { app: a, caller });
const rcall = (app, tool = 'crm__export_all', caller = 'analyst', a = 'full') => post(app, 'real/call', { app: a, caller, tool, confirm: true });

test('Real listing: one `response` row at the time the lab had the reply, one line, and neither the key nor the gateway address in the record or the line', T, async () => {
  const { lines, runLog } = capture();
  await withGateway(async (app, gw) => {
    const t0 = Date.now();
    const r = await rlist(app);
    assert.equal(r.status, 200);
    const rec = (await record(app, r.json.run.id)).json.record;
    assert.deepEqual(assertRunObservability(rec), []);
    assert.equal(rec.source, 'real');
    assert.deepEqual(shape(rec), [['gateway', 'allowed']]);
    assert.equal(rows(rec)[0].origin, 'response');
    assert.deepEqual(rec.coverage, { person: 'not-logged', agent: 'not-logged', authorize: 'not-logged', privilege: 'not-logged', gateway: 'response', resource: 'not-logged' });
    assert.ok(!rec.rows.some((x) => x.origin === 'logged'));
    assert.match(rows(rec)[0].message, /answered tools\/list with 2 tools/);
    assert.equal(rows(rec)[0].detail.app, 'full');
    assert.equal(lines.length, 1);
    assert.match(lines[0], LINE); noMatcherReads(lines[0]);
    assert.match(lines[0], / step=gateway-list layer=gateway actor=analyst result=passed cause=tools-listed run=list-/);
    assert.equal(lines[0].split(' ')[0], rows(rec)[0].at, 'row time is the line\'s time');
    assert.ok(Date.parse(rows(rec)[0].at) >= t0 - 5 && Date.parse(rows(rec)[0].at) <= Date.now());
    const everything = `${JSON.stringify(rec)}\n${lines.join('\n')}`;
    assert.ok(!everything.includes(KEY_A) && !everything.includes(String(gw.port)) && !everything.includes('127.0.0.1'), 'no key, no gateway address');
    assert.equal((await record(app, r.json.run.id)).json.partial, false);
  }, { runLog });
});

test('Real call: the listing before it and the hidden name\'s reply are two `response` rows, the reply carries the lab\'s reading in its words, is information, and nothing is claimed about Privilege', T, async () => {
  const { lines, runLog } = capture();
  await withGateway(async (app) => {
    const r = await rcall(app);
    assert.equal(r.status, 200);
    const body = (await record(app, r.json.run.id)).json;
    const rec = body.record;
    assert.deepEqual(assertRunObservability(rec), []);
    assert.deepEqual(shape(rec), [['gateway', 'allowed'], ['gateway', 'refused']]);
    assert.equal(rec.summary.refused, 1, 'the fake gateway says "not exposed by this aggregate", which the lab reads as the ToolFilter: a policy stop, so it is refused');
    assert.ok(rows(rec).every((x) => x.origin === 'response'));
    assert.match(rows(rec)[1].message, /while the lab was opening or making tools\/call for a hidden name/);
    assert.match(rows(rec)[1].message, /The lab's own reading, not a gateway field: it matches check 4, the ToolFilter/);
    assert.equal(rec.coverage.privilege, 'not-logged');
    assert.match(rec.reasons.privilege, /not read by this lab/);
    assert.equal(body.partial, false);
    assert.deepEqual(lines.map((x) => / step=(\S+)/.exec(x)[1]), ['gateway-list', 'gateway-call']);
    assert.deepEqual(lines.map((x) => x.split(' ')[0]), rows(rec).map((x) => x.at));
    assert.ok(Date.parse(lines[0].split(' ')[0]) <= Date.parse(lines[1].split(' ')[0]));
    assert.ok(/ result=stopped cause=jsonrpc-refusal /.test(lines[1]));
    lines.forEach(noMatcherReads);
  }, { runLog });
});

test('the row time is the time of the reply, not of the session close that follows it', T, async () => {
  const { lines, runLog } = capture();
  await withGateway(async (app) => {
    const t0 = Date.now();
    const r = await rlist(app);
    const total = Date.now() - t0;
    const at = Date.parse(lines[0].split(' ')[0]);
    assert.ok(total >= 700, `the close took its 700 ms (${total})`);
    assert.ok(at - t0 < 500, `the reply was stamped ${at - t0} ms after the request, not after the close`);
    const rec = (await record(app, r.json.run.id)).json.record;
    assert.equal(Date.parse(rows(rec)[0].at), at);
  }, { runLog, gw: (gw) => { gw.deleteDelay = 700; } });
});

test('how each kind of reply is read: only a 403 is refused, a usable 200 allowed, a 401, a JSON-RPC error, an isError reply, an unparsed body or another status information', T, async () => {
  const cases = [
    ['list', status(401), 'info', /HTTP 401 while the lab was opening or making tools\/list: it did not accept the agent key/],
    ['list', status(403), 'refused', /HTTP 403/],
    ['list', status(500), 'info', /HTTP 500.*not a policy verdict/],
    ['list', rpcError('boom'), 'info', /JSON-RPC error while the lab was opening or making tools\/list, inside a successful HTTP reply/],
    ['list', rpcResult({ tools: [] }), 'info', /no tools/],
    ['list', rawText, 'info', /could not read the gateway's answer/],
    ['call', rpcError('"crm__export_all" is not exposed by this aggregate'), 'refused', /JSON-RPC error while the lab was opening or making tools\/call for a hidden name.*it matches check 4, the ToolFilter/],
    ['call', rpcError('refused by policy'), 'refused', /JSON-RPC error.*it matches check 5 or 6/],
    ['call', rpcError('boom'), 'info', /JSON-RPC error while the lab was opening or making tools\/call for a hidden name, inside a successful HTTP reply/],
    ['call', rpcResult({ isError: true, content: [{ type: 'text', text: '"crm__export_all" is not exposed by this aggregate' }] }), 'refused', /tool error \(isError\).*it matches check 4, the ToolFilter/],
    ['call', rpcResult({ isError: true, content: [{ type: 'text', text: 'x' }] }), 'info', /tool error \(isError\): that is the tool's own outcome, not a policy stop/],
    ['call', rpcResult({ content: [{ type: 'text', text: 'ran' }] }), 'allowed', /did not refuse tools\/call for a hidden name/],
    ['call', rpcResult({ content: [] }), 'info', /no content/],
    ['call', status(500), 'info', /HTTP 500/],
    ['call', rawText, 'info', /could not read/],
  ];
  for (const [which, script, outcome, words] of cases) {
    await withGateway(async (app, gw) => {
      gw.script[which === 'list' ? 'list' : 'call'] = script;
      const r = which === 'list' ? await rlist(app) : await rcall(app, 'crm__export_all');
      const rec = (await record(app, r.json.run.id)).json.record;
      assert.deepEqual(assertRunObservability(rec), []);
      const own = rows(rec);
      const row = own.at(-1);
      assert.equal(row.outcome, outcome, `${which} ${words}`);
      assert.match(row.message, words);
      assert.equal(row.origin, 'response');
      assert.equal(rec.summary.refused, outcome === 'refused' ? 1 : 0, `${which} ${words}: only a policy stop counts as refused`);
    });
  }
});

test('a refusal while the lab is opening a call is not worded as the answer to tools/list or tools/call: the shared client does not say which request got it', T, async () => {
  await withGateway(async (app) => {
    const r = await rlist(app);
    const row = rows((await record(app, r.json.run.id)).json.record)[0];
    assert.equal(row.outcome, 'info', 'a 401 is a credential check, not a policy decision');
    assert.match(row.message, /HTTP 401 while the lab was opening or making tools\/list/);
    assert.doesNotMatch(row.message, /answered tools\/list with/);
    assert.equal(row.detail.during, 'tools/list');
    assert.ok(!('step' in row.detail), 'detail names no completed step');
  }, { gw: (gw) => { gw.initStatus = 401; } });
});

test('a call that got no reply is no row and no pass: a no-reply line, the record is partial and says why, and an earlier call\'s answer is not borrowed', T, async () => {
  const { lines, runLog } = capture();
  await withGateway(async (app, gw) => {
    gw.script.call = drop;
    const r = await rcall(app);
    const body = (await record(app, r.json.run.id)).json;
    const rec = body.record;
    assert.deepEqual(assertRunObservability(rec), []);
    assert.deepEqual(shape(rec), [['gateway', 'allowed']], 'the listing\'s row only: the call has none');
    assert.equal(body.partial, true);
    assert.match(body.notes.join(' '), /tools\/call got no reply/);
    assert.match(rec.reasons.gateway, /got no reply/);
    assert.deepEqual(lines.map((x) => / step=(\S+)/.exec(x)[1]), ['gateway-list', 'gateway-call']);
    assert.match(lines[1], / result=no-reply cause=no-reply /);
    // both calls dropped: no row at all, the layer says why, and no layer claims a pass
    gw.script.list = drop;
    const both = await rcall(app);
    const b = (await record(app, both.json.run.id)).json.record;
    assert.equal(rows(b).length, 0);
    assert.equal(b.coverage.gateway, 'not-logged');
    assert.match(b.reasons.gateway, /got no reply/);
    assert.equal(b.summary.allowed, 0);
  }, { runLog });
});

test('an isError reply is refused only when the lab reads its text as a refusal; a JSON-RPC error is refused under the same reading (F2, F3)', () => {
  const isErr = (text) => ({ ok: true, isError: true, text, ms: 3 });
  const rpc = (message) => ({ ok: false, refusal: { status: null, message, layer: readRefusal({ message }) }, ms: 3 });
  const asRefusal = isErr('"crm__export_all" is not exposed by this aggregate');
  assert.equal(replyOf('tools/call', asRefusal, 'full').outcome, 'refused');
  assert.equal(replyOf('tools/call', asRefusal, 'full').cause, 'tool-error-refusal');
  assert.equal(replyOf('tools/call', isErr('the tool ran'), 'full').outcome, 'info');
  assert.equal(replyOf('tools/call', isErr('the tool ran'), 'full').cause, 'tool-error');
  assert.equal(replyOf('tools/call', rpc('"crm__export_all" is not exposed by this aggregate'), 'full').outcome, 'refused');
  assert.equal(replyOf('tools/call', rpc('"crm__export_all" is not exposed by this aggregate'), 'full').cause, 'jsonrpc-refusal');
  assert.equal(replyOf('tools/call', rpc('boom'), 'full').outcome, 'info');
  assert.equal(replyOf('tools/call', rpc('boom'), 'full').cause, 'jsonrpc-error');
});

test('faults are information even when their words match a refusal check: a timed-out or unreachable JSON-RPC error, an unreachable isError reply and an unknown tool are not refusals (N1)', () => {
  const isErr = (text) => ({ ok: true, isError: true, text, ms: 3 });
  const rpc = (message) => ({ ok: false, refusal: { status: null, message, layer: readRefusal({ message }) }, ms: 3 });
  assert.equal(replyOf('tools/call', rpc('request timed out after 15000ms'), 'full').outcome, 'info');
  assert.equal(replyOf('tools/call', rpc('request timed out after 15000ms'), 'full').cause, 'jsonrpc-error');
  assert.equal(replyOf('tools/call', isErr('member crm unreachable: connection refused'), 'full').outcome, 'info');
  assert.equal(replyOf('tools/call', isErr('member crm unreachable: connection refused'), 'full').cause, 'tool-error');
  assert.equal(replyOf('tools/call', rpc('unknown tool crm__export_all'), 'full').outcome, 'info');
  assert.equal(replyOf('tools/call', rpc('unknown tool crm__export_all'), 'full').cause, 'jsonrpc-error');
  assert.equal(replyOf('tools/call', rpc('refused by policy'), 'full').outcome, 'refused', 'a real policy refusal stays refused');
  assert.equal(replyOf('tools/call', isErr('refused by policy'), 'full').outcome, 'refused', 'a real policy refusal in isError stays refused');
});

test('a gateway refusal that uses the shared client\'s own "unreachable" words is read as no connection, and is never shown as allowed (documented)', () => {
  assert.equal(replyOf('tools/list', { ok: false, refusal: { status: null, message: 'MCP HTTP request unreachable (ECONNREFUSED)' } }), null);
  assert.equal(replyOf('tools/call', { ok: false, refusal: { status: null, message: 'MCP HTTP request timed out after 15000ms' } }), null);
  assert.equal(replyOf('tools/list', undefined), null);
  assert.equal(replyOf('tools/list', 'x'), null);
  for (const r of [{ ok: false, refusal: { status: null, message: 'unreachable' } }, { ok: false, refusal: {} }, { ok: false }, { ok: 'true' }]) {
    const e = replyOf('tools/call', r, 'full');
    assert.notEqual(e?.outcome, 'allowed');
  }
});

test('a name in the caller\'s listing is not sent: the run holds the listing and says the call was not sent, and the answer still names the run', T, async () => {
  await withGateway(async (app, gw) => {
    const r = await rcall(app, 'crm__find_customer');
    assert.equal(r.status, 409);
    assert.equal(r.json.error, 'listed_tool');
    const body = (await record(app, r.json.run.id)).json;
    assert.deepEqual(shape(body.record), [['gateway', 'allowed']]);
    assert.equal(body.partial, true);
    assert.match(body.record.reasons.gateway, /tools\/call was not sent: that name is in the caller's listing/);
    assert.equal(gw.seen.filter((s) => s.method === 'tools/call').length, 0);
  });
});

test('Real requests that fail validation begin no run: no line, `run: null`, and no record', T, async () => {
  const { lines, runLog } = capture();
  await withGateway(async (app) => {
    const cases = [
      rcall(app, 'not a tool', 'analyst'), post(app, 'real/call', { app: 'full', caller: 'analyst', tool: 'crm__export_all' }), post(app, 'real/list', { app: 'nope', caller: 'analyst' }),
      post(app, 'real/list', { app: 'full', caller: 'ghost' }), post(app, 'real/list', { app: 'full', caller: 'analyst', extra: 1 }),
    ];
    for (const r of await Promise.all(cases)) {
      assert.ok(r.status === 400, r.text);
      assert.equal(r.json.run, null);
      assert.match(r.json.runNote, /began no run/);
    }
    await app.call('POST', '/api/mode', { source: 'mock' });
    const m = await rlist(app);
    assert.equal(m.status, 409);
    assert.equal(m.json.run, null);
    assert.equal(lines.length, 0);
  }, { runLog });
});

test('the agent key and the gateway address stay out of every field, however the gateway echoes them', T, async () => {
  const { lines, runLog } = capture();
  await withGateway(async (app, gw) => {
    gw.script.call = rpcError(`refused for ${KEY_A} at ${gw.url} Bearer ${KEY_A}`);
    gw.script.list = ({ json, m }) => json({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: `tool_${KEY_A}`, description: gw.url }] } });
    const r = await rcall(app, 'crm__export_all');
    const rec = (await record(app, r.json.run.id)).json.record;
    const everything = `${JSON.stringify(rec)}\n${lines.join('\n')}`;
    assert.ok(!everything.includes(KEY_A) && !everything.includes(KEY_B) && !everything.includes(gw.url) && !everything.includes(String(gw.port)));
    assert.deepEqual(assertRunObservability(rec), []);
  }, { runLog });
});

test('Real names no correlation id: a key-shaped caller label is written whole, never shortened to a fragment', T, async () => {
  const { lines, runLog } = capture();
  await withGateway(async (app) => {
    const r = await rlist(app, 'lab_agent');
    assert.equal(r.status, 200);
    assert.match(lines[0], / actor=lab_agent /);
    const rec = (await record(app, r.json.run.id)).json.record;
    assert.ok(!JSON.stringify(rec).includes('lab__nt'));
  }, { runLog });
});

test('Real list and call stay in the lab\'s own routes: the existing answers keep every field they had', T, async () => {
  await withGateway(async (app) => {
    const r = await rlist(app);
    for (const k of ['claim', 'reading', 'app', 'caller', 'ok', 'tools', 'ms', 'trace', 'run']) assert.ok(k in r.json, k);
    const c = await rcall(app);
    for (const k of ['claim', 'reading', 'app', 'caller', 'tool', 'listedFirst', 'listTrace', 'ok', 'refusal', 'ms', 'trace', 'run']) assert.ok(k in c.json, k);
  });
});

test('a Real record says, per layer it does not read, why: nothing is shown as a Privilege, Authorize or resource log', T, async () => {
  await withGateway(async (app) => {
    const r = await rlist(app);
    const rec = (await record(app, r.json.run.id)).json.record;
    for (const layer of ['person', 'agent', 'authorize', 'privilege', 'resource']) assert.equal(rec.coverage[layer], 'not-logged', layer);
    assert.match(rec.reasons.person, /has no sign-in/);
    assert.match(rec.reasons.agent, /agent access key.*not an OBO token/);
    assert.match(rec.reasons.authorize, /does not call PingOne Authorize/);
    assert.match(rec.reasons.resource, /wrote no log this lab can read/);
  });
});

test('the README states the number of runs the code keeps', () => {
  const readme = fs.readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes(`the last ${KEEP_RUNS} of each kind per mode`));
  assert.ok(readme.includes(`last ${KEEP_RUNS} per kind and mode`));
});

test(`SERVICE names this lab, and the newest of ${KEEP_RUNS + 3} listings in a row is still reachable`, T, async () => {
  assert.equal(SERVICE, 'aggregate-entitlement-lab');
  await withApp({}, async (app) => {
    let last;
    for (let i = 0; i < KEEP_RUNS + 3; i += 1) last = await post(app, 'list', { caller: 'analyst' });
    assert.ok((await record(app, last.json.run.id)).json.record);
  });
});
