// The panel's drawing (decision 92, hallmark-final): HTML strings from the BriefModel the worker sends.
// Every number shown is a field of the model; nothing here counts rows. Pure, so node tests import it.
// The model's shape is declared by hand: the plugin folder imports nothing from the core.

export type Cell = { text: string; link?: string; tail?: string; strong?: boolean };
export type Row = { id: string; cells: Cell[]; broken?: boolean };
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
  /** Absent from a core older than decision 199. */
  done?: Table;
};
export type GraphEdgeRow = { pred: string; succ: string; kind: string; met: boolean | null };
export type GraphNodeRow = { id: string; title: string; state: string; stateLabel?: string; flags: string; outside: string | null };
export type GroupFigures = {
  done: number;
  doneDays: number;
  doing: number;
  blocked: number;
  left: number;
  planned: number;
  ready: number;
  onHold: number;
  owner: number;
  flags: number;
};
/** Decision 199's parts; a core older than it sends none of them. */
export type GroupParts = {
  figures: GroupFigures;
  nodes: GraphNodeRow[];
  brokenEdges: string[];
  critical: Table;
  stack: Table;
  release: Table[];
  broken: Table;
  edgeList: Table;
  recent: Table;
  done: Table;
};
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
} & Partial<GroupParts>;
export type ItemDetail = {
  stage: 3;
  now: string;
  id: string;
  title: string;
  state: string;
  flags: string;
  who: string;
  priority: string;
  /** The item's group; absent from a core older than decision 219. */
  lead?: string;
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
// A second click on the row that opened this screen (a double click, or one during a slow read) stays put.
export const down = (stack: readonly Target[], t: Target): Target[] => {
  const c = current(stack);
  return stack.length > 0 && c.group === t.group && c.item === t.item ? [...stack] : [...stack, t];
};
export const back = (stack: readonly Target[]): Target[] => stack.slice(0, -1);
export const current = (stack: readonly Target[]): Target => stack[stack.length - 1] ?? {};
/**
 * The last reading of each screen on the stack (decision 219 (10)): back and a step down to a screen
 * already read paint from it at once, and the fresh reading that follows repaints only what changed.
 * Screens off the stack are dropped, so it holds at most the stack's depth plus 현황.
 */
export function screenMemo() {
  const views = new Map<string, PanelView>();
  const key = (t: Target) => JSON.stringify([t.group ?? null, t.item ?? null]);
  return {
    get: (t: Target): PanelView | undefined => views.get(key(t)),
    put(t: Target, v: PanelView, stack: readonly Target[]): void {
      views.set(key(t), v);
      const keep = new Set([key({}), ...stack.map(key)]);
      for (const k of views.keys()) if (!keep.has(k)) views.delete(k);
    },
    get size() {
      return views.size;
    },
  };
}

/** The click stack's trail: only for a failed reading, which has no model to say where it is. */
export const trail = (stack: readonly Target[]): string[] =>
  stack.length === 0 ? [] : ["현황", ...stack.map((t) => t.item ?? t.group ?? "")];

/**
 * Where the shown screen sits, not how the owner got there (decision 219 (11)): 현황 › group › item.
 * Back still walks the click stack.
 */
export function placeTrail(m: BriefModel): string[] {
  if (m.stage === 1) return [];
  if (m.stage === 2) return ["현황", m.lead];
  return ["현황", ...(m.lead ? [m.lead] : []), m.id];
}

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

/** `num`: the index among the cells after the title of a number that rides the card's head line. */
type RowOpts = { cls?: string; nav?: Target; acts?: string; idCol?: boolean; go?: string; label?: string; num?: number };

const isNil = (c: Cell) => c.text === "—" && !c.link;

// Column 0 is the ID or state marker, column 1 the title; the rest carry their column name as the
// 360px label (decision 89: a narrow panel folds each row into one card, no column is dropped).
// An empty value keeps its cell, marked `nil`, so a wide table keeps its columns (decision 222 (20)).
function rowHtml(t: Table, r: Row, o: RowOpts = {}): string {
  const [first, title, ...rest] = r.cells;
  const lead = o.idCol ? `<span class="id">${esc(first?.text ?? "")}</span>` : cellHtml(first ?? { text: "—" });
  const go = o.go ? `<span class="go" aria-hidden="true">${esc(o.go)} ›</span>` : "";
  const titleText = go + (title ? (o.idCol ? cellHtml(title) : titleWithId(title)) : DASH);
  const full = [o.idCol ? first?.text : "", (title?.text ?? "").replace(/^└ /, "")].filter(Boolean).join(" ");
  const tds = rest
    .map((c, i) => {
      const cls = i === o.num ? "num" : isNil(c) ? "nil" : "";
      return `<td data-l="${esc(t.columns[i + 2]?.name ?? "")}"${cls ? ` class="${cls}"` : ""}>${cellHtml(c)}</td>`;
    })
    .join("");
  const bare = rest.length > 0 && rest.every((c, i) => i === o.num || isNil(c));
  const cls = [o.cls, bare ? "bare" : ""].filter(Boolean).join(" ");
  const nav = o.nav ? ` data-nav="${attr(o.nav)}" tabindex="0"${o.label ? ` aria-label="${esc(o.label)}"` : ""}` : "";
  const acts = o.acts === undefined ? "" : `<td class="acts">${o.acts}</td>`;
  return `<tr data-id="${esc(r.id)}"${cls ? ` class="${cls}"` : ""}${nav}><td>${lead}</td><td class="title" title="${esc(full)}">${titleText}</td><td class="brk" aria-hidden="true"></td>${tds}${acts}</tr>`;
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
    // No question, nothing to answer: a broken record row with its id and no buttons (decision 219).
    if (r.broken || !r.cells[1] || r.cells[1].text === "—") return rowHtml(m.decisions, r, { idCol: true, cls: "broken", acts: "" });
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
    if (r.id.startsWith("lead:")) {
      const group = r.cells[1]?.text ?? "";
      return rowHtml(m.inProgress, r, { cls: "lead", nav: { group }, go: "자세히", label: `${group} 묶음 자세히`, num: 1 });
    }
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
    m.groups === 0 ? `<p class="hint0" data-tab="prog">${esc(NO_GROUP)}</p>` : "",
    m.onHold ? section("hold", m.onHold, m.onHold.rows.map((r) => rowHtml(m.onHold as Table, r, { nav: { item: r.id } })), false, "", "prog") : "",
    m.done ? doneFold(m.done) : "",
    `<p class="foot">완료는 최근 ${m.doneDays}일 · 🔍 근거 부족 ${m.evidenceShort} · 상세: <code>sangsoe brief &lt;묶음&gt;</code></p>`,
  ].join("");
}

// The chat text says the first two sentences (core/brief/render.ts NO_GROUP); test/brief/brief-text-199 holds the prefix.
const NO_GROUP =
  "묶음이 아직 없다. 묶음은 리드 하나의 일이라, 오케스트레이터가 리드를 띄우면 생기고 여기 열린 항목 절에 그 행이 나온다. 패널은 리드를 띄우지 않는다.";

/** 완료 최근 N일 as one folded list (decision 199): the same rows as the ✅ count. */
function doneFold(t: Table): string {
  const items = t.rows.map((r) => {
    const [what, pr, when] = r.cells;
    const link = pr && pr.text !== "—" ? ` ${cellHtml(pr)}` : "";
    return `<li><span>${what ? titleWithId(what) : ""}${link}</span><span class="when">${esc(when?.text ?? "")}</span></li>`;
  });
  const body = items.length === 0 ? '<p class="empty">없음</p>' : `<ul class="done">${items.join("")}</ul>`;
  return `<details class="fold"><summary>${esc(t.title)} <span class="count">${t.count}</span></summary>${body}</details>`;
}

// Edge kinds differ by dash pattern and by name (the name is canonical, decision 92②); the last two
// rows are the drawing's own marks, so a reader never has to guess what thick or red means.
export const EDGE_KINDS: Record<string, string> = {
  blocks: "선행이 ✅ 완료여야 시작",
  after: "순서만. 취소도 충족",
  stacked_on: "선행 PR 이 머지된 뒤",
  deploys_after: "선행 머지와 앞 단계의 stage_recorded 뒤",
};
const MARKS: readonly [string, string, string][] = [
  ["cpl", "굵은 선", "크리티컬 패스"],
  ["brl", "붉은 점선", "끊긴 선행: 충족으로 보지 않고 리드가 푼다"],
];

const NW = 120;
const NH = 40;
const GAP = 20;
const DW = 10;
const ROW = NH + 48;
const PAD = 12;

// The panel imports nothing from the core, so text width is estimated here: wide (Hangul, emoji) and
// narrow glyphs at the node's 11px.
const glyphW = (ch: string) => (/[ᄀ-ᇿ　-鿿가-힯豈-﫿]|\p{Extended_Pictographic}/u.test(ch) ? 11 : 6.2);
export const textPx = (s: string): number => [...s].reduce((n, ch) => n + glyphW(ch), 0);
export function fitText(s: string, px: number): string {
  if (textPx(s) <= px) return s;
  let out = "";
  for (const ch of s) {
    if (textPx(`${out}${ch}…`) > px) break;
    out += ch;
  }
  return `${out}…`;
}
export const NODE_TEXT_PX = NW - 12;

export type Pt = { x: number; y: number };
export type DagBox = { id: string; x: number; y: number; layer: number };
export type DagRoute = { edge: GraphEdgeRow; points: Pt[] };
export type DagLabel = { edge: string; text: string; x: number; y: number; w: number };
export type DagLayout = { w: number; h: number; boxes: DagBox[]; routes: DagRoute[]; labels: DagLabel[]; crossings: number };

const edgeKey = (e: GraphEdgeRow) => `${e.pred}>${e.succ}:${e.kind}`;

/**
 * Layered layout (decision 199): longest-path layers with sources pulled down next to what they feed,
 * a placeholder per layer an edge passes so a long edge runs between boxes, barycenter sweeps for
 * the order, then x set toward the neighbours. Only item nodes are placed; other preds are references.
 */
export function dagLayout(nodes: readonly GraphNodeRow[], allEdges: readonly GraphEdgeRow[], brokenKeys: readonly string[] = []): DagLayout {
  const ids = nodes.map((n) => n.id);
  const known = new Set(ids);
  const edges = allEdges.filter((e) => known.has(e.pred) && known.has(e.succ));
  const layer = new Map(ids.map((n) => [n, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
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
  for (const n of ids) {
    if (edges.some((e) => e.succ === n)) continue;
    const below = edges.filter((e) => e.pred === n).map((e) => layer.get(e.succ) ?? 0);
    if (below.length > 0) layer.set(n, Math.min(...below) - 1);
  }
  const depth = Math.max(0, ...layer.values()) + 1;
  const rows: string[][] = Array.from({ length: depth }, () => []);
  for (const n of ids) rows[layer.get(n) ?? 0]?.push(n);
  const chains = edges.map((e, i) => {
    const a = layer.get(e.pred) ?? 0;
    const b = layer.get(e.succ) ?? 0;
    const mid = Array.from({ length: Math.max(0, b - a - 1) }, (_, k) => {
      const key = `~${i}:${k}`;
      rows[a + k + 1]?.push(key);
      return key;
    });
    return [e.pred, ...mid, e.succ];
  });
  const segs = chains.flatMap((c) => c.slice(1).map((b, k) => [c[k] as string, b] as const));
  const up = new Map<string, string[]>();
  const down = new Map<string, string[]>();
  for (const [a, b] of segs) {
    up.set(b, [...(up.get(b) ?? []), a]);
    down.set(a, [...(down.get(a) ?? []), b]);
  }
  const pos = () => new Map(rows.flatMap((r) => r.map((k, i) => [k, i] as const)));
  const cross = (): number => {
    const p = pos();
    let n = 0;
    for (const [a, b] of segs) {
      for (const [c, d] of segs) {
        if ((p.get(a) ?? 0) < (p.get(c) ?? 0) && (p.get(b) ?? 0) > (p.get(d) ?? 0) && layerOf(a) === layerOf(c)) n++;
      }
    }
    return n;
  };
  const layerOf = (k: string) => rows.findIndex((r) => r.includes(k));
  const sweep = (l: number, nbr: Map<string, string[]>) => {
    const p = pos();
    const row = rows[l] as string[];
    const bc = new Map(row.map((k, i) => {
      const ns = nbr.get(k) ?? [];
      return [k, ns.length === 0 ? i : ns.reduce((s, x) => s + (p.get(x) ?? 0), 0) / ns.length] as const;
    }));
    row.sort((a, b) => (bc.get(a) ?? 0) - (bc.get(b) ?? 0));
  };
  let best = rows.map((r) => [...r]);
  let bestN = cross();
  for (let it = 0; it < 8 && bestN > 0; it++) {
    for (let l = 1; l < depth; l++) sweep(l, up);
    for (let l = depth - 2; l >= 0; l--) sweep(l, down);
    const n = cross();
    if (n < bestN) {
      bestN = n;
      best = rows.map((r) => [...r]);
    }
  }
  for (let l = 0; l < depth; l++) rows[l] = best[l] as string[];

  const width = (k: string) => (k.startsWith("~") ? DW : NW);
  const x = new Map<string, number>();
  for (const r of rows) {
    let at = PAD;
    for (const k of r) {
      x.set(k, at);
      at += width(k) + GAP;
    }
  }
  const centre = (k: string) => (x.get(k) ?? 0) + width(k) / 2;
  for (let it = 0; it < 6; it++) {
    for (const [l, r] of rows.entries()) {
      const nbr = it % 2 === 0 ? up : down;
      let floor = PAD;
      for (const k of r) {
        const ns = (nbr.get(k) ?? []).filter((n) => layerOf(n) !== l);
        const want = ns.length === 0 ? (x.get(k) ?? 0) : ns.reduce((s, n) => s + centre(n), 0) / ns.length - width(k) / 2;
        const placed = Math.max(floor, want);
        x.set(k, placed);
        floor = placed + width(k) + GAP;
      }
    }
  }
  const minX = Math.min(...x.values());
  for (const [k, v] of x) x.set(k, v - minX + PAD);
  const top = (l: number) => PAD + l * ROW;
  const boxes = ids.map((id) => ({ id, x: x.get(id) ?? 0, y: top(layer.get(id) ?? 0), layer: layer.get(id) ?? 0 }));
  const at = new Map(boxes.map((b) => [b.id, b]));
  // Several edges on one side of a box leave or enter it at spread ports, not one point.
  const port = (id: string, list: readonly GraphEdgeRow[], e: GraphEdgeRow) => {
    const i = list.indexOf(e);
    return (at.get(id)?.x ?? 0) + NW / 2 + (i - (list.length - 1) / 2) * Math.min(16, (NW - 24) / Math.max(1, list.length - 1));
  };
  const outOf = (id: string) => edges.filter((e) => e.pred === id).sort((a, b) => centreOf(chains, edges, a, x) - centreOf(chains, edges, b, x));
  const into = (id: string) => edges.filter((e) => e.succ === id).sort((a, b) => sourceOf(chains, edges, a, x) - sourceOf(chains, edges, b, x));
  const routes: DagRoute[] = edges.map((e, i) => {
    const c = chains[i] as string[];
    const a = at.get(e.pred) as DagBox;
    const b = at.get(e.succ) as DagBox;
    const mids = c.slice(1, -1).flatMap((k, j) => {
      const cx = (x.get(k) ?? 0) + DW / 2;
      return [{ x: cx, y: top(a.layer + j + 1) }, { x: cx, y: top(a.layer + j + 1) + NH }];
    });
    return { edge: e, points: [{ x: port(e.pred, outOf(e.pred), e), y: a.y + NH }, ...mids, { x: port(e.succ, into(e.succ), e), y: b.y }] };
  });
  const labels: DagLabel[] = [];
  const hit = (l: DagLabel) => labels.some((o) => Math.abs(o.x - l.x) * 2 < o.w + l.w + 4 && Math.abs(o.y - l.y) < 16);
  for (const r of routes) {
    const text = brokenKeys.includes(edgeKey(r.edge)) ? "끊긴 선행" : r.edge.kind;
    const w = textPx(text) * 0.82 + 10;
    const gaps = r.points.flatMap((p, i) => (i % 2 === 0 && r.points[i + 1] ? [[p, r.points[i + 1] as Pt] as const] : []));
    let chosen: DagLabel | null = null;
    for (const [p, q] of [...gaps, ...gaps.slice().reverse()]) {
      for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        const cand = { edge: edgeKey(r.edge), text, ...onCurve(p, q, t), w };
        if (!hit(cand)) {
          chosen = cand;
          break;
        }
      }
      if (chosen) break;
    }
    const [p, q] = gaps[0] as readonly [Pt, Pt];
    labels.push(chosen ?? { edge: edgeKey(r.edge), text, x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, w });
  }
  const right = Math.max(PAD, ...[...x.entries()].map(([k, v]) => v + width(k)), ...labels.map((l) => l.x + l.w / 2));
  return { w: Math.ceil(right + PAD + 10), h: top(depth - 1) + NH + PAD, boxes, routes, labels, crossings: bestN };
}

// A point on curve()'s cubic between p and q: both control points sit at the middle height.
function onCurve(p: Pt, q: Pt, t: number): Pt {
  const my = (p.y + q.y) / 2;
  return { x: p.x + (q.x - p.x) * (3 * t * t - 2 * t * t * t), y: (1 - t) ** 3 * p.y + 3 * (1 - t) * t * my + t ** 3 * q.y };
}
function centreOf(chains: readonly string[][], edges: readonly GraphEdgeRow[], e: GraphEdgeRow, x: ReadonlyMap<string, number>): number {
  const c = chains[edges.indexOf(e)] as string[];
  return x.get(c[1] as string) ?? 0;
}
function sourceOf(chains: readonly string[][], edges: readonly GraphEdgeRow[], e: GraphEdgeRow, x: ReadonlyMap<string, number>): number {
  const c = chains[edges.indexOf(e)] as string[];
  return x.get(c[c.length - 2] as string) ?? 0;
}

function curve(points: readonly Pt[]): string {
  const [first, ...rest] = points as [Pt, ...Pt[]];
  let d = `M${first.x.toFixed(1)} ${first.y}`;
  let prev = first;
  for (const p of rest) {
    if (p.x === prev.x) d += `L${p.x.toFixed(1)} ${p.y}`;
    else {
      const my = (prev.y + p.y) / 2;
      d += `C${prev.x.toFixed(1)} ${my} ${p.x.toFixed(1)} ${my} ${p.x.toFixed(1)} ${p.y}`;
    }
    prev = p;
  }
  return d;
}

const STATE_CLASS: Record<string, string> = { "🚧": "s-blocked", "🔄": "s-progress", "⏳": "s-progress", "🗑️": "gone", "✅": "s-done" };

/** Inline SVG DAG (decision 92②, 199): item boxes with state and title, a label per edge, critical path numbered. */
export function dagSvg(m: Pick<GroupDetail, "edges" | "criticalPath"> & Pick<GroupParts, "nodes" | "brokenEdges">, label = "의존 그래프"): string {
  const L = dagLayout(m.nodes, m.edges, m.brokenEdges);
  const node = new Map(m.nodes.map((n) => [n.id, n]));
  const crit = new Map(m.criticalPath.map((n, i) => [n, i + 1]));
  const onPath = (e: GraphEdgeRow) => {
    const a = crit.get(e.pred);
    const b = crit.get(e.succ);
    return a !== undefined && b !== undefined && b === a + 1;
  };
  const paths = L.routes.map(({ edge: e, points }) => {
    const broken = m.brokenEdges.includes(edgeKey(e));
    const cls = ["ed", e.kind, broken ? "broken" : "", onPath(e) ? "cp" : ""].filter(Boolean).join(" ");
    return `<path class="${esc(cls)}" data-edge="${esc(edgeKey(e))}" d="${curve(points)}"><title>${esc(`${e.pred} → ${e.succ} ${e.kind}${broken ? " 끊긴 선행" : ""}`)}</title></path>`;
  });
  const labels = L.labels.map(
    (l) =>
      `<g class="lb${l.text === "끊긴 선행" ? " broken" : ""}" transform="translate(${l.x.toFixed(1)} ${l.y.toFixed(1)})"><rect x="${(-l.w / 2).toFixed(1)}" y="-7" width="${l.w.toFixed(1)}" height="14" rx="3"/><text y="3">${esc(l.text)}</text></g>`,
  );
  const boxes = L.boxes.map((b) => {
    const n = node.get(b.id) as GraphNodeRow;
    const k = crit.get(b.id);
    const cls = ["nd", STATE_CLASS[n.state] ?? "s-planned", n.outside ? "ext" : "", k ? "cp" : ""].filter(Boolean).join(" ");
    const head = [n.id, n.state, n.flags].filter(Boolean).join(" ");
    const tip = [`${n.id} ${n.title} ${n.state}${n.flags}`, n.outside ? `외부 선행 (${n.outside})` : "", k ? `크리티컬 패스 ${k}번` : ""].filter(Boolean).join(", ");
    const badge = k ? `<g class="badge" transform="translate(${b.x + NW} ${b.y})"><circle r="9"/><text y="3.5">${k}</text></g>` : "";
    return (
      `<g class="${cls}" data-node="${esc(b.id)}" transform="translate(${b.x} ${b.y})"><title>${esc(tip)}</title><rect width="${NW}" height="${NH}" rx="6"/>` +
      `<text class="n1" x="6" y="16">${esc(fitText(head, NODE_TEXT_PX))}</text><text class="n2" x="6" y="32">${esc(fitText(n.outside ? `${n.outside} · ${n.title}` : n.title, NODE_TEXT_PX))}</text></g>${badge}`
    );
  });
  const defs =
    '<defs><marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto"><path class="ah" d="M0 0L8 4L0 8z"/></marker>' +
    '<marker id="ahb" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto"><path class="ahb" d="M1 1L9 5L1 9M5 1V9"/></marker></defs>';
  return `<svg class="dag" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L.w} ${L.h}" style="max-width:${L.w}px" role="img" aria-label="${esc(label)}">${defs}${paths.join("")}${boxes.join("")}${labels.join("")}</svg>`;
}

/**
 * A column's role sets its width rule in every graph table (decision 220 (14)): short cells stay on
 * one line, item cells (an id, its title) and the long text share the rest.
 */
type Role = "step" | "kind" | "short" | "item" | "text";
const ROLE_CLASS: Record<Role, string> = { step: "nw", kind: "kind nw", short: "nw", item: "it", text: "tx" };

// Graph tables label every cell (hallmark's .gt), so a folded row never runs a name into its meaning.
type GtOpts = {
  roles: readonly Role[];
  /** The cells that title a row's card in a narrow panel (decision 220 (15)). */
  head?: readonly number[];
  titles?: ReadonlyMap<string, string>;
  /** Each item's own state: the title's item gets it when no head cell already shows it. */
  states?: ReadonlyMap<string, { mark: string; label: string }>;
  /** [state column, the column naming whose state it is]: a bare marker there gets its word. */
  stateOf?: readonly [number, number];
  labels?: ReadonlyMap<string, string>;
};

function gtTable(t: Table, o: GtOpts): string {
  const head = t.columns.map((c) => `<th>${esc(c.name)}</th>`).join("");
  const rows = t.rows.map((r) => {
    const tds = r.cells.map((cell, i) => {
      const name = esc(t.columns[i]?.name ?? "");
      const role = o.roles[i] ?? "text";
      const cls = `${ROLE_CLASS[role]}${o.head?.includes(i) ? " hd" : ""}${isNil(cell) ? " nil" : ""}`;
      const word = o.stateOf?.[0] === i ? o.labels?.get(r.cells[o.stateOf[1]]?.text ?? "") : undefined;
      const c = word?.startsWith(cell.text) ? { ...cell, text: word } : cell;
      const open = `<td data-l="${name}" class="${cls}">`;
      if (role === "step") return `${open}<span class="step">${esc(c.text)}</span></td>`;
      if (role === "kind") return `${open}${esc(c.text)}</td>`;
      const titled = role === "item" && o.titles?.has(c.text) ? { ...c, text: `${c.text} ${o.titles.get(c.text)}` } : c;
      const body = /^i\d{3,} /.test(titled.text) ? titleWithId(titled) : cellHtml(titled);
      return `${open}${body}${o.head?.includes(i) ? headState(c.text, r, o) : ""}</td>`;
    });
    // The title line's rule in a narrow card; hidden in a wide table.
    if (o.head?.length) tds.splice(Math.max(...o.head) + 1, 0, '<td class="brk" aria-hidden="true"></td>');
    return `<tr data-id="${esc(r.id)}"${r.broken ? ' class="broken"' : ""}>${tds.join("")}</tr>`;
  });
  return `<table class="tbl gt"><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function headState(text: string, r: Row, o: GtOpts): string {
  const s = o.states?.get(/^(i\d{3,})\b/.exec(text)?.[1] ?? "");
  if (!s || r.cells.some((c, i) => o.head?.includes(i) && c.text.includes(s.mark))) return "";
  return `<span class="hs">${esc(s.label)}</span>`;
}

function gtSection(id: string, t: Table, body: string, hint = ""): string {
  const empty = t.rows.length === 0;
  const h = empty ? '<span class="none">없음</span>' : hint ? `<span class="hint">${hint}</span>` : "";
  return `<section aria-labelledby="h-${id}"${empty ? ' class="nil"' : ""}><div class="sec-h"><h2 id="h-${id}">${esc(t.title)} <span class="count">${t.count}</span></h2>${h}</div>${empty ? "" : body}</section>`;
}

const sub = (t: Table, body: string, note = "") =>
  t.rows.length === 0 ? "" : `<div><h3>${esc(t.title)}${note ? ` <span class="note">${esc(note)}</span>` : ""}</h3>${body}</div>`;

function figures(m: GroupDetail, f: GroupFigures): string {
  const fig = (dt: string, dd: string, cls = "") => `<div${cls ? ` class="${cls}"` : ""}><dt>${esc(dt)}</dt><dd>${dd}</dd></div>`;
  // Decision 218: the three cells that add up to the title's 열린 N건 come first; ✅ is set apart after them.
  return (
    `<dl class="figs" aria-label="묶음 요약">${fig("우선순위", esc(m.priority))}${fig("🔄 진행 중", String(f.doing))}${fig("🚧 막힘", String(f.blocked))}` +
    `${fig("남은 것", `${f.left} <small>📅 ${f.planned}, 🟢 ${f.ready}, ⏸️ ${f.onHold}</small>`)}${fig(`✅ ${f.doneDays}일`, String(f.done), "aside")}` +
    `${fig("🙋 오너", String(f.owner))}${fig("🚨 플래그", String(f.flags))}</dl>`
  );
}

function legend(): string {
  const line = (cls: string) => `<svg viewBox="0 0 40 8" aria-hidden="true"><line class="${cls}" x1="0" y1="4" x2="40" y2="4"/></svg>`;
  const rows = [
    ...Object.entries(EDGE_KINDS).map(
      ([k, v]) => `<tr><td data-l="선 모양" class="nw hd">${line(k)}</td><td data-l="간선" class="kind nw hd">${k}</td><td class="brk" aria-hidden="true"></td><td data-l="뜻" class="tx">${esc(v)}</td></tr>`,
    ),
    ...MARKS.map(
      ([cls, name, v]) => `<tr><td data-l="선 모양" class="nw hd">${line(cls)}</td><td data-l="간선" class="nw hd">${name}</td><td class="brk" aria-hidden="true"></td><td data-l="뜻" class="tx">${esc(v)}</td></tr>`,
    ),
  ];
  return `<details class="legend"><summary>간선 종류</summary><table class="tbl gt"><thead><tr><th>선 모양</th><th>간선</th><th>뜻</th></tr></thead><tbody>${rows.join("")}</tbody></table></details>`;
}

function group(m: GroupDetail): string {
  const items = (t: Table) => t.rows.map((r) => rowHtml(t, r, { nav: { item: r.id } }));
  const nodes = m.nodes ?? [];
  const titles = new Map(nodes.map((n) => [n.id, n.title]));
  const labels = new Map(nodes.flatMap((n) => (n.stateLabel ? [[n.id, n.stateLabel] as const] : [])));
  const states = new Map(nodes.map((n) => [n.id, { mark: n.state, label: n.stateLabel ?? n.state }]));
  const refs = m.edges.filter((e) => !titles.has(e.pred));
  const refLine =
    refs.length === 0
      ? ""
      : `<p class="note refs">그림 밖 선행: ${refs.map((e) => `<code>${esc(e.pred)}</code> → ${esc(e.succ)} (${esc(e.kind)})`).join(", ")}</p>`;
  const graph =
    m.edges.length === 0
      ? '<p class="empty">간선 없음</p>'
      : `${nodes.length > 0 ? dagSvg({ edges: m.edges, criticalPath: m.criticalPath, nodes, brokenEdges: m.brokenEdges ?? [] }, `${m.lead} 의존 그래프.${m.criticalPath.length > 0 ? ` 크리티컬 패스는 ${m.criticalPath.join(", ")} 순서.` : ""}`) : ""}${refLine}${legend()}`;
  const side = [
    m.critical ? sub(m.critical, gtTable(m.critical, { roles: ["step", "item", "short", "text"], head: [0, 1, 2] })) : "",
    m.stack ? sub(m.stack, gtTable(m.stack, { roles: ["short", "short", "item", "short"], head: [0, 2, 3] })) : "",
    ...(m.release ?? []).map((t) => sub(t, gtTable(t, { roles: ["kind", "text", "item"], head: [0] }))),
    m.broken ? sub(m.broken, gtTable(m.broken, { roles: ["item", "item", "text"], head: [0], titles, states })) : "",
  ].join("");
  return [
    `<h1>${esc(m.lead)} <span class="pri">${esc(m.priority)}</span> <span class="dim">· 열린 ${m.items}건 · 막힘 ${m.blockedCount}</span></h1>`,
    m.figures ? figures(m, m.figures) : "",
    `<section aria-labelledby="h-graph"><div class="sec-h"><h2 id="h-graph">의존 그래프</h2><span class="hint">위에서 아래로. 굵은 선과 번호가 크리티컬 패스</span></div>`,
    `<div class="gwrap"><div class="gl">${graph}</div><div class="side">${side}</div></div></section>`,
    gtSection(
      "why",
      m.why,
      gtTable(m.why, { roles: ["item", "item", "kind", "short", "text"], head: [0], titles, states, stateOf: [3, 1], labels }),
      "<code>sangsoe graph why</code>",
    ),
    // An edge's card is titled by the item it holds back.
    m.edgeList ? gtSection("edges", m.edgeList, gtTable(m.edgeList, { roles: ["kind", "item", "item", "text"], head: [2], states })) : "",
    ...m.sections.map((t, i) => section(`s${i}`, t, items(t))),
    m.recent ? gtSection("recent", m.recent, gtTable(m.recent, { roles: ["short", "item", "text"], head: [1] })) : "",
    m.done ? doneFold(m.done) : "",
    `<p class="foot">터미널: <code>sangsoe brief ${esc(m.lead)}</code></p>`,
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
export type Open = { view: "brief"; group?: string; item?: string } | { view: "doctor" } | { view: "todo" } | { view: "models" };

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
    `<button type="button" role="menuitem" data-open="${attr({ view: "models" })}">터미널에서 sangsoe models</button>` +
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
  // The section's own title and number; 보류 rides along in the view but is not counted.
  const prog = m.inProgress.count;
  const one = (t: Tab, label: string, n: number | null) =>
    `<button type="button" role="tab" aria-selected="${t === active}" data-tab-to="${t}">${label}${n === null ? "" : ` <span class="count">${n}</span>`}</button>`;
  return `<nav class="seg" role="tablist" aria-label="현황 보기">${one("all", "전체", null)}${one("todo", "할 일", m.todo.total)}${one("prog", m.inProgress.title, prog)}</nav>`;
}

// The last crumb is the screen shown, once and not a link; the back button sits apart (decision 218).
const backLine = (crumbs: readonly string[]) => {
  const items = crumbs.map((c, i) => (i === crumbs.length - 1 ? `<li aria-current="page">${esc(c)}</li>` : `<li>${esc(c)}</li>`));
  // The trail reads from the left; back sits at the row's right end (decision 219 (9)).
  return `<nav class="crumbs" aria-label="위치"><ol class="trail">${items.join("")}</ol><button type="button" class="link back" data-back>‹ 뒤로</button></nav>`;
};

/** The body of one stage; its trail is the model's place. The entry wires data-nav, data-act, back and tabs. */
export function renderStage(
  v: PanelView,
  tab: Tab = "all",
  at: Target = {},
  pending: ReadonlySet<string> = new Set(),
): string {
  const m = v.model;
  const nav = m.stage === 1 ? tabs(m, tab) : backLine(placeTrail(m));
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
const UNESC = Object.fromEntries(Object.entries(ESC).map(([c, e]) => [e, c]));
export const drawnRowIds = (html: string): string[] => [...html.matchAll(/<tr data-id="([^"]*)"/g)].map((m) => (m[1] ?? "").replace(/&[a-z0-9#]+;/g, (e) => UNESC[e] ?? e));
