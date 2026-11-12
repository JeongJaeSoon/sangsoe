import assert from "node:assert/strict";
import { test } from "node:test";
import { ITEM_READINGS, panelView, READING_LABEL } from "../../core/index.ts";
import { STYLE } from "../../orca-plugin/panel/style.ts";
import { type Overview, type PanelView, renderStage, type Row } from "../../orca-plugin/panel/view.ts";
import { groupWorld } from "../brief/group-world.ts";

// Decision 229: no field label without its value, and the wide state column says its word.

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
const WIDE = STYLE.split("@container panel (max-width: 719px)")[0] ?? "";
const NARROW = /@container panel \(max-width: 719px\) \{(.*)\n\}/s.exec(STYLE)?.[1] ?? "";
const rule = (css: string, sel: string) =>
  new RegExp(`(?:^|\\n)\\s*${sel.replace(/[.()[\]"=*+>:]/g, "\\$&")} \\{[^}]*`).exec(css)?.[0] ?? "";
const rowOf = (html: string, id: string) => new RegExp(`<tr data-id="${id}"[^>]*>.*?</tr>`, "s").exec(html)?.[0] ?? "";
const withRows = (rows: Row[]): PanelView => ({ ...one, model: { ...ov(), inProgress: { ...ov().inProgress, rows } } });
const whoOf = (text: string) => {
  const rows = ov().inProgress.rows.map((r) => (r.id === "i026" ? { ...r, cells: r.cells.map((c, i) => (i === 4 ? { text } : c)) } : r));
  return /<td data-l="누가".*?<\/td>/.exec(rowOf(renderStage(withRows(rows)), "i026"))?.[0] ?? "";
};

test("a card with no one in 누가 shows its age where a 경과 cell sits, with no 누가 label before it", () => {
  // The label is CSS's `td[data-l]::before`; only the age role drops it, the way the decision rows' 경과 does.
  assert.equal(whoOf("— 29h"), '<td data-l="누가" class="age">29h</td>');
  assert.match(rowOf(renderStage(one), "i031"), /<td data-l="누가" class="age">17h<\/td>/);
  assert.match(rule(NARROW, ".tbl td.age::before"), /content: none;/);
  assert.match(rule(NARROW, ".tbl:not(.gt) td.age, .tbl .who .age"), /margin-left: auto;/);
  const dec = ov().decisions.rows[0];
  if (dec) assert.match(rowOf(renderStage(one), dec.id), /<td data-l="경과" class="age">/);
});

test("a card with someone in 누가 still reads 누가 <who> <age>", () => {
  assert.equal(whoOf("리뷰어 29h"), '<td data-l="누가" class="who" title="리뷰어 29h"><span class="badge">리뷰어</span><span class="age">29h</span></td>');
  assert.match(whoOf("워커 —"), /class="who"[^>]*><span class="badge">워커<\/span><\/td>$/);
});

test("every 누가 cell the panel labels holds a who badge", () => {
  for (const v of [one, grp]) {
    const cells = renderStage(v).match(/<td data-l="누가" class="who"[^>]*>.*?<\/td>/g) ?? [];
    for (const c of cells) assert.match(c, /<span class="badge">[^<]+<\/span>/, c);
  }
});

test("the wide state column shows each reading's mark with its word, the narrow card the word alone", () => {
  for (const r of ITEM_READINGS) {
    const mark = READING_LABEL[r].split(" ")[0] ?? "";
    const rows = ov().inProgress.rows.map((x) => (x.id === "i026" ? { ...x, cells: x.cells.map((c, i) => (i === 0 ? { text: mark } : c)) } : x));
    const cell = /^<tr[^>]*><td>(.*?)<\/td>/.exec(rowOf(renderStage(withRows(rows)), "i026"))?.[1] ?? "";
    assert.match(cell, new RegExp(`^<span class="mk">${mark}</span><span class="badge[^"]* st">[^<]+</span>$`, "u"), `${r}: ${cell}`);
  }
  assert.doesNotMatch(rule(WIDE, ".tbl .st"), /display: none;/, "the word shows in the wide column too");
  assert.match(rule(NARROW, ".tbl .mk"), /display: none;/);
  assert.match(rule(NARROW, ".tbl .st"), /display: inline-block;/);
});

test("a group row's state cell in the wide table says its word too; its narrow head keeps the mark", () => {
  assert.match(rowOf(renderStage(one), "lead:api-migration"), /^<tr[^>]*><td><span class="mk">🚧<\/span><span class="badge t-bad st">막힘<\/span><\/td>/);
  assert.match(rule(NARROW, ".tbl tr.lead .mk"), /display: inline;/);
  assert.match(rule(NARROW, ".tbl tr.lead .st"), /display: none;/);
});

test("a wide table led by a state is wide enough for mark and word; an id-led table keeps its 64px", () => {
  assert.match(rule(WIDE, ".tbl:not(.gt) th:first-child, .tbl:not(.gt) td:first-child"), /width: 64px;/);
  assert.match(rule(WIDE, ".tbl:not(.gt):has(.st) th:first-child, .tbl:not(.gt):has(.st) td:first-child"), /width: \d+px;/);
});
