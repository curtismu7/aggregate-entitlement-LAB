import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configure } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App.jsx";
import { gatewayOrigin, mockServer, routeGatewayTo } from "../../testUtil.js";

// These tests drive the page against the real simulated gateway engine. Every count below was produced by that engine.
beforeEach(() => { window.location.hash = ""; document.documentElement.removeAttribute("data-theme"); delete document.documentElement.dataset.present; try { localStorage.clear(); } catch { /* none */ } mockServer(); routeGatewayTo(gatewayOrigin()); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

// The engine runs in a real server on a loaded machine; waiting for an enabled or updated state needs more than 1 s.
configure({ asyncUtilTimeout: 8000 });

const PAGES = ["Entitled listing", "Stories", "Limits"];
const BANNER = /Ping release claim \(2026-11-02\), UNVERIFIED on our tenant/;

async function openGateway(user) {
  render(<App />);
  await user.click(await screen.findByRole("link", { name: "Entitled listing" }));
  await waitFor(() => expect(screen.getByTestId("listing-count")).toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole("button", { name: "Reset" })).toBeEnabled());
}
const count = () => Number(within(screen.getByTestId("listing-count")).getByText(/^\d+$/).textContent);
const listed = () => within(screen.getByRole("list", { name: "Listed tools" })).queryAllByRole("listitem").map((li) => li.querySelector("code").textContent);
async function callTool(user, name) {
  await user.clear(screen.getByLabelText("Tool name"));
  await user.type(screen.getByLabelText("Tool name"), name);
  await waitFor(() => expect(screen.getByRole("button", { name: "Call" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "Call" }));
  return screen.findByTestId("call-result");
}

describe("the release-claim banner", () => {
  it("is on every tab, and says the mode the app is in", async () => {
    const user = userEvent.setup();
    render(<App />);
    for (const name of PAGES) {
      await user.click(await screen.findByRole("link", { name }));
      expect(screen.getByRole("link", { name })).toHaveAttribute("aria-current", "page");
      const b = screen.getByTestId("release-banner");
      expect(b).toHaveTextContent(BANNER);
      expect(b).toHaveTextContent(/Mock simulates them, and Real measures/);
      await waitFor(() => expect(b).toHaveTextContent(/Mode: Mock \(simulated in this process/));
    }
  });
  it("is still there in presenter mode, on every tab", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Present" }));
    expect(document.documentElement.dataset.present).toBe("1");
    for (const name of PAGES) {
      await user.click(screen.getByRole("link", { name }));
      expect(screen.getByTestId("release-banner")).toHaveTextContent(BANNER);
    }
    expect(screen.getByRole("toolbar", { name: "Presenter controls" })).toBeInTheDocument();
  });
  it("names Real when the server is in Real", async () => {
    mockServer({ "GET /api/info": () => ({ source: "real", realAvailable: true, realReason: null }) });
    routeGatewayTo(gatewayOrigin());
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("release-banner")).toHaveTextContent(/Mode: Real/));
    expect(screen.getByTestId("release-banner")).toHaveTextContent(BANNER);
  });
});

describe("Entitled listing page (real engine)", () => {
  it("lists per caller with real counts and names prefixed by the alias", async () => {
    const user = userEvent.setup();
    await openGateway(user);
    expect(count()).toBe(6);
    expect(listed()).toEqual(["crm__find_customer", "crm__update_customer", "bill__get_invoice", "bill__list_payments", "bill__refund_payment", "wiki__search_pages"]);
    await user.selectOptions(screen.getByLabelText("Caller"), "guest");
    await waitFor(() => expect(count()).toBe(1));
    expect(listed()).toEqual(["wiki__search_pages"]);
    await user.selectOptions(screen.getByLabelText("Caller"), "analyst");
    await waitFor(() => expect(count()).toBe(4));
    expect(screen.getByText(/does not say how many there are/)).toBeInTheDocument();
  });

  it("refuses a tool that is not listed when it is called by name, and allows a listed one (negative control)", async () => {
    const user = userEvent.setup();
    await openGateway(user);
    const hidden = await callTool(user, "crm__export_all");
    expect(hidden).toHaveAttribute("data-state", "refused");
    expect(hidden).toHaveTextContent("That tool is not available to this caller.");
    expect(hidden).toHaveTextContent(/403/);
    expect(hidden).toHaveTextContent(/the aggregate policy cap does not allow it/);
    expect(hidden).toHaveTextContent(/Demo only/);
    const unknown = await callTool(user, "crm__no_such_tool");
    await waitFor(() => expect(unknown).toHaveTextContent(/no such tool/));
    expect(unknown).toHaveTextContent("That tool is not available to this caller.");
    const ok = await callTool(user, "crm__update_customer");
    await waitFor(() => expect(ok).toHaveAttribute("data-state", "allowed"));
    expect(ok).toHaveTextContent(/nothing was run/);
  });

  it("direct use of a member follows only the member policy (negative control for the cap)", async () => {
    const user = userEvent.setup();
    await openGateway(user);
    await user.click(screen.getByRole("button", { name: "One member directly" }));
    await waitFor(() => expect(listed()).toContain("export_all"));
    expect(listed()).toEqual(["find_customer", "update_customer", "export_all"]);
    const r = await callTool(user, "export_all");
    await waitFor(() => expect(r).toHaveAttribute("data-state", "allowed"));
  });

  it("reports an unreachable member instead of dropping it", async () => {
    const user = userEvent.setup();
    await openGateway(user);
    const crm = screen.getByText("crm", { selector: "legend code" }).closest("fieldset");
    await user.click(within(crm).getByLabelText("Reachable"));
    await waitFor(() => expect(count()).toBe(4));
    const members = screen.getByRole("list", { name: "Member status" });
    expect(within(members).getByText("crm", { selector: "code" }).closest("li")).toHaveTextContent(/unreachable \(reported, not dropped\)/);
    expect(within(members).getAllByRole("listitem")).toHaveLength(3);
  });

  it("a member that needs each caller's own sign-in is reported as needing it until the caller is signed in", async () => {
    const user = userEvent.setup();
    await openGateway(user);
    const wiki = screen.getByText("wiki", { selector: "legend code" }).closest("fieldset");
    await user.click(within(wiki).getByLabelText(/Needs each caller's own sign-in/));
    await waitFor(() => expect(count()).toBe(5));
    const members = screen.getByRole("list", { name: "Member status" });
    expect(within(members).getByText("wiki", { selector: "code" }).closest("li")).toHaveTextContent(/needs the caller's own sign-in \(reported, not dropped\)/);
    await user.click(within(wiki).getByLabelText("Operator", { selector: "input" }));
    await waitFor(() => expect(count()).toBe(6));
  });

  it("editing a cap box changes the list, and Reset restores the config the server holds", async () => {
    const user = userEvent.setup();
    await openGateway(user);
    const box = screen.getByLabelText("cap lets Operator use crm__export_all");
    expect(box).not.toBeChecked();
    await user.click(box);
    await waitFor(() => expect(count()).toBe(7));
    expect(listed()).toContain("crm__export_all");
    await user.selectOptions(screen.getByLabelText("Caller"), "guest");
    await waitFor(() => expect(count()).toBe(1));
    await user.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(screen.getByLabelText("Caller")).toHaveValue("operator"));
    await waitFor(() => expect(count()).toBe(6));
    expect(screen.getByLabelText("cap lets Operator use crm__export_all")).not.toBeChecked();
  });

  it("an invalid alias is flagged and not sent; a valid one renames the tools", async () => {
    const user = userEvent.setup();
    await openGateway(user);
    const wiki = screen.getByText("wiki", { selector: "legend code" }).closest("fieldset");
    const alias = within(wiki).getByLabelText("Alias");
    await user.clear(alias);
    await user.type(alias, "Bad Alias");
    expect(alias).toHaveAttribute("aria-invalid", "true");
    expect(listed()).toContain("wiki__search_pages");
    await user.clear(alias);
    await user.type(alias, "kb");
    await waitFor(() => expect(listed()).toContain("kb__search_pages"));
    expect(listed()).not.toContain("wiki__search_pages");
  });

  it("scans the listing as the caller sees it, and says the scan covers only that", async () => {
    const user = userEvent.setup();
    await openGateway(user);
    await user.click(screen.getByRole("button", { name: "One member directly" }));
    await waitFor(() => expect(listed()).toContain("export_all"));
    await user.click(screen.getByRole("button", { name: "Scan as Operator" }));
    const seen = await screen.findByTestId("gateway-scan");
    expect(within(seen).getByTestId("verdict")).toHaveTextContent("High-severity patterns found");
    expect(seen).toHaveTextContent(/covers only the 3 tool\(s\) that Operator sees/);
    await user.selectOptions(screen.getByLabelText("Caller"), "analyst");
    await waitFor(() => expect(listed()).toEqual(["find_customer"]));
    await user.click(screen.getByRole("button", { name: "Scan as Analyst" }));
    const clean = await screen.findByTestId("gateway-scan");
    expect(within(clean).getByTestId("verdict")).toHaveTextContent("No known pattern found");
    expect(clean).toHaveTextContent(/covers only the 1 tool\(s\) that Analyst sees/);
    expect(clean).toHaveTextContent(/not a clean result for any other caller/);
    expect(within(clean).getByTestId("cannot-catch")).toHaveTextContent(/entitlement-filtered list covers only what that caller sees/);
  });

  it("shows the demo audit as demo-only and tags every name", async () => {
    const user = userEvent.setup();
    await openGateway(user);
    expect(screen.getByText(/Not what the caller sees/)).toBeInTheDocument();
    const audit = screen.getByTestId("audit");
    await waitFor(() => expect(within(audit).getAllByRole("row")).toHaveLength(9));
    expect(within(audit).getByText("crm__export_all").closest("tr")).toHaveAttribute("data-state", "hidden");
    const prov = screen.getByTestId("provenance");
    for (const name of ["AppRef", "Alias", "ToolFilter", "Members"]) expect(within(prov).getByText(name).closest("tr")).toHaveTextContent("console swagger name, 2026-10-31, schema only");
    for (const name of ["aggregate policy cap", "entitlement-aware discovery"]) {
      const row = within(prov).getByText(name).closest("tr");
      expect(row).toHaveTextContent("deck claim, UNVERIFIED on our tenant");
      expect(row).not.toHaveTextContent("console swagger name");
    }
  });
});

describe("Limits page", () => {
  it("is served by the real server list, so the filtered-listing limit comes from the scanner", async () => {
    const user = userEvent.setup();
    mockServer({ "GET /api/rules": () => ({ limits: [{ id: "filtered-listing", text: "A scan of an entitlement-filtered list covers only what that caller sees." }], rules: [] }) });
    routeGatewayTo(gatewayOrigin());
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Limits" }));
    expect(await screen.findByText(/covers only what that caller sees/)).toBeInTheDocument();
  });
});

describe("Diagram: entitled-listing run, on the Entitled listing page", () => {
  it("walks five steps and shows what the real engine says for the current caller", async () => {
    const user = userEvent.setup();
    await openGateway(user);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    for (const t of ["Caller", "Gateway: entitlement filter", "Aggregate: policy cap", "Member hop", "Member MCP server", "Unreachable member"]) expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Simulate" })); });
    expect(screen.getByTestId("caption")).toHaveTextContent(/Step 1 of 5/);
    await waitFor(() => expect(screen.getByTestId("gw-live")).toHaveTextContent(/6 tool\(s\) listed and 2 hidden/));
    expect(screen.getByTestId("gw-live")).toHaveTextContent(BANNER);
    expect(screen.getByTestId("guide")).toHaveTextContent(/A tool the caller is not entitled to being offered/);
  });

  it("Reset diagram clears the walk but leaves the policy; Reset restores the policy", async () => {
    const user = userEvent.setup();
    await openGateway(user);
    await user.click(screen.getByLabelText("cap lets Operator use crm__export_all"));
    await user.selectOptions(screen.getByLabelText("Caller"), "guest");
    await waitFor(() => expect(screen.getByTestId("gw-live")).toHaveTextContent(/for Guest through the aggregate: 1 tool/));
    await user.click(screen.getByRole("button", { name: "Simulate" }));
    await user.click(screen.getByRole("button", { name: "Reset diagram" }));
    expect(screen.getByTestId("caption")).toHaveTextContent("Press Simulate");
    expect(screen.getByLabelText("Caller")).toHaveValue("guest");
    await user.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(screen.getByTestId("gw-live")).toHaveTextContent(/for Operator through the aggregate: 6 tool\(s\) listed and 2 hidden/));
    expect(screen.getByLabelText("cap lets Operator use crm__export_all")).not.toBeChecked();
    expect(screen.getByLabelText("Caller")).toHaveValue("operator");
  });
});
