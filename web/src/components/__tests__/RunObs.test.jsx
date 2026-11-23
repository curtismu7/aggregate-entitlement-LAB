import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RunObs, { headOf } from "../RunObs.jsx";
import { setJsonView } from "../JsonPane.jsx";
import { mockRecord, realRecord } from "../../run-observability/fixtures.js";

// The lab's wrapper around the shared panel: which run is asked for, what is shown while it loads, and what every non-record answer comes to.
// The shared panel has its own tests in web/src/run-observability/.
beforeEach(() => setJsonView("raw"));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const recordOf = (runId, text, source = "mock") => {
  const base = source === "mock" ? mockRecord : realRecord;
  return { ...base, runId, source, rows: base.rows.map((r) => (r.layer === "gateway" ? { ...r, message: text } : r)) };
};
// A fetch that answers by URL. `throws` is a body that is not JSON (an HTML page, an empty body): the lab's api() turns it into data null.
const reply = (body, { ok = true, status = 200, throws = false } = {}) => ({ ok, status, json: async () => { if (throws) throw new SyntaxError("Unexpected token"); return body; } });
function serve(routes) {
  globalThis.fetch = vi.fn(async (url) => {
    const h = routes[String(url)];
    if (!h) return reply({ message: `no route ${url}` }, { ok: false, status: 404 });
    return typeof h === "function" ? h() : h;
  });
}
const url = (id) => `/api/gateway/run?runId=${id}`;
const fetched = () => globalThis.fetch.mock.calls.map(([u]) => String(u));

describe("what the server said about a run (headOf)", () => {
  it("reads the run id, or the note that no run began", () => {
    expect(headOf({ run: { id: "list-aaaaaa-1" } })).toEqual({ runId: "list-aaaaaa-1" });
    expect(headOf({ run: null, runNote: "began none" })).toEqual({ none: "began none" });
    expect(headOf({ run: null })).toEqual({ none: expect.stringMatching(/began no run/) });
    expect(headOf({ run: null, runNote: "" })).toEqual({ none: expect.stringMatching(/began no run/) });
  });
  it.each([
    ["undefined", undefined], ["null", null], ["an array", []], ["a JSON string", "ok"], ["an empty object", {}], ["a run that is undefined", { run: undefined }],
    ["a run with no id", { run: {} }], ["a run with an empty id", { run: { id: "" } }], ["a run id that is a number", { run: { id: 5 } }], ["a run that is text", { run: "x" }], ["an error answer with no run field", { error: "server_error" }],
  ])("%s does not say which run it was: the client never guesses", (_name, d) => { expect(headOf(d)).toEqual({ bad: true }); });
});

describe("the states around the panel", () => {
  it("nothing yet: the empty text, and nothing is fetched", () => {
    serve({});
    render(<RunObs source="mock" head={undefined} empty="Nothing has run yet." />);
    expect(screen.getByTestId("ro-empty")).toHaveTextContent("Nothing has run yet.");
    expect(fetched()).toHaveLength(0);
  });
  it("a request still out: the loading note even when a head is given, and nothing is fetched", () => {
    serve({});
    render(<RunObs source="mock" head={{ runId: "list-aaaaaa-1" }} loading />);
    expect(screen.getByTestId("ro-loading")).toHaveTextContent("Collecting this run's logs…");
    expect(fetched()).toHaveLength(0);
  });
  it("an answer that said no run began: its note, no panel, nothing fetched (and no older record)", () => {
    serve({});
    render(<RunObs source="mock" head={{ none: "This request began no run, so nothing was recorded." }} />);
    expect(screen.getByTestId("ro-no-run")).toHaveTextContent(/began no run/);
    expect(screen.queryByTestId("run-observability")).toBeNull();
    expect(fetched()).toHaveLength(0);
  });
  it("an answer that did not say which run it was is an alert, and nothing is fetched", () => {
    serve({});
    render(<RunObs source="real" head={{ bad: true }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/did not say which run it was/);
    expect(fetched()).toHaveLength(0);
  });
});

describe("the record route's answer", () => {
  it("a Mock record: the shared panel, the lab's one-line note, and where the logs live", async () => {
    serve({ [url("list-aaaaaa-1")]: reply({ record: recordOf("list-aaaaaa-1", "the mock row"), partial: false, notes: [] }) });
    render(<RunObs source="mock" head={{ runId: "list-aaaaaa-1" }} />);
    const panel = await screen.findByTestId("run-observability");
    expect(panel).toHaveTextContent("the mock row");
    expect(screen.getByTestId("ro-lab-note")).toHaveTextContent(/Rows are the steps the lab's simulation computed/);
    expect(screen.getByTestId("ro-lab-note")).toHaveTextContent(/Privilege holds the lab's own simulated policy/);
    expect(screen.getByTestId("ro-lab-note")).toHaveTextContent(/Counts are rows/);
    expect(screen.getByTestId("ro-streams")).toHaveTextContent(/stdout/);
    expect(screen.getByTestId("ro-streams")).toHaveTextContent(/nowhere today/);
    expect(screen.queryByTestId("ro-partial")).toBeNull();
    expect(fetched()).toEqual([url("list-aaaaaa-1")]);
  });
  it("a Real record: the note says each row is a reply, and a partial record says so", async () => {
    serve({ [url("call-bbbbbb-2")]: reply({ record: recordOf("call-bbbbbb-2", "the real row", "real"), partial: true, notes: ["The tools/call got no reply."] }) });
    render(<RunObs source="real" head={{ runId: "call-bbbbbb-2" }} />);
    await screen.findByTestId("run-observability");
    expect(screen.getByTestId("ro-lab-note")).toHaveTextContent(/each row is a reply, not a log line/);
    expect(screen.getByTestId("ro-partial")).toHaveTextContent(/This record is partial\. The tools\/call got no reply\./);
  });
  it("a record of the other mode is refused on screen by the shared panel", async () => {
    serve({ [url("list-aaaaaa-1")]: reply({ record: recordOf("list-aaaaaa-1", "x", "real") }) });
    render(<RunObs source="mock" head={{ runId: "list-aaaaaa-1" }} />);
    expect(await screen.findByTestId("ro-mismatch")).toHaveTextContent(/real mode but the page is in mock mode/);
  });
  it("a run that is no longer kept: the lab's words, not an alert", async () => {
    serve({ [url("list-aaaaaa-1")]: reply({ record: null, message: "That run is no longer kept." }) });
    render(<RunObs source="mock" head={{ runId: "list-aaaaaa-1" }} />);
    expect(await screen.findByTestId("ro-gone")).toHaveTextContent("That run is no longer kept.");
    expect(screen.queryByRole("alert")).toBeNull();
    cleanup();
    serve({ [url("list-aaaaaa-1")]: reply({ record: null }) });
    render(<RunObs source="mock" head={{ runId: "list-aaaaaa-1" }} />);
    expect(await screen.findByTestId("ro-gone")).toHaveTextContent("There is no record for this run.");
  });
  it.each([
    ["an HTML page with status 200", reply(null, { throws: true })], ["null", reply(null)], ["an empty body", reply(undefined, { throws: true })], ["an array", reply([])], ["a JSON string", reply("ok")], ["an empty object", reply({})],
    ["an object whose record is text", reply({ record: "x" })], ["an object whose record is a list", reply({ record: [] })],
  ])("%s is an alert, never a stuck 'Collecting' note and never the empty state", async (_name, answer) => {
    serve({ [url("list-aaaaaa-1")]: answer });
    render(<RunObs source="mock" head={{ runId: "list-aaaaaa-1" }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The lab's answer was not a run record.");
    expect(screen.queryByTestId("ro-loading")).toBeNull();
    expect(screen.queryByTestId("ro-empty")).toBeNull();
    expect(screen.queryByTestId("run-observability")).toBeNull();
  });
  it("a refusal and a non-JSON failure are alerts that say what the lab said", async () => {
    serve({ [url("list-aaaaaa-1")]: reply({ error: "bad_run_id", message: "runId must be the id of one run" }, { ok: false, status: 400 }) });
    render(<RunObs source="mock" head={{ runId: "list-aaaaaa-1" }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("runId must be the id of one run");
    cleanup();
    serve({ [url("list-aaaaaa-1")]: reply(null, { ok: false, status: 502, throws: true }) });
    render(<RunObs source="mock" head={{ runId: "list-aaaaaa-1" }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The lab answered 502 when asked for this run's record.");
  });
  it("a request that never reaches the lab is an alert too (the handler catches its own errors)", async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    render(<RunObs source="mock" head={{ runId: "list-aaaaaa-1" }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not reach the lab \(Failed to fetch\)/);
  });
});

describe("never the previous record while the next one loads", () => {
  it("a record delayed 2.5 s after the run changed: the loading note for the whole wait, then the new record", async () => {
    let release;
    serve({
      [url("list-aaaaaa-1")]: reply({ record: recordOf("list-aaaaaa-1", "RECORD ONE") }),
      [url("call-aaaaaa-2")]: () => new Promise((r) => { release = () => r(reply({ record: recordOf("call-aaaaaa-2", "RECORD TWO") })); }),
    });
    const { rerender } = render(<RunObs source="mock" head={{ runId: "list-aaaaaa-1" }} />);
    expect(await screen.findByTestId("run-observability")).toHaveTextContent("RECORD ONE");
    rerender(<RunObs source="mock" head={{ runId: "call-aaaaaa-2" }} />);
    expect(screen.getByTestId("ro-loading")).toBeInTheDocument(); // in the very render that asked for the other run
    expect(screen.queryByText("RECORD ONE")).toBeNull();
    await new Promise((r) => setTimeout(r, 2500));
    expect(screen.getByTestId("ro-loading")).toBeInTheDocument();
    expect(screen.queryByText("RECORD ONE")).toBeNull();
    release();
    await waitFor(() => expect(screen.getByTestId("run-observability")).toHaveTextContent("RECORD TWO"));
    expect(screen.queryByText("RECORD ONE")).toBeNull();
  }, 20000);

  it("a late answer for an earlier run never replaces the one asked for last", async () => {
    let releaseOne;
    serve({
      [url("list-aaaaaa-1")]: () => new Promise((r) => { releaseOne = () => r(reply({ record: recordOf("list-aaaaaa-1", "RECORD ONE") })); }),
      [url("call-aaaaaa-2")]: reply({ record: recordOf("call-aaaaaa-2", "RECORD TWO") }),
    });
    const { rerender } = render(<RunObs source="mock" head={{ runId: "list-aaaaaa-1" }} />);
    rerender(<RunObs source="mock" head={{ runId: "call-aaaaaa-2" }} />);
    expect(await screen.findByTestId("run-observability")).toHaveTextContent("RECORD TWO");
    releaseOne();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId("run-observability")).toHaveTextContent("RECORD TWO");
    expect(screen.queryByText("RECORD ONE")).toBeNull();
  });

  it("a request for the same run again is not made on every render", async () => {
    serve({ [url("list-aaaaaa-1")]: reply({ record: recordOf("list-aaaaaa-1", "RECORD ONE") }) });
    const { rerender } = render(<RunObs source="mock" head={{ runId: "list-aaaaaa-1" }} />);
    await screen.findByTestId("run-observability");
    rerender(<RunObs source="mock" head={{ runId: "list-aaaaaa-1" }} />);
    rerender(<RunObs source="mock" head={{ runId: "list-aaaaaa-1" }} empty="x" />);
    expect(fetched()).toEqual([url("list-aaaaaa-1")]);
    expect(within(screen.getByTestId("run-observability")).getByText("RECORD ONE")).toBeInTheDocument();
  });
});
