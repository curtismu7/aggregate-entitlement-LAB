import React from "react";
import { cleanup, configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App.jsx";
import { setJsonView } from "../../components/JsonPane.jsx";
import { gatewayOrigin, mockServer, routeGatewayTo } from "../../testUtil.js";
import { realTrace } from "../../../../server/src/gatewayTrace.js";

// "What Privilege did" (rule 25) on the page. Mock runs against the real simulated engine (the trace is the one the server built);
// Real is faked at the route, with a trace the shared builder made, so only the wiring is tested here (server/test/gateway-trace.test.js
// covers what the server puts in a trace).
beforeEach(() => { window.location.hash = ""; setJsonView("raw"); try { localStorage.clear(); } catch { /* none */ } });
afterEach(cleanup);
configure({ asyncUtilTimeout: 8000 });
vi.setConfig({ testTimeout: 30000 }); // each test drives the page against a real engine on a possibly loaded machine

async function openPage(user) {
  render(<App />);
  await user.click(await screen.findByRole("link", { name: "Entitled listing" }));
}

describe("What Privilege did: Mock", () => {
  beforeEach(() => { mockServer(); routeGatewayTo(gatewayOrigin()); });

  it("shows the listing as soon as the page loads, then the call, each with its request, its reply and its checks", async () => {
    const user = userEvent.setup();
    await openPage(user);
    const panel = await screen.findByTestId("gateway-trace");
    expect(within(panel).getByTestId("gateway-trace-basis")).toHaveTextContent(/Simulated: this lab's in-process gateway/);
    expect(within(panel).getByTestId("gateway-trace-basis")).toHaveTextContent(/UNVERIFIED on our tenant/);
    await waitFor(() => expect(screen.getByTestId("trace-1")).toBeInTheDocument());
    expect(screen.queryByTestId("trace-2")).toBeNull(); // no call yet
    expect(screen.getByTestId("trace-1-request-box")).toHaveTextContent(/POST https:\/\/gateway\.aggregate-lab\.invalid\/aggregate\/mcp/);
    expect(screen.getByTestId("trace-1-request-box")).toHaveTextContent(/"method": "tools\/list"/);
    expect(screen.getByTestId("trace-1-response-box")).toHaveTextContent(/HTTP 200/);

    await user.type(screen.getByLabelText("Tool name"), "crm__export_all");
    await user.click(screen.getByRole("button", { name: "Call" }));
    const two = await screen.findByTestId("trace-2");
    expect(two).toHaveTextContent("Gateway check: tools/call crm__export_all");
    expect(two).toHaveTextContent("HTTP 403");
    expect(two).toHaveTextContent(/refused at: Check \d: /);
    expect(screen.getByTestId("trace-2-request-box")).toHaveTextContent(/"name": "crm__export_all"/);
    expect(screen.getByTestId("trace-2-response-box")).toHaveTextContent("That tool is not available to this caller.");
    // every mock decision was computed by the simulation: none is marked inferred or observed
    const decisions = within(screen.getByTestId("trace-2-decisions"));
    expect(decisions.queryByText("inferred from the outcome")).toBeNull();
    expect(decisions.queryByText("observed in the response")).toBeNull();
  });

  it("an allowed call passes every check and its listing is replaced when the caller changes", async () => {
    const user = userEvent.setup();
    await openPage(user);
    await waitFor(() => expect(screen.getByTestId("trace-1")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Caller"), "operator");
    await user.type(screen.getByLabelText("Tool name"), "crm__update_customer");
    await user.click(screen.getByRole("button", { name: "Call" }));
    const two = await screen.findByTestId("trace-2");
    expect(two).toHaveTextContent("HTTP 200");
    expect(two).toHaveTextContent("all 7 decisions passed");
    await user.selectOptions(screen.getByLabelText("Caller"), "guest");
    await waitFor(() => expect(screen.queryByTestId("trace-2")).toBeNull()); // a changed caller clears the old call
    await waitFor(() => expect(screen.getByTestId("trace-1-request-box")).toHaveTextContent(/caller guest/));
  });
});

describe("What Privilege did: Real", () => {
  const url = "https://gw.example.invalid/full/mcp";
  const key = "Bearer <token, 24 characters, kept on the server>";
  const listTrace = (app, names) => realTrace({
    url: `https://gw.example.invalid/${app}/mcp`, authorization: key, rpc: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, status: 200,
    headers: { "content-type": "application/json" }, body: { jsonrpc: "2.0", id: 2, result: { tools: names.map((name) => ({ name })) } },
  });
  const callTrace = realTrace({
    url, authorization: key, rpc: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "crm__export", arguments: {} } }, status: 200,
    headers: { "content-type": "application/json" }, body: { jsonrpc: "2.0", id: 3, error: { code: -32600, message: "\"crm__export\" is not exposed by this aggregate" } },
  });
  beforeEach(() => {
    mockServer({
      "GET /api/info": () => ({ source: "real", realAvailable: true, realReason: null }),
      "GET /api/gateway/real": () => ({ available: true, mode: "real", apps: ["full", "limited"], callers: [{ id: "analyst", label: "Analyst" }], reading: "Which check a refusal matches is our reading." }),
      "POST /api/gateway/real/list": (b) => ({ app: b.app, caller: b.caller, ok: true, tools: [{ name: "crm__find", description: "f" }], ms: 3, trace: listTrace(b.app, b.app === "full" ? ["crm__find", "crm__export"] : ["crm__find"]) }),
      "POST /api/gateway/real/call": (b) => ({ app: b.app, caller: b.caller, tool: b.tool, ok: false, refusal: { status: null, message: "not exposed by this aggregate", layer: "tool-filter" }, ms: 5, listTrace: listTrace(b.app, ["crm__find"]), trace: callTrace }),
    });
  });

  it("shows one tools/list per app, then the listing before a hidden-name call and the call, marked inferred or observed", async () => {
    const user = userEvent.setup();
    await openPage(user);
    const panel = await screen.findByTestId("gateway-trace");
    await waitFor(() => expect(screen.getByTestId("trace-2")).toBeInTheDocument());
    expect(within(panel).getByTestId("gateway-trace-basis")).toHaveTextContent(/Real gateway\. The requests and responses are exact/);
    expect(screen.getByTestId("trace-1")).toHaveTextContent("tools/list on full");
    expect(screen.getByTestId("trace-2")).toHaveTextContent("tools/list on limited");
    expect(within(screen.getByTestId("trace-1-decisions")).getAllByText("inferred from the outcome")).toHaveLength(2);

    await user.type(screen.getByLabelText("Tool name"), "crm__export");
    await user.click(screen.getByRole("checkbox", { name: /Send a real tools\/call/ }));
    await user.click(screen.getByRole("button", { name: "Call" }));
    const call = await screen.findByTestId("trace-4");
    expect(call).toHaveTextContent("tools/call crm__export on full");
    expect(screen.getByTestId("trace-3")).toHaveTextContent("(before the call)");
    expect(within(screen.getByTestId("trace-4-decisions")).getByText("observed in the response")).toBeInTheDocument();
    expect(within(panel).queryByText("checked")).toBeNull();
    expect(panel).not.toHaveTextContent(/Simulated:/);
  });
});
