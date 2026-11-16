// "What Privilege did" for this lab (rule 25): turns one gateway call into the record GatewayTrace.jsx draws, using the shared builder
// server/src/gatewayTrace.js (vendored byte for byte, never edited; there is no server/src/trace.js here and this file does not use that name).
//
// This lab has TWO gateways, and the honesty rule is different for each:
//   MOCK (sim.js): the lab's own simulated gateway computed every check, so each decision is `checked`, in the order sim.js ran them.
//   The request is a synthetic JSON-RPC message to a `.invalid` host and the reply is exactly what the simulation returned. No socket is opened.
//   REAL (real.js through mcp/http.js): the lab's own MCP client called the operator's gateway; `capture` kept the exchanges. A real gateway
//   reports no per-check detail, so the shared builder (traceFromDoor) makes every decision `inferred` or `observed`, never `checked`.
//
// What a trace never holds: the agent key (only its length), the full MCP session id (shortened), and any key a gateway message echoed back
// (every string is scrubbed of every configured key).
import { audit, LAYERS, REFUSAL } from './sim.js';
import { bearerForDisplay, mockTrace, traceFromDoor } from '../gatewayTrace.js';
import { scrubJson } from '../redact.js';

// ---- Mock -----------------------------------------------------------------------------------------------------------------------------
const MOCK_HOST = 'https://gateway.aggregate-lab.invalid';
// The six checks of the page, numbered as it numbers them (check 1 is "the tool exists": see the call trace).
const CHECK = {
  unreachable: 'The member is reachable',
  'upstream-sign-in': 'The caller has signed in to the member',
  'tool-filter': "The aggregate's ToolFilter exposes it",
  'member-policy': "The member's own policy allows this caller",
  'aggregate-cap': 'The aggregate policy cap allows it',
};
const label = (layer) => `Check ${LAYERS.indexOf(layer) + 2}: ${CHECK[layer]}`;
// Layers a path runs, in order: through the aggregate all five; a member used directly runs only its own three (sim.js directLayer).
const PATH = { aggregate: LAYERS, direct: ['unreachable', 'upstream-sign-in', 'member-policy'] };
const urlOf = (view, member) => `${MOCK_HOST}/${view === 'direct' ? member.alias : 'aggregate'}/mcp`;
const authOf = (caller) => `Bearer <simulated: this lab takes no key, caller ${caller.id}>`;
const rpcOf = (id, method, params) => ({ jsonrpc: '2.0', id, method, params });

// Not on the path: the simulation never runs it.
const skipped = (layer) => ({ id: `check-${layer}`, label: label(layer), outcome: 'skipped', evidence: 'not run: a member used directly follows its own policy only, with no ToolFilter and no aggregate cap' });

/**
 * tools/list through the simulation. cfg is the normalised config, caller and member are the config's own objects, `listed` is what
 * listAggregate / listMember returned (the reply body, shown as returned).
 * Each decision is a check the simulation ran over every tool: `pass` when it removed none, `info` when it removed some (a check that
 * hides a tool did its job, which is not a refusal), `skipped` when no tool got that far.
 */
export function mockListTrace({ cfg, caller, view, member, listed }) {
  const rows = audit(cfg, caller.id, view === 'direct' ? member : null);
  const path = PATH[view];
  const decisions = LAYERS.map((layer) => {
    const at = path.indexOf(layer);
    if (at < 0) return skipped(layer);
    const reached = rows.filter((r) => !r.layer || path.indexOf(r.layer) >= at);
    const stopped = rows.filter((r) => r.layer === layer);
    if (reached.length === 0) return { id: `check-${layer}`, label: label(layer), outcome: 'skipped', evidence: 'no tool reached this check: every tool was stopped by an earlier one' };
    return {
      id: `check-${layer}`, label: label(layer),
      outcome: stopped.length ? 'info' : 'pass',
      evidence: `${reached.length} of ${rows.length} tool${rows.length === 1 ? '' : 's'} reached this check; ${stopped.length ? `it removed ${stopped.length} from the list (${stopped.map((r) => r.name).join(', ')}). Demo only: a caller is never told what was removed` : 'it removed none'}`,
    };
  });
  return mockTrace({
    url: urlOf(view, member), authorization: authOf(caller), rpc: rpcOf(1, 'tools/list', {}),
    status: 200, body: { tools: listed.tools, members: listed.members }, decisions,
  });
}

/**
 * tools/call through the simulation. `out` is what callAggregate / callMember returned: out.trace holds its steps
 * ({ stage, layer, decision }) and the reply body is what the route sends the caller.
 * The decisions follow the steps: through the aggregate, check 1 and the five layers at the entry, then the member hop; used directly,
 * the member's own checks. Anything after the first refusal was never run, so it is `skipped`.
 */
export function mockCallTrace({ caller, view, member, tool, args = {}, out }) {
  const steps = out.trace;
  const decisions = [];
  const first = steps[0];
  const refusedAt = (s) => (s.decision === 'refused' ? s.layer : null);
  if (view === 'aggregate') {
    const entry = refusedAt(first);
    decisions.push(entry === 'unknown'
      ? { id: 'check-unknown', label: 'Check 1: The tool exists', outcome: 'fail', evidence: `no member has a tool named ${tool}` }
      : { id: 'check-unknown', label: 'Check 1: The tool exists', outcome: 'pass', evidence: `${tool} is a tool of a member` });
    for (const layer of LAYERS) {
      const stopped = entry === layer;
      const reached = entry === null || entry === 'unknown' ? entry === null : LAYERS.indexOf(layer) <= LAYERS.indexOf(entry);
      decisions.push({ id: `check-${layer}`, label: label(layer), outcome: stopped ? 'fail' : reached ? 'pass' : 'skipped', evidence: stopped ? 'this check stopped the call at the entry' : reached ? 'passed at the entry' : 'not run: an earlier check had already stopped the call' });
    }
    const hop = steps[1];
    decisions.push(hop
      ? { id: 'hop', label: 'Member hop: reachable, member policy and aggregate cap again', outcome: hop.decision === 'refused' ? 'fail' : 'pass', evidence: hop.decision === 'refused' ? `stopped at the member hop by ${label(hop.layer).toLowerCase()}` : 'the cap and the member policy were checked again with the tool\'s own name, and passed' }
      : { id: 'hop', label: 'Member hop: reachable, member policy and aggregate cap again', outcome: 'skipped', evidence: 'not run: the entry had already stopped the call' });
  } else {
    const layer = refusedAt(first);
    decisions.push(layer === 'unknown'
      ? { id: 'check-unknown', label: 'The tool exists on this member', outcome: 'fail', evidence: `${member.alias} has no tool named ${tool}` }
      : { id: 'check-unknown', label: 'The tool exists on this member', outcome: 'pass', evidence: `${tool} is a tool of ${member.alias}` });
    for (const l of LAYERS) {
      if (PATH.direct.indexOf(l) < 0) { decisions.push(skipped(l)); continue; }
      const stopped = layer === l;
      const reached = layer === null || (layer !== 'unknown' && PATH.direct.indexOf(l) <= PATH.direct.indexOf(layer));
      decisions.push({ id: `check-${l}`, label: label(l), outcome: stopped ? 'fail' : reached ? 'pass' : 'skipped', evidence: stopped ? 'this check stopped the call' : reached ? 'passed' : 'not run: an earlier check had already stopped the call' });
    }
  }
  const ok = out.ok === true;
  return mockTrace({
    url: urlOf(view, member), authorization: authOf(caller), rpc: rpcOf(2, 'tools/call', { name: tool, arguments: args }),
    status: ok ? 200 : 403,
    body: ok ? { result: out.result } : { error: out.error, message: out.message ?? REFUSAL },
    decisions,
  });
}

// ---- Real -----------------------------------------------------------------------------------------------------------------------------
// A session id is shown shortened, never whole.
const shortSession = (v) => (String(v).length > 8 ? `${String(v).slice(0, 6)}… (shortened)` : '<session id>');
const shorten = (headers = {}) => (headers['mcp-session-id'] === undefined ? headers : { ...headers, 'mcp-session-id': shortSession(headers['mcp-session-id']) });

/**
 * capture: the exchanges createHttpClient({ capture }) pushed, after the session was closed. rpcMethod: 'tools/list' or 'tools/call'.
 * key: the agent key sent (shown only as its length). secrets: every configured key, scrubbed from every string. result: what real.js
 * returned ({ ok, refusal }), so a refusal's own (scrubbed) message is the detail of a 403.
 */
export function realTraceOf(capture, { rpcMethod, key, secrets, result }) {
  const authorization = bearerForDisplay('<agent key>', () => key);
  const sessions = [];
  const wire = capture.map((w) => {
    for (const h of [w.request.headers, w.response?.headers]) if (h?.['mcp-session-id']) sessions.push(h['mcp-session-id']);
    return {
      ...w,
      request: { ...w.request, headers: { authorization, ...shorten(w.request.headers) } },
      response: w.response ? { ...w.response, headers: shorten(w.response.headers) } : null,
    };
  });
  const trace = traceFromDoor({ wire, ok: result.ok, refusal: result.refusal }, { rpcMethod });
  const primary = [...wire].reverse().find((w) => w.rpcMethod === rpcMethod) || [...wire].reverse().find((w) => w.http === 'POST');
  // The client reads an event stream until the reply to its request arrives, so the body shown is that one JSON-RPC message.
  if (primary?.sse && trace.response) trace.decisions.push({ id: 'reply-format', label: 'Reply format', outcome: 'info', basis: 'observed', evidence: 'the gateway answered with an event stream; the body shown is the JSON-RPC message in it that answers this request' });
  return scrubJson(trace, [...secrets, ...sessions]);
}
