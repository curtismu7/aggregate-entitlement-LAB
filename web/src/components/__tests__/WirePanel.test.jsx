import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../../App.jsx";
import WirePanel from "../WirePanel.jsx";
import { setJsonView } from "../JsonPane.jsx";
import { SPEC_URL, WIRE } from "../../lib/wire.js";
import { gatewayOrigin, mockServer, routeGatewayTo } from "../../testUtil.js";

afterEach(cleanup);
// The Form | JSON choice is shared module state: these tests read the JSON text, so they say which view they mean.
beforeEach(() => setJsonView("raw"));

describe("WirePanel", () => {
  it("renders request, response, the token split in three and a row per claim with a plain note", () => {
    render(<WirePanel wire={WIRE.gcaller} />);
    expect(screen.getByTestId("wire-request-head")).toHaveTextContent("POST /mcp HTTP/1.1");
    expect(screen.getByTestId("wire-request-body")).toHaveTextContent('"method": "tools/list"');
    expect(screen.getByTestId("wire-response-head")).toHaveTextContent("HTTP/1.1 200 OK");
    expect(screen.getByTestId("wire-jwt").textContent.split(".")).toHaveLength(3);
    expect(screen.getByTestId("wire-jwt")).toHaveTextContent("sig-not-real");
    const aud = screen.getByText("aud").closest("tr");
    expect(within(aud).getByText("https://mcp.example.com/mcp")).toBeInTheDocument();
    expect(aud).toHaveTextContent("Who the token is FOR");
    expect(screen.getByText("header.alg").closest("tr")).toHaveTextContent("RS256");
    expect(screen.getByText(/What to notice:/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /authorization specification/ })).toHaveAttribute("href", SPEC_URL);
  });

  it("says plainly when a step has no network traffic", () => {
    render(<WirePanel wire={WIRE.ggw} />);
    expect(screen.getByTestId("wire-none")).toHaveTextContent("This happens inside the gateway");
    expect(screen.queryByTestId("wire-request-box")).toBeNull();
    expect(screen.queryByTestId("wire-jwt")).toBeNull();
  });

  it("covers exactly the six diagram boxes and uses only example values", () => {
    expect(Object.keys(WIRE).sort()).toEqual(["gagg", "gcaller", "gdown", "ghop", "ggw", "gmember"].sort());
    expect(JSON.stringify(WIRE)).not.toMatch(/pingone|ping-devops|ping\.com/i);
    expect(SPEC_URL).toBe("https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization");
  });

  it("changes with the selected diagram box", async () => {
    mockServer();
    routeGatewayTo(gatewayOrigin());
    render(<App />);
    await screen.findByRole("button", { name: "Simulate" });
    fireEvent.click(screen.getByText("Caller", { selector: ".fbox strong" }));
    expect(screen.getByTestId("wire-request-body")).toHaveTextContent('"method": "tools/list"');
    fireEvent.click(screen.getByText("Member hop", { selector: ".fbox strong" }));
    expect(screen.getByTestId("wire-none")).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByText("Aggregate: policy cap", { selector: ".fbox strong" })); });
    expect(screen.getByTestId("wire-response-head")).toHaveTextContent("403 Forbidden");
  });

  it("gives each message body a Form | JSON toggle: the headers stay text, the body is a form or the exact JSON", () => {
    setJsonView("form");
    render(<WirePanel wire={WIRE.gagg} />);
    expect(screen.getByTestId("wire-request-head")).toHaveTextContent("Authorization: Bearer");
    const form = screen.getByTestId("wire-request-body");
    expect(form).toHaveTextContent("method");
    expect(form).toHaveTextContent("tools/call");
    expect(form).not.toHaveTextContent('"method":');
    const toggle = screen.getByTestId("wire-request-body-raw");
    expect(screen.getByTestId("wire-request-body-formatted")).toHaveTextContent("Form");
    expect(toggle).toHaveTextContent("JSON");
    fireEvent.click(toggle);
    expect(screen.getByTestId("wire-request-body")).toHaveTextContent('"method": "tools/call"');
    expect(screen.getByTestId("wire-response-body")).toHaveTextContent('"error": "tool_not_available"');
  });
});
