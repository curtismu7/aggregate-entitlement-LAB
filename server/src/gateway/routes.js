// /api/gateway/*: the simulated gateway over HTTP. The browser sends the config it is editing with each request, and nothing of it is stored on the host;
// the only thing kept is the last few run records of rule 27 (runObs.js), fetched by the id a run's own answer carried.
// Everything runs in this process; there is no outbound call of any kind. Errors never repeat what the sender typed.
import express from 'express';
import { analyze, buildReport } from '../scanner/index.js';
import { BOUNDS, ConfigError, TOOL_NAME, credentialLike, nameOk, normalizeConfig } from './config.js';
import { freshConfig } from './fixture.js';
import { BANNER, PROVENANCE, TAG_TEXT } from './provenance.js';
import { mockCallTrace, mockListTrace } from './aggregateTrace.js';
import { createReal } from './real.js';
import { RunObsError } from '../runObservability.js';
import { NO_LONGER_KEPT, NO_RUN, createRunLog, mockCallEvents, mockListEvents, recordOf, reportFailure, runField } from '../runObs.js';
import { audit, callAggregate, callMember, callerOf, listAggregate, listMember, memberOf } from './sim.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const VIEWS = ['aggregate', 'direct'];
const CLAIM = Object.freeze({ banner: BANNER, model: 'lab-invented simulation in this process', live: false });
const QUALIFIED_NAME = /^[a-z][a-z0-9-]{0,15}__[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const bad = (res, message, status = 400, error = 'bad_request', extra = {}) => res.status(status).json({ error, message, claim: CLAIM, ...extra });
const RUN_ID = /^(?:list|call)-[0-9a-f]{6}-[0-9]{1,9}$/;

// Strings anywhere in call arguments are checked for credential shapes, with a bound on depth and size. Never echoed.
function argsLookLikeCredentials(v, depth = 0, budget = { n: 200 }) {
  if (budget.n-- <= 0 || depth > 4) return true; // too big or too deep is refused too
  if (typeof v === 'string') return v.length > 2000 || credentialLike(v);
  if (Array.isArray(v)) return v.some((x) => argsLookLikeCredentials(x, depth + 1, budget));
  if (isObj(v)) return Object.entries(v).some(([k, x]) => k.length > 100 || credentialLike(k) || argsLookLikeCredentials(x, depth + 1, budget));
  return false;
}

// One request body -> { cfg, view, caller, member } or throws ConfigError. Only the listed fields are accepted.
function parse(body, allowed) {
  if (!isObj(body)) throw new ConfigError('body', 'must be an object');
  for (const k of Object.keys(body)) if (!allowed.includes(k)) throw new ConfigError('body', 'unexpected field');
  const cfg = normalizeConfig(body.config === undefined ? freshConfig() : body.config);
  const view = body.view ?? 'aggregate';
  if (!VIEWS.includes(view)) throw new ConfigError('view', 'must be aggregate or direct');
  const caller = typeof body.caller === 'string' ? callerOf(cfg, body.caller) : null;
  if (!caller) throw new ConfigError('caller', 'is not a listed caller');
  let member = null;
  if (view === 'direct') {
    member = typeof body.member === 'string' ? memberOf(cfg, body.member) : null;
    if (!member) throw new ConfigError('member', 'is not a listed member');
  } else if (body.member !== undefined) throw new ConfigError('member', 'is only used by the direct view');
  return { cfg, view, caller, member };
}
const listing = ({ cfg, view, caller, member }) => (view === 'direct' ? listMember(cfg, member, caller.id) : listAggregate(cfg, caller.id));

export function createGatewayRouter({ getMode = () => 'mock', env = process.env, real = createReal({ env }), runs = createRunLog() } = {}) {
  const router = express.Router();
  const json = express.json({ limit: '64kb' });
  // A request that fails validation began no run: the answer says so in a field, so the page never guesses it.
  const wrap = (fn, beginsRun = false) => (req, res) => {
    try { fn(req, res); } catch (err) {
      if (err instanceof ConfigError) return bad(res, err.message, 400, 'bad_config', beginsRun ? NO_RUN : {});
      console.error('[aggregate-entitlement] gateway error:', err?.code || err?.name);
      return res.status(500).json({ error: 'server_error' });
    }
  };

  router.get('/default', (_req, res) => res.json({
    claim: CLAIM, config: freshConfig(), bounds: BOUNDS, tags: TAG_TEXT, provenance: PROVENANCE,
  }));

  router.post('/list', json, wrap((req, res) => {
    const p = parse(req.body, ['config', 'view', 'caller', 'member']);
    const listed = listing(p);
    const run = runs.mock('list', () => mockListEvents({ ...p, listed }));
    res.json({ claim: CLAIM, view: p.view, caller: p.caller.id, ...listed, trace: mockListTrace({ ...p, listed }), ...runField(run) });
  }, true));

  router.post('/call', json, wrap((req, res) => {
    const p = parse(req.body, ['config', 'view', 'caller', 'member', 'tool', 'arguments']);
    const re = p.view === 'direct' ? TOOL_NAME : QUALIFIED_NAME;
    if (!nameOk(req.body.tool, re)) throw new ConfigError('tool', 'is not a well-formed tool name');
    if (req.body.arguments !== undefined && (!isObj(req.body.arguments) || argsLookLikeCredentials(req.body.arguments))) throw new ConfigError('arguments', 'must be a small object with no credential in it');
    const out = p.view === 'direct' ? callMember(p.cfg, p.member, p.caller.id, req.body.tool) : callAggregate(p.cfg, p.caller.id, req.body.tool);
    const { ok, trace, ...rest } = out;
    const run = runs.mock('call', () => mockCallEvents({ ...p, tool: req.body.tool, args: req.body.arguments, out }));
    res.status(ok ? 200 : 403).json({
      claim: CLAIM, ...rest, demoTrace: { note: 'Demo only: a real gateway would show the caller just the refusal.', steps: trace },
      trace: mockCallTrace({ ...p, tool: req.body.tool, args: req.body.arguments, out }), ...runField(run),
    });
  }, true));

  router.post('/audit', json, wrap((req, res) => {
    const p = parse(req.body, ['config', 'view', 'caller', 'member']);
    res.json({ claim: CLAIM, demoOnly: 'This view names hidden tools. A caller never sees it.', view: p.view, caller: p.caller.id, rows: audit(p.cfg, p.caller.id, p.member) });
  }));

  // Scan the listing exactly as this caller sees it, with the filtered-list caveat in the notes.
  router.post('/scan', json, wrap((req, res) => {
    const p = parse(req.body, ['config', 'view', 'caller', 'member']);
    const seen = listing(p);
    const input = { tools: seen.tools.map((t) => structuredClone(t)) };
    const { findings, truncated } = analyze(input, { trustedNames: [] });
    const report = buildReport({ findings, truncated, input, source: { type: 'snapshot', label: `simulated gateway listing as ${p.caller.label}` } });
    report.notes = [
      `This scan covers only the ${seen.tools.length} tool(s) that ${p.caller.label} sees. Tools hidden from this caller were not scanned, so a clean result here is not a clean result for any other caller.`,
    ];
    res.json({ claim: CLAIM, view: p.view, caller: p.caller.id, report, listed: seen });
  }));

  // ---- Real: the same questions asked of a real gateway's MCP aggregate apps, with the operator's agent keys ----
  const REAL_CLAIM = Object.freeze({ banner: BANNER, model: 'measured on the gateway named in AGG_ENT_GW_URL', live: true });
  const READING = 'Which check a refusal matches is our reading of the gateway\'s message; the gateway does not name the check.';
  const realView = () => {
    const cfg = real.load();
    return { mode: getMode(), available: cfg.ok, ...(cfg.ok ? { version: cfg.version, apps: cfg.apps, callers: cfg.callers.map(({ id, label }) => ({ id, label })) } : { problem: cfg.problem }) };
  };
  // Every Real request: Real mode on, configured, and an app and caller from the settings. -> cfg, or sends the refusal.
  function realGate(req, res, allowed) {
    if (getMode() !== 'real') { res.status(409).json({ error: 'mock_mode', message: 'Switch the header to Real to ask the real gateway.', ...NO_RUN }); return null; }
    const cfg = real.load();
    if (!cfg.ok) { res.status(409).json({ error: 'real_not_configured', message: cfg.problem, ...NO_RUN }); return null; }
    const b = req.body;
    if (!isObj(b) || Object.keys(b).some((k) => !allowed.includes(k))) { bad(res, `accepted fields: ${allowed.join(', ')}`, 400, 'bad_request', NO_RUN); return null; }
    if (!real.isApp(cfg, b.app)) { bad(res, 'app is not one of AGG_ENT_GW_APPS', 400, 'bad_request', NO_RUN); return null; }
    if (!real.isCaller(cfg, b.caller)) { bad(res, 'caller is not one of the configured keys', 400, 'bad_request', NO_RUN); return null; }
    return cfg;
  }
  const realWrap = (fn) => (req, res) => fn(req, res).catch((err) => {
    console.error('[aggregate-entitlement] real gateway error:', err?.code || err?.name);
    if (!res.headersSent) res.status(500).json({ error: 'server_error' });
  });

  router.get('/real', (_req, res) => res.set('Cache-Control', 'no-store').json({ claim: REAL_CLAIM, reading: READING, ...realView() }));

  router.post('/real/list', json, realWrap(async (req, res) => {
    const cfg = realGate(req, res, ['app', 'caller']);
    if (!cfg) return;
    const run = runs.begin('list', req.body.caller, req.body.app);
    const out = await run.step('tools/list', () => real.list(cfg, req.body.app, req.body.caller));
    run.end();
    res.json({ claim: REAL_CLAIM, reading: READING, app: req.body.app, caller: req.body.caller, ...out, ...runField(run.id) });
  }));

  // Only a name that is NOT in this caller's listing is sent: this route tests the refusal, it never runs a listed tool.
  router.post('/real/call', json, realWrap(async (req, res) => {
    const cfg = realGate(req, res, ['app', 'caller', 'tool', 'confirm']);
    if (!cfg) return;
    if (!real.isTool(req.body.tool)) return bad(res, 'tool is not a well-formed tool name', 400, 'bad_request', NO_RUN);
    if (req.body.confirm !== true) return bad(res, 'confirm must be true: this sends a real tools/call to the gateway', 400, 'bad_request', NO_RUN);
    // The listing is a real exchange with the gateway, so a run begins with it even when the call is then not sent.
    const run = runs.begin('call', req.body.caller, req.body.app);
    const seen = await run.step('tools/list', () => real.list(cfg, req.body.app, req.body.caller));
    if (seen.ok && seen.tools.some((t) => t.name === req.body.tool)) {
      run.skipped('The tools/call was not sent: that name is in the caller\'s listing, and this page only sends a name the caller was not shown.');
      run.end();
      return res.status(409).json({ error: 'listed_tool', message: 'That tool is in this caller\'s listing. This page only tests that a hidden name is refused; call a listed tool from the Server page, behind the confirm dialog.', listTrace: seen.trace, ...runField(run.id) });
    }
    const out = await run.step('tools/call', () => real.callHidden(cfg, req.body.app, req.body.caller, req.body.tool));
    run.end();
    res.json({ claim: REAL_CLAIM, reading: READING, app: req.body.app, caller: req.body.caller, tool: req.body.tool, listedFirst: seen.ok, listTrace: seen.trace, ...out, ...runField(run.id) });
  }));

  // The record of one run (rule 27), asked for by the id the run's own answer carried. Only the current mode's runs are answered: a Mock run never comes back as a Real reply
  // after the toggle, and the other way round. A mode that is neither says so in plain words and answers no record.
  router.get('/run', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (Object.keys(req.query).some((k) => k !== 'runId')) return bad(res, 'the query carries a parameter this route does not take', 400, 'unknown_field');
    const id = req.query.runId;
    if (typeof id !== 'string' || !RUN_ID.test(id)) return bad(res, 'runId must be the id of one run', 400, 'bad_run_id');
    const mode = getMode();
    if (mode !== 'mock' && mode !== 'real') return res.json({ record: null, message: 'This lab is not in a mode that keeps run records, so there is nothing to show.' });
    const run = runs.get(id);
    if (!run) return res.json({ record: null, message: NO_LONGER_KEPT });
    if (run.source !== mode) return res.json({ record: null, message: `That run was made in ${run.source === 'mock' ? 'Mock' : 'Real'} mode, so it is not shown while the header is on ${mode === 'mock' ? 'Mock' : 'Real'}.` });
    try {
      res.json({ record: await recordOf(run), partial: run.partial, notes: run.notes });
    } catch (err) {
      if (err instanceof RunObsError) return res.status(err.status).json({ error: err.code, message: err.message });
      reportFailure('record', err);
      return res.status(500).json({ error: 'server_error', message: 'The lab could not build this run\'s record (the server log says why).' });
    }
  });
  router.all('/run', (_req, res) => res.set('Allow', 'GET, HEAD').status(405).json({ error: 'method_not_allowed', message: 'This route answers GET only.' }));

  return router;
}
