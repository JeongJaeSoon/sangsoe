import assert from "node:assert/strict";
import { test } from "node:test";
import { panelView, renderMarkdown } from "../../core/index.ts";
import { STYLE } from "../../orca-plugin/panel/style.ts";
import { type Overview, type PanelView, renderStage } from "../../orca-plugin/panel/view.ts";
import { groupWorld } from "../brief/group-world.ts";

// Decision 222: the owner's (16)-(20) and the Orca tone across the panel.

let one: PanelView;
test.before(async () => {
  const r = panelView(await (await groupWorld()).input(), {});
  assert.ok(r.ok);
  one = r.value as unknown as PanelView;
});
const m = () => one.model as Overview;
const NARROW = /@container panel \(max-width: 719px\) \{(.*)\n\}/s.exec(STYLE)?.[1] ?? "";
const rule = (css: string, sel: string) =>
  new RegExp(`(?:^|\\n)\\s*${sel.replace(/[.()[\]"=*]/g, "\\$&")} \\{[^}]*`).exec(css)?.[0] ?? "";
const rowOf = (html: string, id: string) => new RegExp(`<tr data-id="${id}"[^>]*>.*?</tr>`, "s").exec(html)?.[0] ?? "";

test("(16) a group row opens with 자세히 ›, and its label names the group", () => {
  const lead = rowOf(renderStage(one), "lead:api-migration");
  assert.match(lead, /<span class="go" aria-hidden="true">자세히 ›<\/span>/);
  assert.match(lead, /aria-label="api-migration 묶음 자세히"/);
  assert.doesNotMatch(renderStage(one), /묶음 상세 ›/);
});

test("(19) one name for one rule: the tab, the section and the brief text say 열린 항목, the sum of 🔄, 🚧 and 남은 것", () => {
  const html = renderStage(one);
  assert.equal(m().inProgress.title, "열린 항목");
  assert.ok(html.includes(`data-tab-to="prog">열린 항목 <span class="count">${m().inProgress.count}</span>`), "the tab reads the section's title");
  assert.match(html, /<h2 id="h-prog">열린 항목 <span class="count">/);
  const s = m().summary;
  assert.equal(m().inProgress.count, s.doing + s.blocked + s.left, "this world has no owner item or hold apart from the groups");
  assert.match(renderMarkdown(m() as unknown as Parameters<typeof renderMarkdown>[0], { maxWidth: 78 }), /### 열린 항목 \d+/);
});

test("(20) an empty value is marked, hidden in a card, and a card with no meta value drops the line", () => {
  const html = renderStage(one);
  const lead = rowOf(html, "lead:api-migration");
  assert.match(lead, /<td data-l="PR" class="nil">/);
  assert.match(rule(NARROW, ".tbl td.nil"), /visibility: hidden;/);
  const t = m().inProgress;
  const empty = t.rows.map((r) => (r.id === "i037" ? { ...r, cells: r.cells.map((c, i) => (i < 2 ? c : { text: "—" })) } : r));
  const bare = rowOf(renderStage({ ...one, model: { ...m(), inProgress: { ...t, rows: empty } } }), "i037");
  assert.match(bare, /^<tr data-id="i037" class="[^"]*\bbare\b/);
  assert.match(rule(NARROW, ".tbl tr.bare td[data-l]:not(.num), .tbl tr.bare td.brk"), /display: none;/);
  // The wide 64px id column must not reach into a card (its selector outranks a plain .tbl td).
  assert.match(rule(NARROW, ".tbl:not(.gt) td:first-child"), /width: auto;/);
});

test("(17)(18) a narrow list row is one card: a one-line head (state, id, title, number) and an aligned meta line", () => {
  const html = renderStage(one);
  const tr = rule(NARROW, ".tbl tr");
  assert.match(tr, /border: 1px solid var\(--rule\);/);
  assert.match(tr, /border-radius: var\(--r3\);/);
  assert.match(rule(NARROW, ".tbl tbody"), /display: flex; flex-direction: column; gap: var\(--s2\);/);
  const title = rule(NARROW, ".tbl td.title");
  for (const d of ["white-space: nowrap;", "overflow: hidden;", "text-overflow: ellipsis;", "min-width: 0;"]) assert.ok(title.includes(d), d);
  const meta = rule(NARROW, ".tbl:not(.gt) td[data-l]");
  for (const d of ["flex: 1 1 0;", "white-space: nowrap;", "overflow: hidden;", "text-overflow: ellipsis;"]) assert.ok(meta.includes(d), d);
  assert.match(rowOf(html, "i033"), /<td class="title" title="i033 스테이징 키 발급">/, "the cut title keeps its full text");
  // The group's count rides the head line: its cell keeps its wide column and moves up in a card.
  assert.match(rowOf(html, "lead:api-migration"), /<td data-l="다음" class="num">10건·막힘 2<\/td>/);
  assert.match(rule(NARROW, ".tbl:not(.gt) td:first-child, .tbl:not(.gt) td.title, .tbl td.num, .tbl td.hd"), /order: -2;/);
  assert.match(rule(NARROW, ".tbl td.brk"), /order: -1;/);
  assert.equal(rule(NARROW, ".tbl tr.item"), "", "no indent for an item under its group");
  assert.doesNotMatch(STYLE, /tr\.item td\.title::before \{ content: "└"/);
});

test("(tone) white everywhere: a fill only for hover, the chosen tab and an open menu; the summary and figures are bordered cards", () => {
  const fills = [...STYLE.matchAll(/([^{}]*)\{[^}]*background:\s*var\(--(?:paper-2|paper-3|accent-soft)\)/g)].map((x) => (x[1] ?? "").trim());
  assert.ok(fills.length > 0);
  for (const sel of fills) assert.match(sel, /:hover|aria-selected="true"|\[open\]/, sel);
  assert.match(rule(STYLE, ".sumline"), /border: 1px solid var\(--rule\); border-radius: var\(--r3\);/);
  assert.match(rule(STYLE, ".figs"), /border: 1px solid var\(--rule\); border-radius: var\(--r3\);/);
  const h2 = rule(STYLE, ".sec-h h2");
  assert.match(h2, /font-size: var\(--text-sm\);/);
  assert.match(h2, /letter-spacing: 0\.04em;/);
  assert.doesNotMatch(rule(STYLE, ".sec-h"), /border-bottom/);
});
