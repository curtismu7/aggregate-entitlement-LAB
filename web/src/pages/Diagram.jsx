import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Background, BaseEdge, Controls, Handle, MarkerType, Position, ReactFlow, applyNodeChanges, getBezierPath, useStore } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import WirePanel from "../components/WirePanel.jsx";
import { WIRE } from "../lib/wire.js";
import { post } from "../lib/api.js";
import { placeLabels } from "../lib/labelSpot.js";
import { BANNER } from "../lib/gateway.js";
import { loadDiagram } from "../diagrams/loadDiagram.js";
import { toFlow } from "../diagrams/toFlow.js";
import "./Diagram.css";

// The entitled-listing diagram, drawn from diagrams/gateway.json (diagram-studio/1) by name. Boxes are draggable; Simulate walks
// one run; Reset diagram puts the boxes back; the speed control sets the pace. The caption says in words what the picture shows.
// It sits inside the Entitled listing page. Ping release claim (2026-11-02), UNVERIFIED on our tenant.
export const FLOW = toFlow(loadDiagram("gateway"));
export const STEPS = FLOW.steps;
export const VIEWS = { gateway: FLOW }; // the label-placement test walks every view
const SPEEDS = [["0.5", "0.5x"], ["1", "1x"], ["2", "2x"], ["4", "4x"]];
const BASE_MS = 1600;

// Where each handle sits. A box renders only the handles an edge uses, so no stray dots hang on it.
export const HANDLES = {
  l: ["target", Position.Left], b: ["target", Position.Bottom], tt: ["target", Position.Top], rt: ["target", Position.Right],
  r: ["source", Position.Right], t: ["source", Position.Top], bb: ["source", Position.Bottom], ls: ["source", Position.Left],
};
function Box({ data }) {
  return (
    <div className={`fbox${data.on ? " on" : ""}${data.dim ? " dim" : ""}`} data-layout={data.narrow ? "narrow" : "wide"}>
      {data.handles.map((id) => <Handle key={id} id={id} type={HANDLES[id][0]} position={HANDLES[id][1]} />)}
      <strong>{data.title}</strong>
      {!data.narrow && <span>{data.sub}</span>}
    </div>
  );
}
const nodeTypes = { box: Box };

// Every box's place and size, and every edge's ends and label, as one string each, so an edge redraws only when something
// that matters to a label has moved.
const boxesKey = (s) => JSON.stringify([...s.nodeLookup.values()].map((n) => [n.id, n.internals.positionAbsolute.x, n.internals.positionAbsolute.y, n.measured.width ?? 0, n.measured.height ?? 0]));
const edgesKey = (s) => JSON.stringify(s.edges.map((e) => [e.id, e.source, e.target, e.sourceHandle, e.targetHandle, e.label]));
const positionOf = (handle) => HANDLES[handle][1];
// A bezier edge whose label moves off any box and off the other labels. Dragging a box right up to its neighbour closes the
// gap the label sits in; the label then takes the nearest clear spot instead of landing on a box.
function LabelEdge({ id, label, markerEnd, interactionWidth, ...p }) {
  const nodesKey = useStore(boxesKey);
  const edgeKey = useStore(edgesKey);
  const [path, midX, midY] = getBezierPath(p);
  const spot = useMemo(() => {
    const nodes = JSON.parse(nodesKey).map(([nid, x, y, w, h]) => ({ id: nid, x, y, w, h }));
    const edges = JSON.parse(edgeKey).map(([eid, source, target, sourceHandle, targetHandle, text]) => ({ id: eid, source, target, sourceHandle, targetHandle, label: text }));
    return placeLabels(nodes, edges, positionOf)[id];
  }, [nodesKey, edgeKey, id]);
  return <BaseEdge id={id} path={path} labelX={spot?.x ?? midX} labelY={spot?.y ?? midY} label={label} markerEnd={markerEnd} interactionWidth={interactionWidth} />;
}
// The type name becomes a CSS class (react-flow__edge-<type>); "label" would collide with the label classes.
const edgeTypes = { clear: LabelEdge };

// Phone width, from the same 600px breakpoint as the CSS. jsdom has no matchMedia, so tests get the wide layout.
function useNarrow() {
  const query = "(max-width: 600px)";
  const [narrow, setNarrow] = useState(() => !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const on = () => setNarrow(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return narrow;
}

// embedded: shown inside the Entitled listing page, fixed on the gateway run, without its own heading or run picker.
export default function Diagram({ theme = "system", gw }) {
  const narrow = useNarrow();
  const [selected, setSelected] = useState(null);
  const [speed, setSpeed] = useState("1");
  const [step, setStep] = useState(-1);
  const [running, setRunning] = useState(false);
  const [fit, setFit] = useState(0); // bumped by Reset so the picture is fitted again
  const [live, setLive] = useState(null);
  const start = useMemo(() => FLOW.nodes.map((n) => ({ ...n, position: narrow ? FLOW.narrow[n.id] : n.position })), [narrow]);
  // Dragged positions belong to one layout. Anything else starts from the file's own positions, in the same render, so the
  // picture is fitted to the right boxes when the layout changes.
  const [dragged, setDragged] = useState({ key: narrow, nodes: start });
  const moved = dragged.key === narrow ? dragged.nodes : start;

  useEffect(() => {
    if (!running) return undefined;
    if (step >= STEPS.length - 1) { setRunning(false); return undefined; }
    const t = setTimeout(() => setStep((s) => s + 1), BASE_MS / Number(speed));
    return () => clearTimeout(t);
  }, [running, step, speed]);

  // Mock: show what the simulated engine says for the current caller (from the server, not from this file).
  const gwState = gw?.state;
  const showLive = Boolean(gwState?.config);
  useEffect(() => {
    if (!showLive) { setLive(null); return undefined; }
    let stale = false;
    const body = { config: gwState.config, caller: gwState.caller };
    Promise.all([post("/api/gateway/list", body), post("/api/gateway/audit", body)]).then(([l, a]) => {
      if (stale) return;
      setLive(l.ok && a.ok ? { caller: gwState.config.callers.find((c) => c.id === gwState.caller)?.label ?? gwState.caller, listed: l.data.tools.length, hidden: a.data.rows.filter((r) => !r.visible).length, members: l.data.members } : { error: true });
    });
    return () => { stale = true; };
  }, [showLive, gwState?.config, gwState?.caller]);

  const simulate = () => { setStep(0); setRunning(true); };
  const reset = () => { setRunning(false); setStep(-1); setDragged({ key: narrow, nodes: start }); setSelected(null); setFit((n) => n + 1); };
  const onNodesChange = useCallback((c) => setDragged((d) => ({ key: narrow, nodes: applyNodeChanges(c, d.key === narrow ? d.nodes : start) })), [narrow, start]);

  const cur = step >= 0 ? STEPS[step] : null;
  const detailId = selected ?? (cur ? cur.nodes[cur.nodes.length - 1] : null);
  const detail = detailId ? FLOW.nodes.find((n) => n.id === detailId) : null;
  const edgeDefs = useMemo(() => FLOW.edges.map((e) => ({ ...e, ...(narrow ? FLOW.narrowEdges[e.id] : {}), label: narrow ? e.short : e.label })), [narrow]);
  const nodes = useMemo(() => {
    const used = (id) => [...new Set(edgeDefs.flatMap((e) => [e.source === id && e.sourceHandle, e.target === id && e.targetHandle]).filter(Boolean))];
    return moved.map((n) => ({ ...n, type: "box", data: { ...n.data, narrow, handles: used(n.id), on: !!cur?.nodes.includes(n.id), dim: !!cur && !cur.nodes.includes(n.id) } }));
  }, [moved, cur, edgeDefs, narrow]);
  const edges = useMemo(() => edgeDefs.map(({ short: _short, dashed, ...e }) => ({ ...e, type: "clear", animated: !!cur?.edges.includes(e.id), className: cur?.edges.includes(e.id) ? "edge-on" : "", markerEnd: { type: MarkerType.ArrowClosed }, ...(dashed ? { style: { strokeDasharray: "6 4" } } : {}) })), [cur, edgeDefs]);
  // On a phone the picture is shown whole at full size and the page scrolls past it; it is not a pan-and-zoom area.
  const height = narrow ? Math.max(...start.map((n) => n.position.y)) + 130 : undefined;

  return (
    <>
      <div className="card controls">
        <label>Speed<select value={speed} onChange={(e) => setSpeed(e.target.value)}>{SPEEDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
        <button type="button" className="btn primary" onClick={simulate} disabled={running}>Simulate</button>
        <button type="button" className="btn" onClick={reset}>Reset diagram</button>
      </div>
      <div className="flow-wrap" role="group" aria-label={FLOW.label} data-layout={narrow ? "narrow" : "wide"} style={height ? { height } : undefined}>
        <ReactFlow key={`${narrow}-${fit}`} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} colorMode={theme}
          fitView fitViewOptions={{ padding: narrow ? 0.04 : 0.12 }} nodesConnectable={false} onNodeClick={(_, n) => setSelected(n.id)} proOptions={{ hideAttribution: true }} minZoom={0.2}
          panOnDrag={!narrow} zoomOnScroll={!narrow} zoomOnPinch={!narrow} zoomOnDoubleClick={!narrow} preventScrolling={!narrow}>
          <Background />
          {!narrow && <Controls showInteractive={false} />}
        </ReactFlow>
      </div>
      <section className="card guide" aria-live="polite" aria-labelledby="guide-h" data-testid="guide">
        {detail ? (
          <>
            <h3 id="guide-h">{detail.data.title}</h3>
            <p>{detail.data.sub}</p>
            <p><strong>What this prevents:</strong> {detail.data.prevents}</p>
            {WIRE[detailId] && <WirePanel wire={WIRE[detailId]} />}
          </>
        ) : (
          <>
            <h3 id="guide-h">About each step</h3>
            <p>Click any box, or press Simulate, to see what that step does.</p>
          </>
        )}
      </section>
      {showLive && (
        <p className="caption" data-testid="gw-live">
          <strong>{BANNER}.</strong>{" "}
          {live?.error ? "The simulated gateway did not answer." : live ? `Right now, for ${live.caller} through the aggregate: ${live.listed} tool(s) listed and ${live.hidden} hidden (the audit above names them). Members: ${live.members.map((m) => `${m.alias} ${m.status}`).join(", ")}.` : "Asking the simulated gateway..."}
        </p>
      )}
      <p className="caption" role="status" aria-live="polite" data-testid="caption">
        {cur ? `Step ${step + 1} of ${STEPS.length}: ${cur.text}` : "Press Simulate to walk one run through the diagram."}
      </p>
    </>
  );
}
