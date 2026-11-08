import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../../App.jsx";
import { mockServer } from "../../testUtil.js";

beforeEach(() => { window.location.hash = "stories"; try { localStorage.clear(); } catch { /* */ } delete document.documentElement.dataset.present; });
afterEach(cleanup);

describe("Stories page and presenter mode", () => {
  it("shows the story, re-skins by vertical and switches path", async () => {
    mockServer();
    const user = userEvent.setup();
    render(<App />);
    const panel = await screen.findByTestId("story-panel");
    expect(panel).toHaveTextContent("Ada sees only what Ada may use");
    await user.selectOptions(screen.getByLabelText("Vertical"), "banking");
    expect(panel).toHaveTextContent("Priya sees only what Priya may use");
    await user.selectOptions(screen.getByLabelText("Vertical"), "airlines");
    expect(panel).toHaveTextContent("Mark sees only what Mark may use");
    expect(panel).not.toHaveTextContent("⟨missing");
    await user.click(screen.getByRole("button", { name: /^6\s*Scan as each caller/ }));
    expect(panel).toHaveTextContent("Scan as each caller");
    await user.click(screen.getByRole("button", { name: "Everything listed" }));
    expect(panel).not.toHaveTextContent("⟨missing");
  });

  it("presenter mode shows a Step N of M bar, steps with the arrow keys and exits with Escape", async () => {
    mockServer();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("story-panel");
    await user.click(screen.getByRole("button", { name: "Present" }));
    expect(document.documentElement.dataset.present).toBe("1");
    expect(screen.getByTestId("present-count")).toHaveTextContent("Step 1 of 6");
    await act(async () => { fireEvent.keyDown(window, { key: "ArrowRight" }); });
    expect(screen.getByTestId("present-count")).toHaveTextContent("Step 2 of 6");
    expect(screen.getByRole("button", { name: /^2\s*Same server, different callers/ })).toHaveAttribute("aria-current", "step");
    await act(async () => { fireEvent.keyDown(window, { key: "Escape" }); });
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(document.documentElement.dataset.present).toBeUndefined();
  });
});
