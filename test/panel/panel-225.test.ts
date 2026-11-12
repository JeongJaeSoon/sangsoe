import assert from "node:assert/strict";
import { test } from "node:test";
import { panelView } from "../../core/index.ts";
import { STYLE } from "../../orca-plugin/panel/style.ts";
import { type GroupDetail, type ItemDetail, type Overview, type PanelView, renderStage, type Row } from "../../orca-plugin/panel/view.ts";
import { groupWorld } from "../brief/group-world.ts";

// Decision 225: the owner's panel items (1)-(11) of 2026-11-12.

let one: PanelView;
let grp: PanelView;
test.before(async () => {
  const w = await groupWorld();
  const o = panelView(await w.input(), {});
  const g = panelView(await w.input(), { group: "api-migration" });
  assert.ok(o.ok && g.ok);
  one = o.value as unknown as PanelView;
  grp = g.value as unknown as PanelView;
});
const ov = () => one.model as Overview;
const gm = () => grp.model as GroupDetail;
const WIDE = STYLE.split("@container panel (max-width: 719px)")[0] ?? "";
const NARROW = /@container panel \(max-width: 719px\) \{(.*)\n\}/s.exec(STYLE)?.[1] ?? "";
const WIDE_ONLY = /@container panel \(min-width: 720px\) \{([^@]*?)\n\}/s.exec(STYLE)?.[1] ?? "";
const rule = (css: string, sel: string) =>
  new RegExp(`(?:^|\\n)\\s*${sel.replace(/[.()[\]"=*+>:]/g, "\\$&")} \\{[^}]*`).exec(css)?.[0] ?? "";
const rowOf = (html: string, id: string) => new RegExp(`<tr data-id="${id}"[^>]*>.*?</tr>`, "s").exec(html)?.[0] ?? "";
const withRows = (rows: Row[]): PanelView => ({ ...one, model: { ...ov(), inProgress: { ...ov().inProgress, rows } } });

test("(1) the panel draws into the page's own #root, so no second, empty root pads the top", async () => {
  const { panelRoot } = await import("../../orca-plugin/panel/index.ts");
  assert.equal(typeof panelRoot, "function");
  const own = { id: "root" };
  const appended: unknown[] = [];
  const doc = {
    getElementById: (id: string) => (id === "root" ? own : null),
    createElement: () => ({ id: "" }),
    body: { append: (e: unknown) => appended.push(e) },
  };
  assert.equal(panelRoot(doc as never), own);
  assert.equal(appended.length, 0);
  const bare = { ...doc, getElementById: () => null };
  const made = panelRoot(bare as never) as { id: string };
  assert.equal(made.id, "root");
  assert.deepEqual(appended, [made], "a page without one (a browser preview) still gets its root");
});

test("(2)(7) the 누가 cell is a badge for who and the elapsed time apart, the time last so it ends the card", () => {
  const html = renderStage(one);
  const i026 = rowOf(html, "i026");
  assert.match(i026, /<td data-l="누가" class="who" title="워커 2h"><span class="badge">워커<\/span><span class="age">2h<\/span><\/td>/);
  // Who unknown: no empty badge, the time alone as an age cell (decision 229: no 누가 label).
  assert.match(rowOf(html, "i031"), /<td data-l="누가" class="age">17h<\/td>/);
  const who = rule(NARROW, ".tbl:not(.gt) td.who");
  for (const d of ["flex: none;", "margin-left: auto;"]) assert.ok(who.includes(d), d);
  assert.match(rule(NARROW, ".tbl:not(.gt) td.age, .tbl .who .age"), /margin-left: auto;/);
  // The decision and to-do tables' 경과 column is the same time, at the same edge.
  const rows = ov().decisions.rows.length > 0 ? ov().decisions.rows : [];
  if (rows.length > 0) assert.match(rowOf(html, rows[0]?.id ?? ""), /<td data-l="경과" class="age">/);
});

test("(7) a long who value is cut with an ellipsis inside its badge and keeps its full text in the title", () => {
  const term = "term_0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const rows = ov().inProgress.rows.map((r) => (r.id === "i026" ? { ...r, cells: r.cells.map((c, i) => (i === 4 ? { text: `${term} 43m` } : c)) } : r));
  const cell = rowOf(renderStage(withRows(rows)), "i026");
  assert.match(cell, new RegExp(`<td data-l="누가" class="who" title="${term} 43m"><span class="badge">${term}</span><span class="age">43m</span></td>`));
  const badge = rule(STYLE, ".who .badge");
  for (const d of ["white-space: nowrap;", "overflow: hidden;", "text-overflow: ellipsis;", "max-width:"]) assert.ok(badge.includes(d), d);
  // A badge in the meta line fits the line's 16px with its border, so a card with one is no taller.
  assert.match(rule(NARROW, ".tbl td[data-l] .badge"), /line-height: 14px;/);
});

test("(7) a who with no time ('워커 —') or no one ('— —', '—') draws no '—' badge", () => {
  const cellOf = (text: string) => {
    const rows = ov().inProgress.rows.map((r) => (r.id === "i026" ? { ...r, cells: r.cells.map((c, i) => (i === 4 ? { text } : c)) } : r));
    return /<td data-l="누가".*?<\/td>/.exec(rowOf(renderStage(withRows(rows)), "i026"))?.[0] ?? "";
  };
  assert.match(cellOf("워커 —"), /class="who"[^>]*><span class="badge">워커<\/span><\/td>$/);
  assert.equal(cellOf("— 17h"), '<td data-l="누가" class="age">17h</td>');
  // No one and no time: an empty cell, hidden in a card like any other.
  assert.match(cellOf("— —"), /^<td data-l="누가" class="nil"><span class="dash">—<\/span><\/td>$/);
  const item = renderStage({ ...grp, model: { stage: 3, now: "", id: "i026", title: "x", state: "🔄", flags: "", who: "—", priority: "P2", chain: { title: "체인", count: 0, columns: [], rows: [] } } as ItemDetail });
  assert.match(item, /<p class="sumline">누가 — · <span class="pri">P2<\/span>/);
});

test("(3) the middle text takes the freed width, at most two lines then an ellipsis, its full text in the title", () => {
  const html = renderStage(one);
  assert.match(rowOf(html, "i033"), /<td data-l="다음" class="mid" title="키 도착 확인">/);
  const mid = rule(NARROW, ".tbl:not(.gt) td.mid");
  for (const d of ["flex: 1 1 0;", "-webkit-line-clamp: 2;", "overflow: hidden;"]) assert.ok(mid.includes(d), d);
  const pr = rule(NARROW, ".tbl:not(.gt) td.pr");
  for (const d of ["white-space: nowrap;", "text-overflow: ellipsis;"]) assert.ok(pr.includes(d), d);
});

test("(11) an empty cell takes no room in a card: the next value flows to the left", () => {
  assert.match(rule(NARROW, ".tbl td.nil"), /display: none;/);
  assert.doesNotMatch(NARROW, /visibility: hidden/);
});

test("(11) an item card's head names its state in a badge; the wide column shows mark and word (decision 229), a group head keeps its mark", () => {
  const rows = ov().inProgress.rows;
  const ready = rows.find((r) => r.cells[0]?.text === "🟢" && !r.id.startsWith("lead:"));
  const blocked = rows.find((r) => r.cells[0]?.text === "🚧" && !r.id.startsWith("lead:"));
  assert.ok(ready && blocked, "the world has a 🟢 and a 🚧 item");
  const html = renderStage(one);
  assert.match(rowOf(html, ready.id), /^<tr[^>]*><td><span class="mk" aria-hidden="true">🟢<\/span><span class="badge st">준비됨<\/span><\/td>/);
  assert.match(rowOf(html, blocked.id), /^<tr[^>]*><td><span class="mk" aria-hidden="true">🚧<\/span><span class="badge t-bad st">막힘<\/span><\/td>/);
  assert.match(rowOf(html, "lead:api-migration"), /^<tr[^>]*><td><span class="mk" aria-hidden="true">🚧<\/span><span class="badge t-bad st">막힘<\/span><\/td>/);
  assert.match(rule(NARROW, ".tbl tr.lead .st"), /clip-path: inset\(50%\);/);
  assert.doesNotMatch(rule(WIDE, ".tbl .st"), /display: none;/);
  assert.match(rule(NARROW, ".tbl .st"), /display: inline-block;/);
  assert.match(rule(NARROW, ".tbl .mk"), /display: none;/);
});

test("(4) the detail view's header and its back line stay together at the top while the page scrolls", () => {
  const bar = rule(STYLE, ".bar");
  for (const d of ["position: sticky;", "top: 0;"]) assert.ok(bar.includes(d), d);
  const html = renderStage(grp);
  assert.match(html, /^<div class="bar"><header class="top">.*<\/header><nav class="crumbs"[^>]*>.*?<\/nav><\/div><main/s);
  const item = renderStage({ ...grp, model: { stage: 3, now: "", id: "i026", title: "x", state: "🔄", flags: "", who: "워커", priority: "P2", chain: { title: "체인", count: 0, columns: [], rows: [] } } as ItemDetail });
  assert.match(item, /^<div class="bar"><header class="top">.*<\/header><nav class="crumbs"/s);
  assert.doesNotMatch(rule(STYLE, ".top"), /sticky/, "one sticky block, not two");
});

test("(5) a graph row with nothing under its title line draws no rule and no empty body", () => {
  const html = renderStage(grp);
  const at = html.indexOf('id="h-');
  assert.ok(at > 0);
  const crit = gm().critical;
  assert.ok(crit);
  const t = { ...crit, rows: crit.rows.map((r, i) => (i === 1 ? { ...r, cells: r.cells.map((c, k) => (k === 3 ? { text: "—" } : c)) } : r)) };
  const two = renderStage({ ...grp, model: { ...gm(), critical: t } });
  const row = rowOf(two, t.rows[1]?.id ?? "");
  assert.match(row, /^<tr data-id="[^"]+" class="headonly">/);
  assert.match(rule(NARROW, ".tbl.gt tr.headonly td.brk"), /display: none;/);
  // A head cell carries a label too; the list rows' bare rule must not reach it.
  assert.doesNotMatch(NARROW, /tr\.headonly td\[data-l\]/);
});

test("(6) state words are badges in the graph tables, toned by state, flags kept beside them", () => {
  const html = renderStage(grp);
  assert.match(html, /<span class="badge t-run">진행 중<\/span> 🚨/);
  assert.match(html, /<span class="badge">예정<\/span>/);
  assert.match(html, /<span class="badge t-bad">막힘<\/span>/);
  assert.match(html, /<span class="badge">열림<\/span>/, "a state word with no marker is a badge too");
  assert.match(html, /<span class="hs"><span class="badge t-bad">막힘<\/span><\/span>/);
  assert.doesNotMatch(html, /data-l="상태"[^>]*>[^<]*🔄 진행 중/);
  assert.match(rule(STYLE, ".badge.t-bad"), /color: var\(--bad\);/);
});

test("(6) the item screen names who as a badge", () => {
  const item = renderStage({ ...grp, model: { stage: 3, now: "", id: "i026", title: "x", state: "🔄", flags: "", who: "워커", priority: "P2", chain: { title: "체인", count: 0, columns: [], rows: [] } } as ItemDetail });
  assert.match(item, /<p class="sumline">누가 <span class="badge">워커<\/span>/);
});

test("(8)(9) a group row: its count is a badge beside the title, 자세히 › ends the narrow head and leaves the wide row", () => {
  const html = renderStage(one);
  const lead = rowOf(html, "lead:api-migration");
  assert.match(lead, /<span class="badge t-bad cnt" title="10건 중 막힘 2">막힘 2 \/ 10<\/span><span class="go" aria-hidden="true">자세히 ›<\/span><\/td>/);
  assert.match(lead, /<td data-l="다음" class="nil">/, "the count no longer sits in the 다음 column");
  assert.doesNotMatch(lead, /10건·막힘 2/);
  assert.match(rowOf(html, "lead:docs"), /<span class="badge cnt" title="1건 중 막힘 0">1건<\/span>/);
  assert.match(rule(WIDE, ".tbl .go"), /display: none;/);
  assert.match(rule(NARROW, ".tbl tr.lead .go"), /margin-left: auto;/);
  // A count the panel cannot read stays as written.
  const odd = ov().inProgress.rows.map((r) => (r.id === "lead:api-migration" ? { ...r, cells: r.cells.map((c, i) => (i === 3 ? { text: "?" } : c)) } : r));
  assert.match(rowOf(renderStage(withRows(odd)), "lead:api-migration"), /<span class="badge cnt">\?<\/span>/);
});

test("(10) wide tables keep each cell on one line: fixed columns, ellipsis, the full text in the title", () => {
  assert.match(rule(WIDE_ONLY, ".tbl"), /table-layout: fixed;/);
  const td = rule(WIDE_ONLY, ".tbl td");
  for (const d of ["white-space: nowrap;", "overflow: hidden;", "text-overflow: ellipsis;"]) assert.ok(td.includes(d), d);
  const html = renderStage(one);
  assert.match(html, /<table class="tbl"><colgroup><col>/);
  assert.match(rowOf(html, "i031"), /<td data-l="PR" class="pr" title="acme\/api#31">/);
  const g = renderStage(grp);
  assert.match(g, /<table class="tbl gt"><colgroup>/);
  assert.match(g, /<td data-l="해야 할 일" class="tx" title="[^"]+">/);
});

test("(10) wide rows read apart: group rows on a light tint, other rows striped, all inside the white page", () => {
  assert.match(rule(WIDE_ONLY, ".tbl tr.lead td"), /background: var\(--tint-2\);/);
  // A decision's answer form is a hidden row of its own; the stripes count only the decision rows.
  // `:where` keeps the stripe at the hover rule's weight, so the later hover still wins on a striped row.
  assert.match(rule(WIDE_ONLY, ".tbl:not(:has(tr.lead)) tbody tr:nth-child(even of :where(:not(.other))) td"), /background: var\(--tint-1\);/);
  const stripe = WIDE_ONLY.indexOf("tr:nth-child(even of");
  const hover = WIDE_ONLY.indexOf(".tbl:not(:has(tr.lead)) tbody tr:hover td");
  assert.ok(stripe >= 0 && hover > stripe, "hover comes after the stripe");
  assert.match(STYLE, /--tint-1: color-mix\(in oklab, var\(--ink\) \d%, var\(--paper\)\);/);
  // The page, the cards and the narrow panel stay white (decision 222).
  assert.doesNotMatch(NARROW, /--tint/);
});
