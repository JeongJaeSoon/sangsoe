/// <reference lib="dom" />
// T3 probe panel: an inline SVG DAG drawn from data, plus the worker's probe report.
// TODO(U19): replaced by the hallmark panel (decision 92).

type Frame = { plugin: { request(name: string, input?: unknown): Promise<unknown> } };
declare const orca: Frame;

export type DagNode = { id: string; col: number; row: number };
export type DagEdge = { from: string; to: string };

const SAMPLE_NODES: DagNode[] = [
  { id: "U0", col: 0, row: 1 },
  { id: "U1", col: 1, row: 0 },
  { id: "U2", col: 1, row: 1 },
  { id: "U3", col: 1, row: 2 },
  { id: "U15", col: 2, row: 1 },
];
const SAMPLE_EDGES: DagEdge[] = [
  { from: "U0", to: "U1" },
  { from: "U0", to: "U2" },
  { from: "U0", to: "U3" },
  { from: "U2", to: "U15" },
  { from: "U3", to: "U15" },
];

const W = 64;
const H = 24;
const GX = 96;
const GY = 40;

export function dagSvg(nodes: readonly DagNode[], edges: readonly DagEdge[]): string {
  const at = new Map(nodes.map((n) => [n.id, { x: 8 + n.col * GX, y: 8 + n.row * GY }]));
  const cols = Math.max(0, ...nodes.map((n) => n.col)) + 1;
  const rows = Math.max(0, ...nodes.map((n) => n.row)) + 1;
  const lines = edges.flatMap((e) => {
    const a = at.get(e.from);
    const b = at.get(e.to);
    if (!a || !b) return [];
    return [`<path d="M${a.x + W} ${a.y + H / 2} L${b.x} ${b.y + H / 2}" stroke="var(--orca-border)" fill="none"/>`];
  });
  const boxes = nodes.map((n) => {
    const p = at.get(n.id) ?? { x: 0, y: 0 };
    return (
      `<g><rect x="${p.x}" y="${p.y}" width="${W}" height="${H}" rx="4" fill="var(--orca-card)" stroke="var(--orca-ring)"/>` +
      `<text x="${p.x + W / 2}" y="${p.y + H / 2 + 4}" text-anchor="middle" fill="var(--orca-card-foreground)" font-size="11">${n.id}</text></g>`
    );
  });
  const width = 16 + (cols - 1) * GX + W;
  const height = 16 + (rows - 1) * GY + H;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" aria-label="dependency graph">${lines.join("")}${boxes.join("")}</svg>`;
}

function mount(): void {
  document.body.style.cssText =
    "margin:0;padding:12px;font:12px system-ui;background:var(--orca-background);color:var(--orca-foreground)";
  const graph = document.createElement("div");
  graph.innerHTML = dagSvg(SAMPLE_NODES, SAMPLE_EDGES);
  const button = document.createElement("button");
  button.textContent = "Refresh probe report";
  const out = document.createElement("pre");
  out.style.cssText = "white-space:pre-wrap;font-size:11px";
  const refresh = () =>
    orca.plugin.request("probe.report").then(
      (r) => {
        out.textContent = JSON.stringify(r, null, 2);
      },
      (e: unknown) => {
        out.textContent = `probe.report failed: ${e instanceof Error ? e.message : String(e)}`;
      },
    );
  button.addEventListener("click", () => void refresh());
  document.body.append(graph, button, out);
  void refresh();
}

if (typeof document !== "undefined") mount();
