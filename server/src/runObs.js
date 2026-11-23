// Rule 27: this lab's side of the shared run-observability panel. The vendored collector (runObservability.js) is never edited here, and this is the ONE file
// that maps this lab's decisions onto the six layers (the page's wrapper is web/src/components/RunObs.jsx), so a later sweep of the lab this one was forked from
// (mcp-tools-LAB, its Entitled listing page) can reuse it.
//
// What a run is here. One request to the gateway that the page shows in its trace: a `tools/list` or a `tools/call` (kind `list` or `call`). Mock: the simulated aggregate
// (gateway/sim.js) answers one request, and every row is a step that answer holds: nothing is computed twice and nothing the simulation did not compute is shown. The
// simulation answers in one synchronous call, so the rows of one request share one instant (their order is kept, in detail.eventSeq). Real (rule 19): the lab's own MCP client
// asks the owner's gateway; a Real record holds only the replies the lab RECEIVED (`response` rows, never `logged`), each stamped with the time of the reply.
// The aggregate, the member servers and every Privilege policy log are not read by this lab: the layers that would hold them say so.
//
// Which layer holds what (Mock). Policy decisions are Privilege's: the ToolFilter, the member's own policy and the aggregate cap are `allowed` or `refused` in the
// Privilege layer. A fact about a member (the configuration marks it unreachable, or the caller has no sign-in to it) is information in the Resource server layer: a fault and a
// credential state are not policy decisions. The Agent gateway row is the answer the aggregate sent back; it repeats the decision above it, so it is information (a
// listing is the one answer with no decision above it, and it is `allowed` when it carries tools, as in Real). A name no member has is a lookup, not a policy, and is
// information in the Agent gateway layer. In Real the gateway's reply is all the lab holds, so it is the Agent gateway row, and the lab's reading of which check a refusal
// matches is words on that row, never a Privilege row.
//
// Stdout line: `<iso> aggregate-entitlement-lab decision step=<step> layer=<layer> actor=<who> result=<passed|stopped|unclear|no-reply> cause=<cause> run=<id>`, one per row,
// stamped with the row's own time. The family's matchers read words such as refused, denied, rejected, forbidden, failed, invalid, expired, mismatch, token, audience,
// scope and served, so steps and causes come from the tables below and use none of them, and the one typed field (the caller) has them replaced. A line never holds a key, a tool
// name or a gateway address. A test runs every line kind through the shared classify() for every product.
import crypto from 'node:crypto';
import { createMasker, createRunObservability, LAYERS } from './runObservability.js';

export const SERVICE = 'aggregate-entitlement-lab';
export const KEEP_RUNS = 12; // closed runs kept, per mode and per kind: a listing that is recomputed on every edit never pushes a call out
export const NO_RUN_BEGAN = 'This request began no run, so nothing was recorded.';
export const RECORDER_DOWN = 'The lab could not keep a record of this run (the server log says why).';
export const NO_LONGER_KEPT = 'That run is no longer kept: the lab keeps the last few runs of each kind per mode, and Reset clears them.';

// Only safe characters survive, so a typed name cannot add a second key=value pair, a quote or a line.
export const lineValue = (v, n = 64) => String(v ?? '').replace(/[^A-Za-z0-9._:/@-]+/g, '_').slice(0, n) || '-';
const MATCHER_WORDS = /refused|denied|rejected|forbidden|failed|invalid|expired|mismatch|token|audience|scope|served|unauthori[sz]ed|insufficient/gi;
// The panel masks emails, addresses and ids in every row, so the stdout line masks them too; the words the shared matchers read are replaced in what a visitor can type.
const { mask } = createMasker();
const field = (v) => lineValue(mask(String(v ?? ''))).replace(MATCHER_WORDS, '_');
const RESULT = { allowed: 'passed', refused: 'stopped', info: 'unclear' };
const iso = (ms) => new Date(ms).toISOString();

// A recorder that throws must never break the run or the answer: the failure goes to stderr and the run goes on. Only a code (or the error's name) and a fixed text are
// written: the error's own text could carry anything (the masker does not know the shape of an agent key), so it is never logged.
export function reportFailure(where, err) {
  process.stderr.write(`[${SERVICE}] run observability: ${lineValue(where, 40)} ${lineValue(err?.code || err?.name || 'error', 40)} (the error's text is not logged)\n`);
}
export function safely(where, fn) {
  try { return fn(); } catch (err) { reportFailure(where, err); return undefined; }
}

// ---- Mock: the steps one simulated request computed -------------------------------------------------------------------------------------------------
const PRODUCT = {
  agent: 'lab simulated agent caller', privilege: 'lab simulated aggregate policy', gateway: 'lab simulated aggregate gateway', resource: 'lab simulated member server',
};
const where = (view, member) => (view === 'direct' ? `the member ${member.alias} used directly` : 'the aggregate');
const STAGE_TEXT = { entry: 'entry', 'member-hop': 'member hop (the second check, with the tool\'s own name)', member: 'member (used directly: its own policy only)' };

// What each way the simulation can stop a call is, by the layer sim.js names. A policy check is a decision of the Privilege layer; a member's state is information about the
// resource; a name no member has is a lookup in the gateway. The caller is always told the same words (sim.js REFUSAL), which the gateway row says.
const STOP = {
  'tool-filter': { layer: 'privilege', outcome: 'refused', cause: 'tool-filter', text: (_c, at) => `The simulated aggregate's ToolFilter does not expose this tool, so the call was refused at the ${at}.` },
  'member-policy': { layer: 'privilege', outcome: 'refused', cause: 'member-policy', text: (c, at) => `The member's own policy does not allow ${c.label} to use this tool, so the call was refused at the ${at}.` },
  'aggregate-cap': { layer: 'privilege', outcome: 'refused', cause: 'aggregate-cap', text: (c, at) => `The aggregate policy cap does not allow ${c.label} to use this tool, so the call was refused at the ${at}.` },
  unreachable: { layer: 'resource', outcome: 'info', cause: 'member-down', text: () => 'The configuration marks the member unreachable, so the simulation stopped the call there. That is a simulated fault, not a policy decision.' },
  'upstream-sign-in': { layer: 'resource', outcome: 'info', cause: 'needs-sign-in', text: (c) => `The member needs each caller's own sign-in and ${c.label} has none in this configuration, so the simulation stopped the call there. That is a credential state, not a policy decision.` },
};
const PASSED = {
  entry: { cause: 'entry-passed', text: (c) => `The simulated aggregate's entry checks all passed for ${c.label}: the member is reachable and the caller signed in where needed, the ToolFilter exposes the tool, the member's own policy allows the caller and the aggregate cap allows it.` },
  'member-hop': { cause: 'hop-passed', text: () => 'At the member hop the simulation checked the aggregate cap and the member\'s own policy again, with the tool\'s own name, and both allowed it.' },
  member: { cause: 'member-passed', text: (c) => `The member is reachable, ${c.label} is signed in where needed and the member's own policy allows the caller. A member used directly follows its own policy only: no ToolFilter and no aggregate cap.` },
};

// The panel cuts a row's message at 300 characters, so every message here stays well under it even with a 40-character caller label and a 64-character tool name; the detail holds the rest.
const ask = (caller, text, detail) => ({
  layer: 'agent', product: PRODUCT.agent, step: 'ask', outcome: 'info', cause: '-', who: caller.id,
  message: `${caller.label} ${text}`, detail: { ...detail, simulatedCaller: 'the lab takes no agent key and there is no OBO token' },
});

// tools/list: `listed` is the reply sim.js gave ({ tools, members }). Its members' statuses are real events; which check removed which tool is not in the reply, so it is not claimed.
export function mockListEvents({ cfg, caller, view, member, listed }) {
  const total = (view === 'direct' ? member.tools : cfg.members.flatMap((m) => m.tools)).length;
  const n = listed.tools.length;
  const ev = [ask(caller, `asked tools/list through ${where(view, member)}.`, { request: 'tools/list', view })];
  for (const m of listed.members) {
    if (m.status === 'ok') continue;
    ev.push({
      layer: 'resource', product: PRODUCT.resource, step: 'member-state', outcome: 'info', cause: m.status === 'unreachable' ? 'member-down' : 'needs-sign-in', who: caller.id,
      message: m.status === 'unreachable'
        ? `The configuration marks the member ${m.alias} unreachable. The simulated aggregate reports that and lists none of its tools. That is a simulated fault, not a policy decision.`
        : `The member ${m.alias} needs each caller's own sign-in and ${caller.label} has none in this configuration, so the simulated aggregate lists none of its tools. That is a credential state, not a policy decision.`,
      detail: { member: m.alias, status: m.status },
    });
  }
  ev.push({
    layer: 'privilege', product: PRODUCT.privilege, step: 'list-filter', outcome: 'info', cause: '-', who: caller.id,
    message: `The simulated aggregate left ${n} of ${total} tools in ${caller.label}'s listing. The reply does not say which check removed each of the others, so none is named here: a caller is never told what was hidden (the demo audit view names them, and is not a gateway request).`,
    detail: { listed: n, of: total },
  });
  ev.push({
    layer: 'gateway', product: PRODUCT.gateway, step: 'gateway-list', outcome: n > 0 ? 'allowed' : 'info', cause: n > 0 ? 'tools-listed' : 'empty-list', who: caller.id,
    message: n > 0
      ? `The simulated aggregate answered tools/list with ${n} tools for ${caller.label}.`
      : `The simulated aggregate answered tools/list with no tools for ${caller.label}, so there is no usable listing to count as a pass.`,
    detail: { status: 200, tools: n },
  });
  return ev;
}

// tools/call: `out` is what callAggregate or callMember returned; out.trace holds its steps ({ stage, layer, decision }), each one a decision the simulation made.
export function mockCallEvents({ caller, view, member, tool, args, out }) {
  const argc = args && typeof args === 'object' ? Object.keys(args).length : 0;
  const ev = [ask(caller, `asked tools/call for ${tool} through ${where(view, member)}, with ${argc > 0 ? `${argc} argument${argc === 1 ? '' : 's'} (the values are never recorded)` : 'no arguments'}.`, { request: 'tools/call', view })];
  let lookup = false;
  for (const s of out.trace) {
    const at = STAGE_TEXT[s.stage];
    if (s.decision === 'passed') {
      const p = PASSED[s.stage];
      ev.push({ layer: 'privilege', product: PRODUCT.privilege, step: s.stage, outcome: 'allowed', cause: p.cause, who: caller.id, message: p.text(caller), detail: { stage: s.stage } });
    } else if (s.layer === 'unknown') {
      lookup = true;
      ev.push({
        layer: 'gateway', product: PRODUCT.gateway, step: 'no-such-tool', outcome: 'info', cause: 'no-such-tool', who: caller.id,
        message: `${view === 'direct' ? `${member.alias} has no tool` : 'No member has a tool'} named ${tool}, so the simulation answered tools/call with 403 and the same words it uses for a hidden tool: a caller cannot tell the two apart. A lookup is not a policy decision.`,
        detail: { stage: s.stage, status: 403 },
      });
    } else {
      const stop = STOP[s.layer];
      ev.push({ layer: stop.layer, product: PRODUCT[stop.layer], step: s.stage, outcome: stop.outcome, cause: stop.cause, who: caller.id, message: stop.text(caller, at), detail: { stage: s.stage, check: s.layer } });
    }
  }
  if (!lookup) {
    ev.push({
      layer: 'gateway', product: PRODUCT.gateway, step: 'answer', outcome: 'info', cause: out.ok ? 'answered-200' : 'answered-403', who: caller.id,
      message: out.ok
        ? 'The simulated aggregate answered tools/call with 200 and a placeholder result (nothing was run: the simulation has no member server). The answer repeats the decision above, so it is information.'
        : 'The simulated aggregate answered tools/call with 403 and the one refusal text it uses for every stop, so a caller cannot tell a hidden tool from an unknown one or a down member. The answer repeats the decision above, so it is information.',
      detail: { status: out.ok ? 200 : 403 },
    });
  }
  return ev;
}

// ---- Real: what the lab receives from the gateway ----------------------------------------------------------------------------------------------------
const NO_REPLY = /^MCP HTTP request (?:unreachable|timed out)/;
const UNREAD = /^(?:reply larger than|reply is not JSON)/;
const STEP_TEXT = { 'tools/list': 'tools/list', 'tools/call': 'tools/call for a hidden name' };
const GATEWAY_PRODUCT = 'Privilege gateway reply (aggregate app)';
// The lab's own reading of a refusal (real.js readRefusal); the gateway sends no such field.
const READING = {
  'tool-filter': 'it matches check 4, the ToolFilter',
  policy: 'it matches check 5 or 6, a policy; the gateway does not say which',
  unreachable: 'it matches check 2, a member the gateway could not reach',
  unknown: 'it matches check 1, no such tool',
  key: 'the gateway did not accept the agent key, before any check',
  other: 'it matches no known check',
};

// One call's answer -> an event, or null when there was no reply (the call did not connect or timed out). Only the answer in hand is read: nothing from an earlier call. The
// gateway's own words are never copied into a row (they are on the page's gateway card, scrubbed of keys). A call the lab completed names its step. A call that failed does not: the
// shared client does not say which of its requests (the opening handshake or the call itself) got the status or the JSON-RPC error, so the row says "while the lab was opening
// or making" the call and `detail.during` names it. Messages stay under the panel's 300-character cut (a test checks the longest).
export function replyOf(step, r, app) {
  if (!r || typeof r !== 'object') return null;
  const what = STEP_TEXT[step];
  const done = (outcome, cause, message, detail) => ({ outcome, cause, message, detail: { step, app, ...detail } });
  if (r.ok === true) {
    if (step === 'tools/list') {
      const n = Array.isArray(r.tools) ? r.tools.length : 0;
      return n > 0
        ? done('allowed', 'tools-listed', `The gateway answered ${what} with ${n} tools for the agent key.`, { tools: n, ms: r.ms })
        : done('info', 'empty-list', `The gateway answered ${what} with no tools, so there is no usable listing to count as a pass.`, { tools: 0, ms: r.ms });
    }
    if (r.isError === true) return done('info', 'tool-error', `The gateway answered ${what} with a tool error (isError): that is the tool's own outcome, not a policy stop, so it counts as information.`, { ms: r.ms });
    return typeof r.text === 'string' && r.text.length > 0
      ? done('allowed', 'tool-ran', `The gateway did not refuse ${what} and returned a tool result. A hidden name should be refused: check the aggregate's policy.`, { ms: r.ms })
      : done('info', 'no-content', `The gateway answered ${what} with no content, so the lab cannot read it as a tool result.`, { ms: r.ms });
  }
  const f = r.refusal && typeof r.refusal === 'object' ? r.refusal : {};
  const status = Number.isInteger(f.status) ? f.status : null;
  const reading = READING[f.layer] ?? READING.other;
  const opening = `while the lab was opening or making ${what}`;
  const failed = (outcome, cause, message, detail) => ({ outcome, cause, message, detail: { during: step, app, ...detail } });
  const readAs = ` The lab's own reading, not a gateway field: ${reading}.`;
  if (status === 401) return failed('info', 'status-401', `The gateway answered HTTP 401 ${opening}: it did not accept the agent key. A credential check is information, not a policy decision.`, { status, ms: r.ms, reading: f.layer });
  if (status === 403) return failed('refused', 'status-403', `The gateway answered HTTP 403 ${opening}.${readAs}`, { status, ms: r.ms, reading: f.layer });
  if (status !== null) return failed('info', `status-${status}`, `The gateway answered HTTP ${status} ${opening}. That status is not a policy verdict, so it counts as information.`, { status, ms: r.ms });
  const text = String(f.message ?? '');
  if (NO_REPLY.test(text)) return null;
  if (UNREAD.test(text)) return failed('info', 'unreadable', `The lab could not read the gateway's answer ${opening} as a tool result, so it counts as information.`, { ms: r.ms });
  return failed('info', 'jsonrpc-error', `The gateway answered with a JSON-RPC error ${opening}, inside a successful HTTP reply. The lab cannot tell a policy refusal from a fault, so it counts as information.`, { ms: r.ms, reading: f.layer });
}

// ---- Stdout lines ------------------------------------------------------------------------------------------------------------------------------------
export function decisionLine(ev, at, runId) {
  const result = ev.noReply ? 'no-reply' : RESULT[ev.outcome];
  return `${at} ${SERVICE} decision step=${lineValue(ev.step)} layer=${lineValue(ev.layer, 12)} actor=${field(ev.who)} result=${result} cause=${lineValue(ev.cause)} run=${lineValue(runId)}`;
}

// ---- The run log: bounded, per mode and kind ----------------------------------------------------------------------------------------------------------
// A run is stored BEFORE its lines are written, so a writer that throws leaves it reachable; each line is written in its own try, so one failed write drops one line. The mode is
// stored on the run: Mock runs come from the simulation, Real runs from the gateway, and the route answers a run only in the mode it was made in.
export function createRunLog({ write = (line) => process.stdout.write(`${line}\n`), clock = Date.now } = {}) {
  const part = crypto.randomBytes(3).toString('hex'); // so an id never repeats after a restart or in another process
  let made = 0;
  const kept = { mock: { list: [], call: [] }, real: { list: [], call: [] } };
  const newId = (kind) => `${kind}-${part}-${++made}`;
  const keep = (run) => kept[run.source][run.kind].push(run);
  // Closed runs beyond the cap go, oldest first. A run still being made (a Real call is in flight) is never evicted.
  const prune = (run) => {
    const list = kept[run.source][run.kind];
    for (let i = 0; i < list.length && list.filter((r) => !r.open).length > KEEP_RUNS;) { if (list[i].open) i += 1; else list.splice(i, 1); }
  };
  const line = (ev, at, id) => safely('line', () => write(decisionLine(ev, at, id)));
  const NONE = { id: null, step: (_name, fn) => fn(), skipped() {}, end() {} };

  return {
    // Mock: the steps of one request, stamped once when the simulation had answered. `build` may throw: then nothing is stored and the answer is the baseline's.
    mock(kind, build) {
      return safely('mock-run', () => {
        const events = build();
        const at = iso(clock());
        const run = { id: newId(kind), kind, source: 'mock', startedAt: at, endedAt: at, events: events.map((e, seq) => ({ ...e, at, seq })), notes: [], partial: false, open: false };
        keep(run); prune(run);
        for (const ev of run.events) line(ev, at, run.id);
        return run.id;
      }) ?? null;
    },
    // Real: one run per request to the gateway. step() asks, stamps the reply with the time the lab HAD it (the start plus the call's own ms: the helper that asks also
    // closes the session afterwards, which can take seconds and is no part of the reply), writes its line and keeps the event. end() closes the run.
    begin(kind, caller, app) {
      return safely('begin', () => {
        const run = { id: newId(kind), kind, source: 'real', caller, app, startedAt: iso(clock()), endedAt: null, events: [], notes: [], partial: false, open: true };
        keep(run);
        let last = run.startedAt;
        const reply = (name, started, out) => {
          const at = iso(started + (Number.isFinite(out?.ms) && out.ms >= 0 ? out.ms : 0));
          if (at > last) last = at;
          const r = replyOf(name, out, run.app);
          const step = name === 'tools/list' ? 'gateway-list' : 'gateway-call';
          if (!r) {
            // The shared client's "unreachable" and "timed out" words are the only sign of no connection, so a gateway refusal that used those exact words reads the same way.
            run.partial = true;
            run.notes.push(`The ${name === 'tools/list' ? 'tools/list call' : 'tools/call'} got no reply (it did not connect, or it timed out), so it has no row. The lab reads a failure carrying exactly the shared client's "unreachable" or "timed out" words as no connection; a gateway refusal that used those exact words could, in rare cases, be read this way. It is never shown as allowed.`);
            line({ step, layer: 'gateway', who: run.caller, noReply: true, cause: 'no-reply' }, at, run.id);
            return;
          }
          const ev = { ...r, at, layer: 'gateway', product: GATEWAY_PRODUCT, step, who: run.caller, seq: run.events.length };
          run.events.push(ev);
          line(ev, at, run.id);
        };
        const handle = {
          id: run.id,
          async step(name, fn) {
            const started = clock();
            let out;
            try { out = await fn(); } catch (err) { handle.end(); throw err; }
            safely('reply', () => reply(name, started, out));
            return out;
          },
          skipped(note) { run.partial = true; run.notes.push(note); },
          end() { safely('end', () => { if (run.open) { run.open = false; run.endedAt = last; prune(run); } }); },
        };
        return handle;
      }) ?? NONE;
    },
    get(id) {
      for (const byKind of Object.values(kept)) for (const list of Object.values(byKind)) { const r = list.find((x) => x.id === id); if (r) return r; }
      return null;
    },
    clear() { for (const byKind of Object.values(kept)) for (const list of Object.values(byKind)) list.length = 0; },
  };
}
export const runField = (id) => (id ? { run: { id } } : { run: null, runNote: RECORDER_DOWN });
export const NO_RUN = Object.freeze({ run: null, runNote: NO_RUN_BEGAN });

// ---- The record ----------------------------------------------------------------------------------------------------------------------------------------
// The collector wants a reason for every layer. In Mock every run has an agent row and a gateway row, so those two reasons are never shown; the other four are.
const WHY_MOCK = {
  person: 'This lab has no sign-in and no person: the caller is an agent the simulation names, and it takes no key.',
  agent: 'No caller asked anything.',
  authorize: 'This lab does not call PingOne Authorize.',
  privilege: 'The simulated policy was not consulted: the call was stopped before any policy check ran (a name no member has, or a member the configuration marks unreachable or needing the caller\'s own sign-in).',
  gateway: 'The simulated aggregate sent no answer.',
  resource: 'The simulation has no member server and nothing is run. A row appears only when the configuration marks a member unreachable or needing the caller\'s own sign-in; a member that is reachable and signed in leaves none.',
};
const WHY_REAL = {
  person: 'The lab calls the gateway with an agent access key, not as a person, and it has no sign-in. Nothing here is a person\'s sign-in.',
  agent: 'The caller is an agent access key (a non-human identity), not an OBO token. The gateway\'s own log of that key is not read by this lab.',
  authorize: 'This lab does not call PingOne Authorize.',
  privilege: 'Privilege\'s policy log (its SIEM index and console activity log) is not read by this lab, and the gateway reports no per-check detail. Which check a refusal matches is the lab\'s own reading, in the words of the gateway row.',
  gateway: 'The lab received no reply from the gateway.',
  resource: 'The member MCP servers behind the aggregate wrote no log this lab can read.',
};

// Ties (a simulated request answers in one instant) are put back in the order the steps were written; ids are renumbered to match.
function inEventOrder(rec) {
  const stamped = rec.rows.filter((r) => r.at !== null).sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.detail.eventSeq - b.detail.eventSeq);
  return { ...rec, rows: [...stamped.map((r, i) => ({ ...r, id: `r${i + 1}` })), ...rec.rows.filter((r) => r.at === null)] };
}

// The record of one stored run, built from its stored events alone. No correlation is declared: this lab reads no logs, so there is nothing to match, and a declared id
// would only shorten a name in the lines and rows.
export async function recordOf(run, { clock = Date.now } = {}) {
  const mock = run.source === 'mock';
  const why = mock ? WHY_MOCK : WHY_REAL;
  const note = run.notes.join(' ');
  const rec = await createRunObservability({ clock }).collectRun({
    runId: run.id, startedAt: run.startedAt, endedAt: run.endedAt ?? run.startedAt, source: run.source,
    layers: LAYERS.map((layer) => {
      const own = run.events.filter((e) => e.layer === layer).map((e) => ({ at: e.at, product: e.product, outcome: e.outcome, message: e.message, detail: { ...e.detail, eventSeq: e.seq } }));
      return { layer, products: [], reason: layer === 'gateway' && note ? note : why[layer], ...(mock ? { simulated: own } : { responses: own }) };
    }),
  });
  const out = inEventOrder(rec);
  // A layer that has rows shows no reason of its own, so a call that got no reply or was not sent is named here.
  if (note && run.events.length) out.reasons = { ...out.reasons, gateway: note };
  return out;
}
