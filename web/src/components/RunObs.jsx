// Rule 27: the shared run-observability panel for this lab, with the lab's own states around it. The panel shows ONE run: the request the page just made (a tools/list
// or a tools/call). The server's answer to that request says which run it was (`run: { id }`), or that no run began (`run: null` and `runNote`); this file reads that field and
// never guesses it. Nothing is re-read on a timer and there is no re-read button: this lab reads no logs, so a re-read could find nothing new.
import React, { useEffect, useState } from "react";
import RunObservability from "../run-observability/RunObservability.jsx";
import { get } from "../lib/api.js";

// Where this lab's run leaves logs and where they can stream (the README says the same).
export const LOG_STREAMS = [
  { product: "Aggregate entitlement LAB (this lab's container)", lives: "its stdout. Each row of a run is one line: the time, a step, the layer, the caller's name, a result and a run id. A line never holds an agent key, a tool name or a gateway address. Mock writes the steps its simulation computed; Real writes one line per reply received from your gateway", streams: "nowhere today: the family log collector's source list does not name this container, so it would need an entry first. The SIEM time would then be Docker's wall-clock time for the line, not the time in the line" },
  { product: "Privilege agent gateway (Real)", lives: "its own log (a log volume for a local gateway; the SIEM index for the hosted one)", streams: "the Privilege SIEM export. This lab does not read it, so a Real record holds only what the lab received" },
];

const TITLE = "What each layer logged for this run";
// What a rejected answer, a missing field or an answer of another shape all come to: the page's own state, not a record.
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** What the server said about the run of one answer: { runId } | { none: text } | { bad: true } (the answer did not say). `d` is the answer's JSON body. */
export function headOf(d) {
  if (isObj(d) && "run" in d) {
    if (isObj(d.run) && typeof d.run.id === "string" && d.run.id) return { runId: d.run.id };
    if (d.run === null) return { none: typeof d.runNote === "string" && d.runNote ? d.runNote : "This request began no run, so nothing was recorded." };
  }
  return { bad: true };
}

// The record route's answer -> what to show. Pure and total: no shape of answer can throw here.
function shapeOf(r) {
  const d = r?.data;
  if (!r?.ok) return { problem: isObj(d) && typeof d.message === "string" && d.message ? d.message : `The lab answered ${r?.status ?? "nothing"} when asked for this run's record.` };
  if (isObj(d) && "record" in d) {
    if (d.record === null) return { empty: typeof d.message === "string" && d.message ? d.message : "There is no record for this run." };
    if (isObj(d.record)) return { record: d.record, partial: d.partial === true, notes: Array.isArray(d.notes) ? d.notes.filter((n) => typeof n === "string") : [] };
  }
  return { problem: "The lab's answer was not a run record." };
}

const Note = ({ id, role, children }) => (
  <section className="ro" data-testid={id} aria-label={TITLE}>
    <h2>{TITLE}</h2>
    <p className="ro-muted" role={role}>{children}</p>
  </section>
);

// The one line under the panel: what a row is in this lab, true for every request the page can make (listing, call, and in Real the app comparison).
const NOTE = {
  mock: "Rows are the steps the lab's simulation computed for one request; the steps of one request share one time (their order is kept), and nothing is read from a product log. Counts are rows: one request can give several. Person is empty: the lab has no sign-in. Agent is a simulated caller: the lab takes no key and there is no OBO token. Privilege holds the lab's own simulated policy (ToolFilter, member policy and aggregate cap), not PingOne Privilege. Agent gateway is the lab's simulated aggregate: its answer to a call repeats the decision above it, so it is information, and an answer to a listing is allowed when it carries tools. Resource server has a row only when the configuration marks a member unreachable or needing the caller's own sign-in: the simulation has no member server and nothing is run. The scan and the demo audit view are not gateway requests and add no row.",
  real: "Real is only what the lab received from your gateway: each row is a reply, not a log line, and counts are rows. Which check a refusal matches is the lab's own reading of the gateway's words, and it is part of the gateway row (the gateway sends no such field). Privilege's policy log and the member servers' logs are not read by this lab, and the agent key and the gateway address are never part of a row. A call that got no reply has no row, and a record with a missing reply says it is partial.",
};

export default function RunObs({ source, head, loading = false, empty = "Nothing has run yet." }) {
  const runId = !loading && head?.runId ? head.runId : null;
  const key = `${source}|${runId}`;
  const [answer, setAnswer] = useState(null); // { key, ...shapeOf }: the answer to the request for `key`
  useEffect(() => {
    if (!runId) return undefined;
    let live = true;
    const done = (a) => { if (live) setAnswer({ key, ...a }); };
    get(`/api/gateway/run?runId=${encodeURIComponent(runId)}`).then((r) => done(shapeOf(r))).catch((e) => done({ problem: `Could not reach the lab (${String(e?.message || e).slice(0, 120)}).` }));
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- a new run or mode asks again; nothing else does

  if (loading) return <Note id="ro-loading">Collecting this run's logs…</Note>;
  if (!head) return <Note id="ro-empty">{empty}</Note>;
  if (head.bad) return <Note id="ro-bad" role="alert">The lab's answer did not say which run it was, so there is no record to show (and no older one is shown in its place).</Note>;
  if (head.none) return <Note id="ro-no-run">{head.none}</Note>;
  if (!answer || answer.key !== key) return <Note id="ro-loading">Collecting this run's logs…</Note>; // never the previous record
  if (answer.problem) return <Note id="ro-problem" role="alert">{answer.problem}</Note>;
  if (answer.empty) return <Note id="ro-gone">{answer.empty}</Note>;
  return (
    <div data-testid="ro-wrap">
      {answer.partial && <p className="ro-muted" role="status" data-testid="ro-partial"><strong>This record is partial.</strong> {answer.notes.join(" ") || "A reply it needed is missing."}</p>}
      <RunObservability record={answer.record} source={source} streams={LOG_STREAMS} />
      <p className="ro-muted" data-testid="ro-lab-note">{NOTE[source]}</p>
    </div>
  );
}
