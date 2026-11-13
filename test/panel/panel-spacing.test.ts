import assert from "node:assert/strict";
import { test } from "node:test";
import { panelView } from "../../core/index.ts";
import { STYLE } from "../../orca-plugin/panel/style.ts";
import { type Overview, type PanelView, renderStage, type Row, STATE_COL_PX, STATE_WORD, textPx } from "../../orca-plugin/panel/view.ts";
import { groupWorld } from "../brief/group-world.ts";

// The owner's v0.1.6 panel items 1-5: even card insets, padded tinted cells, a readable 누가 badge,
// no bare age in a wide 누가 column, and a group row's state read aloud.

let one: PanelView;
test.before(async () => {
  const w = await groupWorld();
  const o = panelView(await w.input(), {});
  assert.ok(o.ok);
  one = o.value as unknown as PanelView;
});
const ov = () => one.model as Overview;
const NARROW = /@container panel \(max-width: 719px\) \{(.*)\n\}/s.exec(STYLE)?.[1] ?? "";
const WIDE_ONLY = /@container panel \(min-width: 720px\) \{([^@]*?)\n\}/s.exec(STYLE)?.[1] ?? "";
const rule = (css: string, sel: string) =>
  new RegExp(`(?:^|\\n)\\s*${sel.replace(/[.()[\]"=*+>:]/g, "\\$&")} \\{[^}]*`).exec(css)?.[0] ?? "";
const rowOf = (html: string, id: string) => new RegExp(`<tr data-id="${id}"[^>]*>.*?</tr>`, "s").exec(html)?.[0] ?? "";
const withRows = (rows: Row[]): PanelView => ({ ...one, model: { ...ov(), inProgress: { ...ov().inProgress, rows } } });
const setCells = (id: string, at: Record<number, string>) =>
  withRows(ov().inProgress.rows.map((r) => (r.id === id ? { ...r, cells: r.cells.map((c, i) => (at[i] === undefined ? c : { text: at[i] })) } : r)));

test("(1) a card whose only meta value is its time is one line: the time ends the title line", () => {
  const html = renderStage(setCells("i033", { 2: "—", 3: "—", 4: "— 8m" }));
  assert.match(rowOf(html, "i033"), /^<tr data-id="i033" class="item oneline"/);
  assert.match(rule(NARROW, ".tbl tr.oneline td.brk"), /display: none;/);
  assert.match(rule(NARROW, ".tbl tr.oneline td.age"), /order: -2;/);
  // A card with a labelled value keeps its meta line; a group head is one line already.
  assert.doesNotMatch(rowOf(html, "i031"), /oneline/);
  assert.doesNotMatch(rowOf(html, "lead:api-migration"), /oneline/);
  assert.doesNotMatch(rowOf(renderStage(setCells("i033", { 2: "—", 3: "—", 4: "리뷰어 8m" })), "i033"), /oneline/);
});

test("(1) a card's state badge starts on the card's own inset, the same as its meta line", () => {
  // The wide table's first-cell inset leaked into the card: 4px more on the left than anywhere else.
  assert.match(rule(NARROW, ".tbl:not(.gt) td:first-child"), /padding: 0;/);
  const card = rule(NARROW, ".tbl tr");
  assert.match(card, /padding: var\(--s2\) 10px;/);
});

test("(2) a wide cell on a tinted row keeps its side inset: the first column is padded like the rest", () => {
  const first = rule(WIDE_ONLY, ".tbl th:first-child, .tbl td:first-child");
  assert.match(first, /padding-left: var\(--s3\);/);
  // An id column that sizes itself makes room for both insets.
  const cols = ["ID", "할 일", "풀리는 일", "어디서", "경과"].map((name, i) => ({ name, max: i === 0 ? 8 : 6 }));
  const todo = { title: "할 일", count: 1, columns: cols, rows: [{ id: "act:1", cells: cols.map(() => ({ text: "x" })) }] };
  const html = renderStage({ ...one, model: { ...ov(), ownerTodo: todo } });
  assert.match(html, /<col style="width:calc\(8ch \+ 24px\)">/);
});

test("(3) a terminal handle in 누가 is a short name; the cell's title keeps the whole handle", () => {
  const term = "term_0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const cell = /<td data-l="누가".*?<\/td>/.exec(rowOf(renderStage(setCells("i026", { 4: `${term} 43m` })), "i026"))?.[0] ?? "";
  assert.equal(cell, `<td data-l="누가" class="who" title="${term} 43m"><span class="badge">term_0a1b2c3d</span><span class="age">43m</span></td>`);
  assert.match(rowOf(renderStage(setCells("i026", { 4: "워커 43m" })), "i026"), /<span class="badge">워커<\/span>/);
});

test("(3) the wide 누가 column keeps room for a short name and its time", () => {
  const html = renderStage(one);
  const cols = /<table class="tbl"><colgroup>(.*?)<\/colgroup>/.exec(html.slice(html.indexOf('id="h-prog"')))?.[1] ?? "";
  // 상태, 항목, PR, 다음, 누가: the last one is the who column.
  // A short handle (about 101px as a badge), the room the badge leaves a four-glyph time, both insets.
  assert.match(cols.split("<col")[5] ?? "", /^ style="width:13\.5em">$/);
  assert.match(rule(STYLE, ".who .badge"), /max-width: min\(14em, calc\(100% - 4em\)\);/);
});

test("(4) a wide 누가 cell with no one says so before its time, never a bare age", () => {
  const html = renderStage(setCells("i033", { 4: "— 8m" }));
  assert.match(rowOf(html, "i033"), /<td data-l="누가" class="age">8m<\/td>/);
  const none = rule(WIDE_ONLY, '.tbl td.age[data-l="누가"]::before');
  assert.match(none, /content: "—";/);
  assert.match(none, /margin-right: var\(--s2\);/);
  // The 경과 column's time has its own header and stays bare.
  assert.doesNotMatch(WIDE_ONLY, /td\.age::before/);
});

test("(5) a group row's label names its state and count, not only that it opens", () => {
  const html = renderStage(one);
  assert.match(rowOf(html, "lead:api-migration"), /aria-label="api-migration 묶음, 막힘, 10건 중 막힘 2, 자세히"/);
  assert.match(rowOf(html, "lead:docs"), /aria-label="docs 묶음, 진행 중, 1건 중 막힘 0, 자세히"/);
});

test("(5) the wide state column's width comes from the longest state word, not a measured constant", () => {
  const longest = Math.max(...Object.values(STATE_WORD).map(textPx));
  // Both cell insets, the mark, its gap and the badge (its padding and border around the word).
  assert.ok(STATE_COL_PX >= 24 + 16 + 4 + longest + 14, String(STATE_COL_PX));
  const html = renderStage(one);
  const prog = html.slice(html.indexOf('id="h-prog"'));
  assert.match(prog, new RegExp(`<colgroup><col style="width:${STATE_COL_PX}px">`));
  assert.doesNotMatch(STYLE, /:has\(\.st\)/, "no second width in the style sheet");
});
