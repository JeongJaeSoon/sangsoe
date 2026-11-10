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
export type PanelView = {
  model: BriefModel;
  todo: TodoRow[];
  /** The refresh time the core drew in the local zone (decision 198); absent from an older core. */
  fresh?: { short: string; full: string };
};

/** Where the panel is: [] is 현황, then a group, then an item. */
export type Target = { group?: string; item?: string };
export const down = (stack: readonly Target[], t: Target): Target[] => [...stack, t];
export const back = (stack: readonly Target[]): Target[] => stack.slice(0, -1);
export const current = (stack: readonly Target[]): Target => stack[stack.length - 1] ?? {};
export const trail = (stack: readonly Target[]): string[] =>
  stack.length === 0 ? [] : ["현황", ...stack.map((t) => t.item ?? t.group ?? "")];

/** What a button asks the worker for; the worker hands it to the core unchanged. */
export type Act = { kind: "answer"; decision: string; choice: "recommended" } | { kind: "answer"; decision: string; text: string } | { kind: "done"; item: string };

/** The worker's answer to an act: every reply status comes with the core's label for it. */
export type Acted = { status: string; label: string };

/** The note after an act shows the label (decision 181's ⏳ 검증 대기), never the status key. */
export const actedNote = (a: Act, v: Acted): string => `${"decision" in a ? a.decision : a.item}: ${v.label}`;

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c] ?? c);
const attr = (v: unknown) => esc(JSON.stringify(v));
const DASH = '<span class="dash">—</span>';

/**
 * One short Korean line per refusal code (decision 198); the code, reason and fix stay in the title.
 * A code not listed reads as the generic line, never as the raw text.
 */
export const ERROR_LINE: Readonly<Record<string, string>> = {
  request_failed: "패널이 sangsoe 에 닿지 못했다. 새로 고침을 누른다.",
  core_unavailable: "sangsoe 코어를 열지 못했다. 터미널에서 sangsoe doctor 를 본다.",
  core_error: "sangsoe 코어가 오류로 끝났다. 되풀이되면 sangsoe doctor 를 본다.",
  orca_error: "Orca 가 답하지 않았다. 잠시 뒤 새로 고침을 누른다.",
  not_found: "이 묶음이나 항목은 이제 열려 있지 않다. 뒤로 가서 현황을 본다.",
  no_worktree: "터미널을 열 worktree 가 없다. 터미널에서 직접 실행한다.",
  open_failed: "Orca 가 터미널을 열지 못했다. 터미널에서 직접 실행한다.",
  bad_input: "패널이 알 수 없는 요청을 보냈다. 새로 고침을 누른다.",
  not_open: "이 결정은 이미 닫혔다. 새로 고침을 누른다.",
  no_recommendation: "추천 답이 없다. 다른 답으로 답한다.",
  not_owner_item: "오너의 할 일이 아니다. 맡은 쪽이 닫는다.",
  not_ready: "지금 완료할 수 있는 할 일이 아니다.",
};
const ERROR_OTHER = "sangsoe 가 요청을 처리하지 못했다.";

export type Refusal = { code: string; reason: string; fix: string };
export const errorLine = (r: Refusal): string => ERROR_LINE[r.code] ?? ERROR_OTHER;
const errorTitle = (r: Refusal): string => [r.code, r.reason, r.fix].filter(Boolean).join(" · ");

/** The one-line note a refusal leaves (an act or an open): Korean text, the raw refusal as its title. */
export function errorNote(r: Refusal): string {
  return `<p class="msg bad" role="status" title="${esc(errorTitle(r))}">${esc(errorLine(r))}</p>`;
}

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

// An empty section is its heading line alone, count 0 and "없음" on the same line (decision 169).
function section(id: string, t: Table, rows: string[], acts = false, hint = "", tab = ""): string {
  const empty = t.rows.length === 0;
  const h = empty ? '<span class="none">없음</span>' : hint ? `<span class="hint">${esc(hint)}</span>` : "";
  const attrs = `${empty ? ' class="nil"' : ""}${tab ? ` data-tab="${tab}"` : ""}`;
  const body = empty ? "" : tableHtml(t, rows, acts);
  return `<section aria-labelledby="h-${id}"${attrs}><div class="sec-h"><h2 id="h-${id}">${esc(t.title)} <span class="count">${t.count}</span></h2>${h}</div>${body}</section>`;
}

const btn = (label: string, act: Act | null, primary = false) =>
  `<button type="button" class="btn${primary ? " primary" : ""}"${act ? ` data-act="${attr(act)}"` : " disabled"}>${esc(label)}</button>`;

function overview(m: Overview, todo: readonly TodoRow[], pending: ReadonlySet<string>): string {
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
  // undelivered answer close on observed facts (decision 91①④), so their rows carry none. A row already
  // pressed into ⏳ 검증 대기 keeps its button off until the reading drops it (decision 198).
  const todoRows = m.ownerTodo.rows.map((r) => {
    const acts = kind.get(r.id) !== "owner_item" ? "" : pending.has(r.id) ? btn("⏳ 검증 대기", null) : btn("완료", { kind: "done", item: r.id });
    return rowHtml(m.ownerTodo, r, { idCol: true, acts });
  });
  const progress = m.inProgress.rows.map((r) => {
    if (r.id.startsWith("lead:")) return rowHtml(m.inProgress, r, { cls: "lead", nav: { group: r.cells[1]?.text ?? "" } });
    if (/^i\d{3,}$/.test(r.id)) return rowHtml(m.inProgress, r, { cls: "item", nav: { item: r.id } });
    return rowHtml(m.inProgress, r, { cls: "item" });
  });
  const s = m.summary;
  return [
    `<h1>현황 · 묶음 ${m.groups} · 내가 할 일 <span>${m.todo.total}</span> <span class="dim">(결정 ${m.todo.decisions} + 할 일 ${m.todo.other})</span></h1>`,
    `<p class="sumline">✅ 완료 ${s.done}건 · 🔄 진행 중 ${s.doing}건 · 남은 것 ${s.left}건 · 🚧 막힌 것 ${s.blocked}건</p>`,
    section("dec", m.decisions, decisions, true, "", "todo"),
    section("me", m.ownerTodo, todoRows, true, "", "todo"),
    section("prog", m.inProgress, progress, false, "우선순위, 오래된 🚧 순", "prog"),
    m.onHold ? section("hold", m.onHold, m.onHold.rows.map((r) => rowHtml(m.onHold as Table, r, { nav: { item: r.id } })), false, "", "prog") : "",
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

// Lucide paths (ISC), the set Orca's own panels draw with: `layers` is the manifest's panel icon.
const ICONS: Record<string, string> = {
  layers:
    '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  refresh:
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
};
export const icon = (name: string): string =>
  `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ""}</svg>`;

/** What a header button asks the worker to open in an Orca terminal; the worker builds the command. */
export type Open = { view: "brief"; group?: string; item?: string } | { view: "doctor" } | { view: "todo" };

const iconBtn = (name: string, label: string, data: string) =>
  `<button type="button" class="ibtn" ${data} aria-label="${esc(label)}" title="${esc(label)}">${icon(name)}</button>`;

// The header row (decision 169): title with the panel icon, last-updated time, refresh, open the
// full brief in a terminal, and an overflow menu. A plain <details> menu needs no script state.
function header(fresh: { short: string; full: string } | null, at: Target): string {
  const open: Open = { view: "brief", ...at };
  const stamp = fresh ? `<span class="fresh" title="${esc(fresh.full)}">${esc(fresh.short)}</span>` : "";
  const menu =
    `<details class="menu"><summary class="ibtn" aria-label="더 보기" title="더 보기">${icon("more")}</summary><div class="pop" role="menu">` +
    `<button type="button" role="menuitem" data-open="${attr({ view: "todo" })}">터미널에서 sangsoe todo</button>` +
    `<button type="button" role="menuitem" data-open="${attr({ view: "doctor" })}">터미널에서 sangsoe doctor</button></div></details>`;
  return (
    `<header class="top"><span class="brand">${icon("layers")}상쇠<small>sangsoe</small></span>` +
    stamp +
    `<span class="tools">${iconBtn("refresh", "새로 고침", "data-refresh")}${iconBtn("terminal", "터미널에서 전체 현황", `data-open="${attr(open)}"`)}${menu}</span></header>`
  );
}

/** Stage 1's views (decision 169): one table set, filtered by a segmented control. Counts are model fields. */
export const TABS = ["all", "todo", "prog"] as const;
export type Tab = (typeof TABS)[number];

function tabs(m: Overview, active: Tab): string {
  // The same number as the 진행 중 section heading; 보류 rides along in the view but is not counted.
  const prog = m.inProgress.count;
  const one = (t: Tab, label: string, n: number | null) =>
    `<button type="button" role="tab" aria-selected="${t === active}" data-tab-to="${t}">${label}${n === null ? "" : ` <span class="count">${n}</span>`}</button>`;
  return `<nav class="seg" role="tablist" aria-label="현황 보기">${one("all", "전체", null)}${one("todo", "할 일", m.todo.total)}${one("prog", "진행 중", prog)}</nav>`;
}

const backLine = (crumbs: readonly string[]) =>
  `<p class="crumbs"><button type="button" class="link" data-back>‹ 뒤로</button> ${crumbs.map(esc).join(" › ")}</p>`;

/** The body of one stage. `crumbs` is the way back; the entry wires data-nav, data-act, back and tabs. */
export function renderStage(
  v: PanelView,
  crumbs: readonly string[] = [],
  tab: Tab = "all",
  at: Target = {},
  pending: ReadonlySet<string> = new Set(),
): string {
  const m = v.model;
  const nav = m.stage === 1 ? tabs(m, tab) : backLine(crumbs);
  const body = m.stage === 1 ? overview(m, v.todo, pending) : m.stage === 2 ? group(m) : item(m);
  return `${header(v.fresh ?? null, at)}${nav}<main data-view="${m.stage === 1 ? tab : "all"}">${body}</main>`;
}

/**
 * A reading that failed (decision 198): the header and, below 현황, the back line stay, then one Korean
 * line and a 새로 고침 the owner presses; nothing re-reads by itself while the panel shows it.
 */
export function renderError(r: Refusal, crumbs: readonly string[] = [], at: Target = {}): string {
  const nav = crumbs.length > 0 ? backLine(crumbs) : "";
  const line = `<p class="msg bad" role="status" title="${esc(errorTitle(r))}">${esc(errorLine(r))} <button type="button" class="link" data-refresh>새로 고침</button></p>`;
  return `${header(null, at)}${nav}<main data-view="all">${line}</main>`;
}

/**
 * What the header's terminal button names. The `sangsoe brief` command takes `<group> [<iNNN>]`, so
 * the item only goes into it under a group; the item alone still names the worktree (decision 198 ②).
 */
export function openTarget(stack: readonly Target[]): Target {
  const group = [...stack].reverse().find((t) => t.group)?.group;
  const item = current(stack).item;
  return { ...(group ? { group } : {}), ...(item ? { item } : {}) };
}

/** Pressed items the reading no longer lists as owner items leave the pending set. */
export function prunePending(pending: Set<string>, todo: readonly TodoRow[]): void {
  for (const id of pending) if (!todo.some((t) => t.kind === "owner_item" && t.ref === id)) pending.delete(id);
}

/** The panel's own re-read interval, the status bar's (main.ts STATUS_INTERVAL_MS). */
export const REFRESH_MS = 30_000;

/**
 * Whether the panel re-reads by itself now (decision 198): only while it is shown, after a reading that
 * worked, with no act in flight and no 다른 답 form open (a redraw would wipe the typed words).
 */
export const autoRefresh = (s: { visible: boolean; lastOk: boolean; busy: boolean; formOpen: boolean }): boolean =>
  s.visible && s.lastOk && !s.busy && !s.formOpen;

/** Row ids in drawing order (PN2: the same list as the model's tables). */
export const drawnRowIds = (html: string): string[] => [...html.matchAll(/<tr data-id="([^"]*)"/g)].map((m) => m[1] ?? "");
