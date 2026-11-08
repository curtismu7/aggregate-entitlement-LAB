import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../../App.jsx";
import { gatewayOrigin, mockServer, routeGatewayTo, sent } from "../../testUtil.js";

// Rule 19: the header Mock/Real toggle. /api/info and /api/mode are faked so both switch directions, a refused switch
// (409 with the how-to) and the Real-not-configured state are covered in isolation.
beforeEach(() => { window.location.hash = ""; try { localStorage.clear(); } catch { /* none */ } });
afterEach(cleanup);

const REAL_INFO = { source: "real", realAvailable: true, realReason: null };
const MOCK_INFO = { source: "mock", realAvailable: true, realReason: null };
const NOT_SET = "Real is not configured: no gateway URL. Set AGG_ENT_GW_URL, AGG_ENT_GW_APPS and at least one AGG_ENT_GW_KEY_<NAME> in ~/Development/.env.";

async function mount({ info, modeReply } = {}) {
  const overrides = {};
  if (info) overrides["GET /api/info"] = () => info;
  if (modeReply) overrides["POST /api/mode"] = () => modeReply;
  mockServer(overrides);
  routeGatewayTo(gatewayOrigin());
  render(<App />);
  await screen.findByTestId("mode-toggle");
}

describe("rule 19: the Mock/Real toggle", () => {
  it("is in the header on every page, with the server's mode pressed", async () => {
    await mount({ info: MOCK_INFO });
    for (const name of ["Stories", "Limits", "Entitled listing"]) {
      fireEvent.click(screen.getByRole("link", { name }));
      expect(screen.getByTestId("mode-toggle")).toBeInTheDocument();
      expect(screen.getByTestId("mode-mock")).toHaveAttribute("aria-pressed", "true");
    }
    expect(screen.getByTestId("mode-real")).toHaveAttribute("aria-pressed", "false");
  });

  it("shows Real pressed when the server defaults to Real (it is configured)", async () => {
    await mount({ info: REAL_INFO });
    await waitFor(() => expect(screen.getByTestId("mode-real")).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByTestId("release-banner")).toHaveTextContent(/Mode: Real/);
  });

  it("switches to Real through POST /api/mode and back to Mock (both directions)", async () => {
    await mount({ info: MOCK_INFO, modeReply: REAL_INFO });
    fireEvent.click(screen.getByTestId("mode-real"));
    await waitFor(() => expect(sent("POST /api/mode").length).toBe(1));
    expect(sent("POST /api/mode")[0].body).toEqual({ source: "real" });
    await waitFor(() => expect(screen.getByTestId("mode-mock")).toHaveAttribute("aria-pressed", "false"));
    expect(screen.getByTestId("release-banner")).toHaveTextContent(/Mode: Real/);
    fireEvent.click(screen.getByTestId("mode-mock"));
    await waitFor(() => expect(sent("POST /api/mode").length).toBe(2));
    expect(sent("POST /api/mode")[1].body).toEqual({ source: "mock" });
  });

  it("the page follows the mode: Real shows the measure-your-gateway sections, Mock the simulation", async () => {
    await mount({ info: MOCK_INFO, modeReply: REAL_INFO });
    await screen.findByTestId("gwl-mode");
    expect(screen.getByTestId("gwl-mode")).toHaveTextContent(/You are in Mock/);
    fireEvent.click(screen.getByTestId("mode-real"));
    await waitFor(() => expect(screen.getByTestId("gwl-mode")).toHaveTextContent(/You are in Real/));
  });

  it("a refused switch (409) shows the server's how-to and changes nothing", async () => {
    await mount({ info: { source: "mock", realAvailable: false, realReason: NOT_SET }, modeReply: { __status: 409, body: { error: "real_not_available", message: NOT_SET, source: "mock" } } });
    fireEvent.click(screen.getByTestId("mode-real"));
    await waitFor(() => expect(screen.getByTestId("mode-note")).toHaveTextContent(/AGG_ENT_GW_URL/));
    expect(screen.getByTestId("mode-mock")).toHaveAttribute("aria-pressed", "true");
  });

  it("when Real is not configured the Real button is aria-disabled with the how-to as its tooltip", async () => {
    await mount({ info: { source: "mock", realAvailable: false, realReason: NOT_SET } });
    await waitFor(() => expect(screen.getByTestId("mode-real")).toHaveAttribute("aria-disabled", "true"));
    expect(screen.getByTestId("mode-real")).toHaveAttribute("title", NOT_SET);
  });
});
