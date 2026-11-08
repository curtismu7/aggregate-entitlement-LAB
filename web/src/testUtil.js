import { inject, vi } from "vitest";

const nodeFetch = globalThis.fetch;

// The page tests for the simulated gateway talk to the REAL engine, not to canned replies, so a number on the page is a
// number the engine produced. src/globalSetup.js starts the server (in plain Node, on a loopback test port) once per run
// and hands its origin to the tests. Everything else stays faked.
export const gatewayOrigin = () => inject("gatewayOrigin");
/** Call after mockServer(): sends /api/gateway/* to the real engine at `origin`, everything else to the fake. */
export function routeGatewayTo(origin) {
  const fake = globalThis.fetch;
  globalThis.fetch = vi.fn((url, init = {}) => (String(url).startsWith("/api/gateway/")
    ? nodeFetch(origin + url, { ...init, redirect: "error", headers: { ...(init.headers || {}), Origin: origin } })
    : fake(url, init)));
}

// A fake fetch for the page tests. `calls` records every request; `overrides` replace or add routes.
export let calls;
export function mockServer(overrides = {}) {
  calls = [];
  const routes = {
    "GET /api/info": () => ({ source: "mock", realAvailable: true, realReason: null }),
    "GET /api/rules": () => ({ limits: [{ id: "rug-pull", text: "Rug-pulls after the scan." }], rules: [{ id: "MT-HI-001", severity: "high", kind: "hidden-instruction", title: "Instruction tag" }] }),
    ...overrides,
  };
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const key = `${init.method || "GET"} ${url}`;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ key, body });
    const h = routes[key];
    if (!h) return { ok: false, status: 404, json: async () => ({ message: `no route ${key}` }) };
    const out = h(body);
    return out && out.__status ? { ok: false, status: out.__status, json: async () => out.body } : { ok: true, status: 200, json: async () => out };
  });
}
export const sent = (key) => calls.filter((c) => c.key === key);
