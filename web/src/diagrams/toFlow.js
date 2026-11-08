// Turns a diagram-studio/1 document into what the page draws.
//   Wide layout: the file's own x and y. An arrow leaves the side that faces its target (r to l on a row, t to b going up,
//   bb to tt going down).
//   Phone layout (600px and narrower): the boxes on the first row (the chain) stack in one column, 120px apart; any other
//   box sits beside the box it connects to, and its arrow runs sideways (ls to rt).
//   Steps: { edges: [arrow ids], nodes: [source, target of the last arrow], text }. The detail panel shows the last box.
const NARROW_X = 190;
const col = (i) => ({ x: 0, y: i * 120 });

export function toFlow(data) {
  const rowY = data.nodes[0].y;
  const chain = data.nodes.filter((n) => n.y === rowY);
  const narrow = Object.fromEntries(chain.map((n, i) => [n.id, col(i)]));
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const edgeNarrow = {};
  const edges = data.edges.map((e, i) => {
    const id = `${data.id.slice(0, 1)}${i + 1}`;
    const a = byId.get(e.source); const b = byId.get(e.target);
    const sameRow = a.y === b.y;
    const wide = sameRow ? { sourceHandle: b.x >= a.x ? "r" : "ls", targetHandle: b.x >= a.x ? "l" : "rt" } : b.y < a.y ? { sourceHandle: "t", targetHandle: "b" } : { sourceHandle: "bb", targetHandle: "tt" };
    const chainEdge = chain.includes(a) && chain.includes(b);
    edgeNarrow[id] = chainEdge ? { sourceHandle: "bb", targetHandle: "tt" } : { sourceHandle: "ls", targetHandle: "rt" };
    return { id, source: e.source, target: e.target, ...wide, label: e.label ?? "", short: String(i + 1), dashed: !!e.dashed };
  });
  for (const n of data.nodes) {
    if (narrow[n.id]) continue;
    const link = data.edges.find((e) => e.source === n.id || e.target === n.id);
    const other = link && (link.source === n.id ? link.target : link.source);
    narrow[n.id] = { x: NARROW_X, y: narrow[other]?.y ?? 0 };
  }
  const nodes = data.nodes.map((n) => ({ id: n.id, position: { x: n.x, y: n.y }, data: { title: n.label, sub: (n.sub ?? []).join(" "), prevents: n.prevents ?? "", group: n.group } }));
  return {
    id: data.id, label: `Diagram: ${data.nodes.map((n) => n.label.toLowerCase()).join(", ")}. Boxes can be dragged.`, nodes, edges, narrow, narrowEdges: edgeNarrow,
    steps: data.steps.map((s) => ({ edges: s.edges.map((i) => edges[i].id), nodes: [...new Set(s.edges.flatMap((i) => [edges[i].source, edges[i].target]))], text: s.what })),
  };
}
