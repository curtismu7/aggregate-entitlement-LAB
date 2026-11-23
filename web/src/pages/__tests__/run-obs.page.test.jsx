import React from "react";
import { cleanup, configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App.jsx";
import { setJsonView } from "../../components/JsonPane.jsx";
import { gatewayOrigin, mockServer, routeGatewayTo } from "../../testUtil.js";
import { mockRecord, realRecord } from "../../run-observability/fixtures.js";

// Every render of the wrapper is recorded (the real wrapper still renders), so a test can say what the panel was asked to show in each one, not only after the dust settled.
const renders = vi.hoisted(() => []);
vi.mock("../../components/RunObs.jsx", async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, default: (props) => { renders.push({ runId: props.head?.runId, loading: props.loading === true, source: props.source }); return mod.default(props); } };
});

// Rule 27 on the page: "What each layer logged for this run". Mock runs against the real simulated engine (the record is the one the server built from the steps the
// simulation computed); Real is faked at the route. What the server puts in a record is tested in server/test/runObs.test.js.
beforeEach(() => { window.location.hash = ""; setJsonView("raw"); try { localStorage.clear(); } catch { /* none */ } });
afterEach(cleanup);
configure({ asyncUtilTimeout: 8000 });
vi.setConfig({ testTimeout: 30000 });

async function openPage(user) {
  render(<App />);
  await user.click(await screen.findByRole("link", { name: "Entitled listing" }));
}
const panel = () => screen.getByTestId("run-observability");
// The panel is re-queried every time: a node captured from an earlier render is detached after the swap.
// The rows of events (a layer with none shows a placeholder row tagged not-logged, which is no event).
const rowsOf = () => within(screen.getByTestId("ro-table")).getAllByRole("row").filter((r) => r.hasAttribute("data-layer") && r.getAttribute("data-origin") !== "not-logged")
  .map((r) => ({ layer: r.getAttribute("data-layer"), outcome: r.getAttribute("data-outcome"), text: r.textContent }));
async function callTool(user, name) {
  await user.clear(screen.getByLabelText("Tool name"));
  await user.type(screen.getByLabelText("Tool name"), name);
  await waitFor(() => expect(screen.getByRole("button", { name: "Call" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "Call" }));
}

describe("Mock: against the real simulated engine", () => {
  beforeEach(() => { mockServer(); routeGatewayTo(gatewayOrigin()); });

  it("shows the listing's record as soon as the page loads, the call's after a call, and the listing's again when the caller changes", async () => {
    const user = userEvent.setup();
    await openPage(user);
    await waitFor(() => expect(screen.getByTestId("run-observability")).toHaveTextContent(/asked tools\/list/));
    await waitFor(() => expect(rowsOf().map((r) => [r.layer, r.outcome])).toEqual([["agent", "info"], ["privilege", "info"], ["gateway", "allowed"]]));
    expect(screen.getByTestId("ro-basis")).toHaveTextContent(/None of them was read from a product log/);
    expect(screen.getByTestId("ro-lab-note")).toHaveTextContent(/The scan and the demo audit view are not gateway requests/);
    // a hidden name is refused: the Privilege row is the decision, and the Agent gateway row repeats it as information
    await callTool(user, "crm__export_all");
    await waitFor(() => expect(panel()).toHaveTextContent(/asked tools\/call for crm__export_all/));
    await waitFor(() => expect(rowsOf().map((r) => [r.layer, r.outcome])).toEqual([["agent", "info"], ["privilege", "refused"], ["gateway", "info"]]));
    expect(screen.getByTestId("ro-summary")).toHaveTextContent(/1 refused/);
    // an allowed name passes the entry and the member hop
    await callTool(user, "crm__update_customer");
    await waitFor(() => expect(rowsOf().map((r) => [r.layer, r.outcome])).toEqual([["agent", "info"], ["privilege", "allowed"], ["privilege", "allowed"], ["gateway", "info"]]));
    // a changed caller clears the call, and the panel is the new listing's
    await user.selectOptions(screen.getByLabelText("Caller"), "guest");
    await waitFor(() => expect(panel()).toHaveTextContent(/Guest asked tools\/list/));
    expect(panel()).not.toHaveTextContent(/tools\/call/);
  });

  it("never shows the previous record while the next listing is out: a listing delayed 2.5 s after a call shows the loading note for the whole wait", async () => {
    const user = userEvent.setup();
    await openPage(user);
    await waitFor(() => expect(rowsOf()).toHaveLength(3));
    await callTool(user, "crm__export_all");
    await waitFor(() => expect(panel()).toHaveTextContent(/asked tools\/call/));
    const inner = globalThis.fetch;
    let release;
    const hold = new Promise((r) => { release = r; });
    globalThis.fetch = vi.fn(async (u, init) => { if (String(u) === "/api/gateway/list" && "view" in JSON.parse(init.body)) await hold; return inner(u, init); });
    await user.selectOptions(screen.getByLabelText("Caller"), "analyst");
    await waitFor(() => expect(screen.getByTestId("ro-loading")).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 2500));
    expect(screen.getByTestId("ro-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("run-observability")).toBeNull();
    release();
    await waitFor(() => expect(panel()).toHaveTextContent(/Analyst asked tools\/list/));
    expect(panel()).not.toHaveTextContent(/tools\/call/);
  }, 30000);

  it("not even for one render: after the caller changes, no render is asked to show a run that was asked for before", async () => {
    const user = userEvent.setup();
    await openPage(user);
    await waitFor(() => expect(rowsOf()).toHaveLength(3));
    await callTool(user, "crm__export_all");
    await waitFor(() => expect(panel()).toHaveTextContent(/asked tools\/call/));
    const before = new Set(renders.map((r) => r.runId).filter(Boolean));
    const mark = renders.length;
    await user.selectOptions(screen.getByLabelText("Caller"), "analyst");
    await waitFor(() => expect(panel()).toHaveTextContent(/Analyst asked tools\/list/));
    const shown = renders.slice(mark).filter((r) => !r.loading && r.runId);
    expect(shown.length).toBeGreaterThan(0);
    for (const r of shown) expect(before.has(r.runId), `a render asked for ${r.runId}, which was asked for before the change`).toBe(false);
  });

  it("a call still out: the panel shows the loading note, not the call before it, until the answer is in", async () => {
    const user = userEvent.setup();
    await openPage(user);
    await waitFor(() => expect(rowsOf()).toHaveLength(3));
    await callTool(user, "crm__export_all");
    await waitFor(() => expect(panel()).toHaveTextContent(/asked tools\/call for crm__export_all/));
    const inner = globalThis.fetch;
    let release;
    const hold = new Promise((r) => { release = r; });
    globalThis.fetch = vi.fn(async (u, init) => { if (String(u) === "/api/gateway/call") await hold; return inner(u, init); });
    await callTool(user, "crm__update_customer");
    await waitFor(() => expect(screen.getByTestId("ro-loading")).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 2500));
    expect(screen.getByTestId("ro-loading")).toBeInTheDocument();
    expect(screen.queryByText(/crm__export_all/, { selector: "td" })).toBeNull();
    release();
    await waitFor(() => expect(panel()).toHaveTextContent(/asked tools\/call for crm__update_customer/));
  }, 30000);

  it("a call the lab did not accept began no run: the panel says so and shows no older record", async () => {
    const user = userEvent.setup();
    await openPage(user);
    await waitFor(() => expect(rowsOf()).toHaveLength(3));
    await callTool(user, "not a tool name");
    await waitFor(() => expect(screen.getByTestId("ro-no-run")).toHaveTextContent(/This request began no run, so nothing was recorded\./));
    expect(screen.queryByTestId("run-observability")).toBeNull();
    expect(screen.getByTestId("call-result")).toHaveTextContent(/Refused \(400\)/);
  });

  it.each([
    ["an HTML page with status 200", () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("<html>"); } })],
    ["null", () => ({ ok: true, status: 200, json: async () => null })],
    ["an empty body", () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected end of JSON input"); } })],
    ["an array", () => ({ ok: true, status: 200, json: async () => [] })],
    ["a JSON string", () => ({ ok: true, status: 200, json: async () => "ok" })],
    ["an empty object", () => ({ ok: true, status: 200, json: async () => ({}) })],
    ["a server error with no run field", () => ({ ok: false, status: 500, json: async () => ({ error: "server_error" }) })],
  ])("a call answered with %s is an alert in the panel, never a stuck loading note and never the listing's record", async (_name, answer) => {
    const user = userEvent.setup();
    await openPage(user);
    await waitFor(() => expect(rowsOf()).toHaveLength(3));
    const inner = globalThis.fetch;
    globalThis.fetch = vi.fn(async (u, init) => (String(u) === "/api/gateway/call" ? answer() : inner(u, init)));
    await callTool(user, "crm__export_all");
    await waitFor(() => expect(screen.getByTestId("ro-bad")).toBeInTheDocument());
    expect(within(screen.getByTestId("ro-bad")).getByRole("alert")).toHaveTextContent(/did not say which run it was/);
    expect(screen.queryByTestId("ro-loading")).toBeNull();
    expect(screen.queryByTestId("run-observability")).toBeNull();
  });

  it("a listing the lab could not answer, or that never arrived, is an alert in the panel and the page is not stuck busy", async () => {
    const user = userEvent.setup();
    render(<App />);
    const inner = globalThis.fetch;
    // Only the page's own listing is lost: the diagram below it asks for a listing too (a body with no `view`), and its own handling of a lost one is not under test.
    globalThis.fetch = vi.fn(async (u, init) => { if (String(u) === "/api/gateway/list" && "view" in JSON.parse(init.body)) throw new TypeError("Failed to fetch"); return inner(u, init); });
    await user.click(await screen.findByRole("link", { name: "Entitled listing" }));
    await waitFor(() => expect(screen.getByTestId("ro-bad")).toBeInTheDocument());
    expect(within(screen.getByTestId("ro-bad")).getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("The simulated gateway did not answer.")).toBeInTheDocument();
    expect(screen.queryByTestId("ro-loading")).toBeNull();
  });
});

describe("Real: faked at the route", () => {
  const rec = (runId, text) => ({ ...realRecord, runId, source: "real", rows: realRecord.rows.map((r) => (r.layer === "gateway" ? { ...r, message: text } : r)) });
  const routes = (extra = {}) => ({
    "GET /api/info": () => ({ source: "real", realAvailable: true, realReason: null }),
    "GET /api/gateway/real": () => ({ available: true, mode: "real", apps: ["full", "limited"], callers: [{ id: "analyst", label: "Analyst" }], reading: "Which check a refusal matches is our reading." }),
    "POST /api/gateway/real/list": (b) => ({ app: b.app, caller: b.caller, ok: true, tools: [{ name: "crm__find", description: "f" }], ms: 3, run: { id: b.app === "full" ? "list-bbbbbb-1" : "list-bbbbbb-2" } }),
    "POST /api/gateway/real/call": (b) => ({ app: b.app, caller: b.caller, tool: b.tool, ok: false, refusal: { status: null, message: "x", layer: "tool-filter" }, ms: 5, run: { id: "call-bbbbbb-3" } }),
    "GET /api/gateway/run?runId=list-bbbbbb-1": () => ({ record: rec("list-bbbbbb-1", "LISTING OF FULL"), partial: false, notes: [] }),
    "GET /api/gateway/run?runId=list-bbbbbb-2": () => ({ record: rec("list-bbbbbb-2", "LISTING OF LIMITED"), partial: false, notes: [] }),
    "GET /api/gateway/run?runId=call-bbbbbb-3": () => ({ record: rec("call-bbbbbb-3", "CALL ON FULL"), partial: true, notes: ["The tools/call got no reply."] }),
    ...extra,
  });

  it("shows the selected app's listing, then the hidden-name call's record, then the other app's listing; a partial call says so; there is no re-read control", async () => {
    mockServer(routes());
    const user = userEvent.setup();
    await openPage(user);
    await waitFor(() => expect(panel()).toHaveTextContent("LISTING OF FULL"));
    expect(screen.getByTestId("ro-lab-note")).toHaveTextContent(/Real is only what the lab received from your gateway/);
    expect(screen.queryByRole("button", { name: /re-read/i })).toBeNull();
    await user.type(screen.getByLabelText("Tool name"), "crm__export");
    await user.click(screen.getByRole("checkbox", { name: /Send a real tools\/call/ }));
    await user.click(screen.getByRole("button", { name: "Call" }));
    await waitFor(() => expect(panel()).toHaveTextContent("CALL ON FULL"));
    expect(screen.getByTestId("ro-partial")).toHaveTextContent(/This record is partial\. The tools\/call got no reply\./);
    await user.click(screen.getByRole("radio", { name: /limited/ }));
    await waitFor(() => expect(panel()).toHaveTextContent("LISTING OF LIMITED"));
    expect(screen.queryByTestId("ro-partial")).toBeNull();
  });

  it("a listing the server refused before it began a run carries the server's note, and a call answer that did not say its run is an alert", async () => {
    mockServer(routes({
      "POST /api/gateway/real/list": (b) => (b.app === "full" ? { __status: 409, body: { error: "mock_mode", message: "Switch the header to Real.", run: null, runNote: "This request began no run, so nothing was recorded." } } : { app: b.app, ok: true, tools: [], ms: 1, run: { id: "list-bbbbbb-2" } }),
      "POST /api/gateway/real/call": () => ({ __status: 500, body: { error: "server_error" } }),
    }));
    const user = userEvent.setup();
    await openPage(user);
    await waitFor(() => expect(screen.getByTestId("ro-no-run")).toHaveTextContent(/began no run/));
    expect(screen.queryByTestId("run-observability")).toBeNull();
    await user.type(screen.getByLabelText("Tool name"), "crm__export");
    await user.click(screen.getByRole("checkbox", { name: /Send a real tools\/call/ }));
    await user.click(screen.getByRole("button", { name: "Call" }));
    await waitFor(() => expect(within(screen.getByTestId("ro-bad")).getByRole("alert")).toHaveTextContent(/did not say which run it was/));
  });

  it("a call still out: the loading note, not the listing before it, until the answer is in", async () => {
    mockServer(routes());
    const inner = globalThis.fetch;
    let release;
    const hold = new Promise((r) => { release = r; });
    globalThis.fetch = vi.fn(async (u, init) => { if (String(u) === "/api/gateway/real/call") await hold; return inner(u, init); });
    const user = userEvent.setup();
    await openPage(user);
    await waitFor(() => expect(panel()).toHaveTextContent("LISTING OF FULL"));
    await user.type(screen.getByLabelText("Tool name"), "crm__export");
    await user.click(screen.getByRole("checkbox", { name: /Send a real tools\/call/ }));
    await user.click(screen.getByRole("button", { name: "Call" }));
    await waitFor(() => expect(screen.getByTestId("ro-loading")).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 2500));
    expect(screen.getByTestId("ro-loading")).toBeInTheDocument();
    expect(screen.queryByText("LISTING OF FULL")).toBeNull();
    release();
    await waitFor(() => expect(panel()).toHaveTextContent("CALL ON FULL"));
  }, 30000);

  it("never shows the previous record while the call's record is out (delayed 2.5 s)", async () => {
    mockServer(routes());
    const inner = globalThis.fetch;
    let release;
    const hold = new Promise((r) => { release = r; });
    globalThis.fetch = vi.fn(async (u, init) => { if (String(u) === "/api/gateway/run?runId=call-bbbbbb-3") await hold; return inner(u, init); });
    const user = userEvent.setup();
    await openPage(user);
    await waitFor(() => expect(panel()).toHaveTextContent("LISTING OF FULL"));
    await user.type(screen.getByLabelText("Tool name"), "crm__export");
    await user.click(screen.getByRole("checkbox", { name: /Send a real tools\/call/ }));
    await user.click(screen.getByRole("button", { name: "Call" }));
    await waitFor(() => expect(screen.getByTestId("ro-loading")).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 2500));
    expect(screen.getByTestId("ro-loading")).toBeInTheDocument();
    expect(screen.queryByText("LISTING OF FULL")).toBeNull();
    release();
    await waitFor(() => expect(panel()).toHaveTextContent("CALL ON FULL"));
  }, 30000);
});
