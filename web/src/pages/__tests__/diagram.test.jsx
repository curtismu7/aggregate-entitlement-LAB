import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App.jsx";
import { gatewayOrigin, mockServer, routeGatewayTo } from "../../testUtil.js";
import { diagramNames, loadDiagram } from "../../diagrams/loadDiagram.js";
import { validateDiagram } from "../../diagrams/diagramSchema.js";
import { toFlow } from "../../diagrams/toFlow.js";

beforeEach(() => { window.location.hash = ""; document.documentElement.removeAttribute("data-theme"); mockServer(); routeGatewayTo(gatewayOrigin()); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the diagram is data, loaded by name (rule 17)", () => {
  it("diagrams/gateway.json is a valid diagram-studio/1 file and is the only diagram", () => {
    expect(diagramNames()).toEqual(["gateway"]);
    expect(validateDiagram(loadDiagram("gateway"))).toEqual([]);
    expect(loadDiagram("nope")).toBeNull();
    expect(loadDiagram(undefined)).toBeNull();
  });
  it("an invalid file is refused rather than drawn", () => {
    const bad = { ...loadDiagram("gateway"), schema: "other" };
    expect(validateDiagram(bad)).toContain('schema must be "diagram-studio/1"');
    expect(validateDiagram({ ...loadDiagram("gateway"), edges: [{ source: "gcaller", target: "missing" }] }).join()).toContain("unknown source or target");
  });
  it("toFlow builds six boxes, five arrows, handles from where the boxes sit, and a one-column phone layout", () => {
    const f = toFlow(loadDiagram("gateway"));
    expect(f.nodes).toHaveLength(6);
    expect(f.edges.map((e) => [e.source, e.sourceHandle, e.target, e.targetHandle])).toEqual([
      ["gcaller", "r", "ggw", "l"], ["ggw", "r", "gagg", "l"], ["gagg", "r", "ghop", "l"], ["ghop", "r", "gmember", "l"], ["gdown", "t", "gagg", "b"],
    ]);
    expect(f.narrow.gcaller).toEqual({ x: 0, y: 0 });
    expect(f.narrow.gmember).toEqual({ x: 0, y: 480 });
    expect(f.narrow.gdown).toEqual({ x: 190, y: 240 });
    expect(f.narrowEdges.g1).toEqual({ sourceHandle: "bb", targetHandle: "tt" });
    expect(f.narrowEdges.g5).toEqual({ sourceHandle: "ls", targetHandle: "rt" });
    expect(f.steps.map((s) => s.edges)).toEqual([["g1"], ["g2"], ["g5"], ["g3"], ["g4"]]);
  });
});

async function openPage(user) {
  render(<App />);
  await user.click(await screen.findByRole("link", { name: "Entitled listing" }));
  await screen.findByRole("button", { name: "Simulate" });
}

describe("Diagram", () => {
  it("has movable boxes, Simulate, Reset diagram and a speed control, and narrates each step", async () => {
    const user = userEvent.setup();
    await openPage(user);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    expect(screen.getByRole("group", { name: /Boxes can be dragged/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Speed")).toBeInTheDocument();
    expect(screen.getByTestId("caption")).toHaveTextContent("Press Simulate");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Simulate" })); });
    expect(screen.getByTestId("caption")).toHaveTextContent(/Step 1 of 5/);
    await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
    expect(screen.getByTestId("caption")).toHaveTextContent(/Step 2 of 5/);
    await act(async () => { fireEvent.change(screen.getByLabelText("Speed"), { target: { value: "4" } }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
    expect(screen.getByTestId("caption")).toHaveTextContent(/Step 3 of 5/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reset diagram" })); });
    expect(screen.getByTestId("caption")).toHaveTextContent("Press Simulate");
  });

  it("explains the step being played, and a box on click: what it prevents and the message on the wire", async () => {
    const user = userEvent.setup();
    await openPage(user);
    expect(screen.getByTestId("guide")).toHaveTextContent("About each step");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Simulate" })); });
    expect(screen.getByTestId("guide")).toHaveTextContent("A tool the caller is not entitled to being offered");
    expect(screen.getByTestId("guide")).toHaveTextContent("Gateway: entitlement-aware discovery");
    fireEvent.click(screen.getByText("Member hop", { selector: ".fbox strong" }));
    expect(screen.getByTestId("guide")).toHaveTextContent("A stale list or a routing slip getting a call past the cap.");
  });
});

describe("Limits page and theme", () => {
  it("lists what a scan misses, and the theme choice sets data-theme", async () => {
    mockServer({ "GET /api/rules": () => ({ limits: [{ id: "rug-pull", text: "Rug-pulls after the scan." }], rules: [{ id: "MT-HI-001", severity: "high", kind: "hidden-instruction", title: "Instruction tag" }] }) });
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(await screen.findByLabelText("Theme"), "dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    await user.click(screen.getByRole("link", { name: "Limits" }));
    expect(await screen.findByText("Rug-pulls after the scan.")).toBeInTheDocument();
    expect(within(screen.getByText("MT-HI-001").closest("tr")).getByText("high")).toBeInTheDocument();
  });
});
