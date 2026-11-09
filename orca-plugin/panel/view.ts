// The panel's drawing (decision 92, hallmark-final): HTML strings from the BriefModel the worker sends.
// Every number shown is a field of the model; nothing here counts rows. Pure, so node tests import it.
// The model's shape is declared by hand: the plugin folder imports nothing from the core.

export type Cell = { text: string; link?: string; tail?: string; strong?: boolean };
export type Row = { id: string; cells: Cell[] };
export type Column = { name: string; max: number };
export type Table = { title: string; count: number; columns: Column[]; rows: Row[] };
export type Overview = {
  stage: 1;
  now: string;
  groups: number;
  todo: { total: number; decisions: number; other: number };
  summary: { done: number; doing: number; left: number; blocked: number };
  decisions: Table;
  ownerTodo: Table;
  inProgress: Table;
  onHold: Table | null;
  doneDays: number;
  evidenceShort: number;
};
export type GraphEdgeRow = { pred: string; succ: string; kind: string; met: boolean | null };
export type GroupDetail = {
  stage: 2;
  now: string;
  lead: string;
  priority: string;
  items: number;
  blockedCount: number;
  sections: Table[];
  doneFolded: number;
  edges: GraphEdgeRow[];
  criticalPath: string[];
  why: Table;
};
export type ItemDetail = {
  stage: 3;
  now: string;
  id: string;
  title: string;
  state: string;
  flags: string;
  who: string;
  priority: string;
  chain: Table;
};
export type BriefModel = Overview | GroupDetail | ItemDetail;
export type TodoRow = { kind: "decision" | "owner_item" | "waiting_human" | "undelivered_answer"; ref: string };
export type PanelView = { model: BriefModel; todo: TodoRow[] };

/** Where the panel is: [] is 현황, then a group, then an item. */
export type Target = { group?: string; item?: string };
export const down = (stack: readonly Target[], t: Target): Target[] => [...stack, t];
export const back = (stack: readonly Target[]): Target[] => stack.slice(0, -1);
export const current = (stack: readonly Target[]): Target => stack[stack.length - 1] ?? {};
export const trail = (stack: readonly Target[]): string[] =>
  stack.length === 0 ? [] : ["현황", ...stack.map((t) => t.item ?? t.group ?? "")];

/** What a button asks the worker for; the worker hands it to the core unchanged. */
export type Act = { kind: "answer"; decision: string; choice: "recommended" } | { kind: "answer"; decision: string; text: string } | { kind: "done"; item: string };

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c] ?? c);
const attr = (v: unknown) => esc(JSON.stringify(v));
const DASH = '<span class="dash">—</span>';
const stamp = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)} ${iso.slice(11, 16)}`;

function cellHtml(c: Cell): string {
  if (c.text === "—" && !c.link) return DASH;
  const body = esc(c.text) + (c.tail ? `<span class="pri">${esc(c.tail.trim())}</span>` : "");
  return c.link ? `<a href="${esc(c.link)}" target="_blank" rel="noreferrer">${body}</a>` : body;
}

type RowOpts = { cls?: string; nav?: Target; acts?: string; idCol?: boolean };

// Column 0 is the ID or state marker, column 1 the title; the rest carry their column name as the
// 360px label (decision 89: a narrow panel folds each row into one block, no column is dropped).
function rowHtml(t: Table, r: Row, o: RowOpts = {}): string {
  const [first, title, ...rest] = r.cells;
  const lead = o.idCol ? `<span class="id">${esc(first?.text ?? "")}</span>` : cellHtml(first ?? { text: "—" });
  const titleText = title ? (o.idCol ? cellHtml(title) : titleWithId(title)) : DASH;
  const tds = rest.map((c, i) => `<td data-l="${esc(t.columns[i + 2]?.name ?? "")}">${cellHtml(c)}</td>`).join("");
  const nav = o.nav ? ` data-nav="${attr(o.nav)}" tabindex="0"` : "";
  const acts = o.acts === undefined ? "" : `<td class="acts">${o.acts}</td>`;
  return `<tr data-id="${esc(r.id)}"${o.cls ? ` class="${o.cls}"` : ""}${nav}><td>${lead}</td><td class="title">${titleText}</td><td class="brk" aria-hidden="true"></td>${tds}${acts}</tr>`;
}

// "└ i033 스테이징 키 발급" → the id in the mono id style, the nesting mark left to CSS.
function titleWithId(c: Cell): string {
  const m = /^(?:└ )?(i\d{3,}) (.*)$/s.exec(c.text);
  if (!m) return cellHtml({ ...c, text: c.text.replace(/^└ /, "") });
  return `<span class="id">${esc(m[1] ?? "")}</span>${cellHtml({ ...c, text: m[2] ?? "" })}`;
}

function tableHtml(t: Table, rows: string[], acts: boolean): string {
  const head = t.columns.map((c) => `<th>${esc(c.name)}</th>`).join("") + (acts ? '<th><span class="sr">버튼</span></th>' : "");
  return `<table class="tbl"><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function section(id: string, t: Table, rows: string[], acts = false, hint = ""): string {
  const body = t.rows.length === 0 ? '<p class="empty">없음</p>' : tableHtml(t, rows, acts);
  const h = hint ? `<span class="hint">${esc(hint)}</span>` : "";
  return `<section aria-labelledby="h-${id}"><div class="sec-h"><h2 id="h-${id}">${esc(t.title)} <span class="count">${t.count}</span></h2>${h}</div>${body}</section>`;
}

const btn = (label: string, act: Act | null, primary = false) =>
  `<button type="button" class="btn${primary ? " primary" : ""}"${act ? ` data-act="${attr(act)}"` : " disabled"}>${esc(label)}</button>`;

function overview(m: Overview, todo: readonly TodoRow[]): string {
  const kind = new Map(todo.map((r) => [r.ref, r.kind]));
  const decisions = m.decisions.rows.map((r) => {
    const rec = r.cells[2]?.text ?? "—";
    const acts =
      `<button type="button" class="btn" data-other="${esc(r.id)}">다른 답</button>` +
      btn("추천대로 답", rec === "—" ? null : { kind: "answer", decision: r.id, choice: "recommended" }, true);
    const form = `<tr class="other" data-for="${esc(r.id)}" hidden><td colspan="7"><form data-answer="${esc(r.id)}"><input name="text" aria-label="${esc(r.id)} 답" placeholder="답"> <button class="btn primary" type="submit">보내기</button></form></td></tr>`;
    return rowHtml(m.decisions, r, { idCol: true, acts }) + form;
  });
  // Only an owner item has a core function behind its button (ownerDone); a waiting session and an
  // undelivered answer close on observed facts (decision 91①④), so their rows carry none.
  const todoRows = m.ownerTodo.rows.map((r) =>
    rowHtml(m.ownerTodo, r, { idCol: true, acts: kind.get(r.id) === "owner_item" ? btn("완료", { kind: "done", item: r.id }) : "" }),
  );
  const progress = m.inProgress.rows.map((r) => {
    if (r.id.startsWith("lead:")) return rowHtml(m.inProgress, r, { cls: "lead", nav: { group: r.cells[1]?.text ?? "" } });
    if (/^i\d{3,}$/.test(r.id)) return rowHtml(m.inProgress, r, { cls: "item", nav: { item: r.id } });
    return rowHtml(m.inProgress, r, { cls: "item" });
  });
  const s = m.summary;
  return [
    `<h1>현황 · ${stamp(m.now)} · 묶음 ${m.groups} · 내가 할 일 <span>${m.todo.total}</span> <span class="dim">(결정 ${m.todo.decisions} + 할 일 ${m.todo.other})</span></h1>`,
    `<p class="sumline">✅ 완료 ${s.done}건 · 🔄 진행 중 ${s.doing}건 · 남은 것 ${s.left}건 · 🚧 막힌 것 ${s.blocked}건</p>`,
    section("dec", m.decisions, decisions, true),
    section("me", m.ownerTodo, todoRows, true),
    section("prog", m.inProgress, progress, false, "우선순위, 오래된 🚧 순"),
    m.onHold ? section("hold", m.onHold, m.onHold.rows.map((r) => rowHtml(m.onHold as Table, r, { nav: { item: r.id } }))) : "",
    `<p class="foot">완료는 최근 ${m.doneDays}일 · 🔍 근거 부족 ${m.evidenceShort} · 상세: <code>sangsoe brief &lt;묶음&gt;</code></p>`,
  ].join("");
}

// Edge kinds differ by dash pattern and by name (the name is canonical, decision 92②).
export const EDGE_KINDS: Record<string, string> = {
  blocks: "끝나야 시작",
  after: "순서만",
  stacked_on: "스택 PR 아래층",
  deploys_after: "배포 순서",
};
const NW = 92;
const NH = 40;
const GX = 120;
const GY = 80;

/** Inline SVG DAG (decision 92②): layers by longest path from the edges, critical path numbered. */
export function dagSvg(edges: readonly GraphEdgeRow[], critical: readonly string[], label = "의존 그래프"): string {
  const nodes = [...new Set(edges.flatMap((e) => [e.pred, e.succ]))];
  const layer = new Map(nodes.map((n) => [n, 0]));
  for (let pass = 0; pass < nodes.length; pass++) {
    let moved = false;
    for (const e of edges) {
      const want = (layer.get(e.pred) ?? 0) + 1;
      if ((layer.get(e.succ) ?? 0) < want) {
        layer.set(e.succ, want);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const col = new Map<number, number>();
  const at = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const l = layer.get(n) ?? 0;
    const c = col.get(l) ?? 0;
    col.set(l, c + 1);
    at.set(n, { x: 4 + c * GX, y: 8 + l * GY });
  }
  const cols = Math.max(1, ...col.values());
  const rows = Math.max(0, ...layer.values()) + 1;
  const crit = new Map(critical.map((n, i) => [n, i + 1]));
  const onPath = (e: GraphEdgeRow) => {
    const a = crit.get(e.pred);
    const b = crit.get(e.succ);
    return a !== undefined && b !== undefined && Math.abs(a - b) === 1;
  };
  const paths = edges.map((e) => {
    const a = at.get(e.pred) ?? { x: 0, y: 0 };
    const b = at.get(e.succ) ?? { x: 0, y: 0 };
    const cls = ["ed", e.met === null ? "broken" : e.kind, onPath(e) ? "cp" : ""].filter(Boolean).join(" ");
    return `<path class="${cls}" data-edge="${esc(`${e.pred}>${e.succ}`)}" d="M${a.x + NW / 2} ${a.y + NH}L${b.x + NW / 2} ${b.y}"><title>${esc(`${e.pred} → ${e.succ} ${e.kind}`)}</title></path>`;
  });
  const boxes = nodes.map((n) => {
    const p = at.get(n) ?? { x: 0, y: 0 };
    const k = crit.get(n);
    const badge = k ? `<g class="badge" transform="translate(${p.x + NW} ${p.y})"><circle r="9"/><text y="3.5">${k}</text></g>` : "";
    return `<g class="nd${k ? " cp" : ""}" data-node="${esc(n)}" transform="translate(${p.x} ${p.y})"><rect width="${NW}" height="${NH}" rx="6"/><text class="n1" x="6" y="24">${esc(n)}</text></g>${badge}`;
  });
  const w = 8 + (cols - 1) * GX + NW + 12;
  const h = 16 + (rows - 1) * GY + NH;
  const defs =
    '<defs><marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path class="ah" d="M0 0L8 4L0 8z"/></marker>' +
    '<marker id="ahb" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path class="ahb" d="M0 0L8 4L0 8z"/></marker></defs>';
  return `<svg class="dag" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="max-width:${w}px" role="img" aria-label="${esc(label)}">${defs}${paths.join("")}${boxes.join("")}</svg>`;
}

function group(m: GroupDetail): string {
  const items = (t: Table) => t.rows.map((r) => rowHtml(t, r, { nav: { item: r.id } }));
  const critRows = m.criticalPath.map((n, i) => `<tr><td><span class="step">${i + 1}</span></td><td><span class="id">${esc(n)}</span></td></tr>`).join("");
  const legend = Object.entries(EDGE_KINDS)
    .map(([k, v]) => `<tr><td><svg viewBox="0 0 40 8"><line class="${k}" x1="0" y1="4" x2="40" y2="4"/></svg></td><td class="kind"><code>${k}</code></td><td>${esc(v)}</td></tr>`)
    .join("");
  const graph =
    m.edges.length === 0
      ? '<p class="empty">간선 없음</p>'
      : `${dagSvg(m.edges, m.criticalPath, `${m.lead} 의존 그래프`)}<div class="legend"><table class="tbl gt"><thead><tr><th>선 모양</th><th>간선</th><th>뜻</th></tr></thead><tbody>${legend}</tbody></table></div>`;
  return [
    `<h1>${esc(m.lead)} <span class="pri">${esc(m.priority)}</span> <span class="dim">· ${m.items}건 · 막힘 ${m.blockedCount}</span></h1>`,
    ...m.sections.map((t, i) => section(`s${i}`, t, items(t))),
    `<div class="gwrap"><div class="gl">${graph}</div><div class="side"><h3>크리티컬 패스</h3>${m.criticalPath.length === 0 ? '<p class="empty">없음</p>' : `<table class="tbl gt"><thead><tr><th>단계</th><th>항목</th></tr></thead><tbody>${critRows}</tbody></table>`}</div></div>`,
    section("why", m.why, m.why.rows.map((r) => rowHtml(m.why, r, { idCol: true }))),
    `<p class="foot">✅ 완료 ${m.doneFolded}건 접힘 · 터미널: <code>sangsoe brief ${esc(m.lead)}</code></p>`,
  ].join("");
}

function item(m: ItemDetail): string {
  const rows = m.chain.rows.map((r) => rowHtml(m.chain, r, { idCol: true }));
  return [
    `<h1>${esc(m.state)} <span class="id">${esc(m.id)}</span> ${esc(m.title)} ${esc(m.flags)}</h1>`,
    `<p class="sumline">누가 ${esc(m.who)} · <span class="pri">${esc(m.priority)}</span></p>`,
    section("chain", m.chain, rows),
  ].join("");
}

/** The body of one stage. `crumbs` is the way back; the entry wires data-nav, data-act and back. */
export function renderStage(v: PanelView, crumbs: readonly string[] = []): string {
  const m = v.model;
  const trail =
    crumbs.length === 0 ? "" : `<p class="crumbs"><button type="button" class="link" data-back>‹ 뒤로</button> ${crumbs.map(esc).join(" › ")}</p>`;
  const body = m.stage === 1 ? overview(m, v.todo) : m.stage === 2 ? group(m) : item(m);
  return `<header class="top"><span class="brand">상쇠<small>sangsoe</small></span><span class="fresh">갱신 ${stamp(m.now)}</span></header>${trail}<main>${body}</main>`;
}

/** Row ids in drawing order (PN2: the same list as the model's tables). */
export const drawnRowIds = (html: string): string[] => [...html.matchAll(/<tr data-id="([^"]*)"/g)].map((m) => m[1] ?? "");
