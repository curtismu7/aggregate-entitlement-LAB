// Streamable HTTP MCP client. Adapted from AI-DEMO2 standalone/mcp-inspector server/lib/transports/http.js (MIT).
// Changes: ESM, fetch instead of axios (no request config object that can carry a secret into an error), one client
// per connection (the source keyed a global map by url+auth), redirects are refused (never forward an auth header),
// response size and time are capped, the reply is read until the matching JSON-RPC id arrives (SSE or JSON), and
// the client keeps the initialize result (capabilities, server info) for the scanner.
export const PROTOCOL_VERSION = '2025-06-18';
const MAX_BYTES = 4 * 1024 * 1024;

export function rpcError(message, code, extra = {}) { return Object.assign(new Error(String(message).slice(0, 300)), { code, ...extra }); }

// Messages in an SSE body: each event's data lines joined, parsed as JSON.
export function sseMessages(text) {
  const out = [];
  for (const ev of text.split(/\r?\n\r?\n/)) {
    const data = ev.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
    if (!data) continue;
    try { out.push(JSON.parse(data)); } catch { /* not JSON: ignore */ }
  }
  return out;
}

async function readReply(res, id) {
  const sse = /text\/event-stream/i.test(res.headers.get('content-type') || '');
  const reader = res.body?.getReader();
  if (!reader) return undefined;
  const dec = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > MAX_BYTES) throw rpcError(`reply larger than ${MAX_BYTES} bytes`, 'mcp_reply_too_large');
      text += dec.decode(value, { stream: true });
      if (sse && sseMessages(text).some((m) => m && m.id === id)) break; // a stream that stays open is not waited on
    }
  } finally { reader.cancel().catch(() => {}); }
  text = text.trim();
  if (!text) return undefined;
  if (sse) { const msgs = sseMessages(text); return msgs.find((m) => m && m.id === id) ?? msgs.at(-1); }
  try { return JSON.parse(text); } catch { throw rpcError('reply is not JSON', 'mcp_bad_reply'); }
}

// Response headers worth showing in a trace (an allowlist: a cookie or anything else never reaches it).
const SHOWN_RESPONSE_HEADERS = ['content-type', 'mcp-session-id', 'www-authenticate', 'retry-after', 'x-request-id', 'request-id', 'x-correlation-id'];
const shownHeaders = (h) => Object.fromEntries(SHOWN_RESPONSE_HEADERS.filter((n) => h.get(n) !== null).map((n) => [n, h.get(n)]));
const asJson = (text) => { try { return JSON.parse(text); } catch { return text || null; } };

// `capture`: an optional array. When given, every exchange this client makes is pushed to it as it happens: the request
// as sent (the credential header is left out; the caller shows its own placeholder), the reply as received (the whole
// JSON-RPC message, not cut to the 300 characters an error message keeps), or the error if there was no reply.
export function createHttpClient({ url, getAuth, timeoutMs = 15_000, clientInfo = { name: 'aggregate-entitlement', version: '0.1.0' }, capture = null }) {
  const state = { sessionId: null, protocolVersion: null, initialized: false, pending: null, info: null };
  let msgId = 0;

  async function post(method, params, id) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    const auth = getAuth?.();
    if (auth) headers[auth[0]] = auth[1];
    if (state.sessionId) headers['Mcp-Session-Id'] = state.sessionId;
    if (method !== 'initialize') headers['MCP-Protocol-Version'] = state.protocolVersion || PROTOCOL_VERSION;
    const message = id === undefined ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params };
    const rec = capture && {
      rpcMethod: method, http: 'POST', url, at: new Date().toISOString(),
      request: { headers: Object.fromEntries(Object.entries(headers).filter(([k]) => k !== auth?.[0]).map(([k, v]) => [k.toLowerCase(), v])), body: message },
      response: null, error: null, sse: false,
    };
    if (rec) capture.push(rec);
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), body: JSON.stringify(message) });
    } catch (err) {
      if (rec) rec.error = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? `no answer within ${timeoutMs}ms` : `could not connect (${err?.cause?.code || err?.code || 'network error'})`;
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw rpcError(`MCP HTTP request timed out after ${timeoutMs}ms`, 'mcp_timeout');
      throw rpcError(`MCP HTTP request unreachable (${err?.cause?.code || err?.code || 'network error'})`, 'mcp_unreachable');
    }
    if (rec) rec.response = { status: res.status, headers: shownHeaders(res.headers), body: null };
    if (res.status >= 300 && res.status < 400) { res.body?.cancel().catch(() => {}); throw rpcError(`MCP HTTP ${res.status}: redirects are not followed`, 'mcp_http_error', { httpStatus: res.status }); }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (rec) rec.response.body = asJson(text);
      const body = text.slice(0, 300);
      throw rpcError(`MCP HTTP ${res.status}${body ? `: ${body}` : ''}`, 'mcp_http_error', { httpStatus: res.status });
    }
    const sid = res.headers.get('mcp-session-id');
    if (sid) state.sessionId = sid;
    let json;
    try {
      json = id === undefined ? (res.body?.cancel().catch(() => {}), undefined) : await readReply(res, id);
    } catch (err) { if (rec) rec.error = err.message; throw err; }
    if (rec) { rec.response.body = json ?? null; rec.sse = /text\/event-stream/i.test(res.headers.get('content-type') || ''); }
    if (json?.error) throw rpcError(json.error.message || 'MCP JSON-RPC error', 'mcp_rpc_error', { mcpCode: json.error.code });
    return json?.result;
  }

  async function handshake() {
    const result = await post('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo }, ++msgId);
    state.protocolVersion = result?.protocolVersion || PROTOCOL_VERSION;
    state.info = { protocolVersion: state.protocolVersion, serverInfo: result?.serverInfo || null, capabilities: result?.capabilities || {} };
    await post('notifications/initialized', {});
    state.initialized = true;
  }
  const ensure = () => {
    if (state.initialized) return Promise.resolve();
    state.pending ||= handshake().finally(() => { state.pending = null; });
    return state.pending;
  };

  async function rpc(method, params = {}) {
    await ensure();
    try { return await post(method, params, ++msgId); } catch (err) {
      // The spec's "session not found" signal: start a new session once and retry.
      if (err.httpStatus === 404 && state.sessionId) {
        state.initialized = false; state.sessionId = null;
        await ensure();
        return post(method, params, ++msgId);
      }
      throw err;
    }
  }

  return {
    ensure, rpc,
    info: () => state.info,
    async close() {
      if (!state.sessionId) return;
      const headers = { 'Mcp-Session-Id': state.sessionId };
      const auth = getAuth?.();
      if (auth) headers[auth[0]] = auth[1];
      const sent = { ...headers };
      const res = await fetch(url, { method: 'DELETE', headers, redirect: 'manual', signal: AbortSignal.timeout(3000) }).catch(() => null);
      if (capture) capture.push({ rpcMethod: 'close session', http: 'DELETE', url, at: new Date().toISOString(), request: { headers: Object.fromEntries(Object.entries(sent).filter(([k]) => k !== auth?.[0]).map(([k, v]) => [k.toLowerCase(), v])), body: null }, response: res ? { status: res.status, headers: shownHeaders(res.headers), body: null } : null, error: res ? null : 'no answer', sse: false });
      res?.body?.cancel().catch(() => {});
      state.sessionId = null; state.initialized = false;
    },
  };
}
