import assert from "node:assert/strict";
import { test } from "node:test";
import { panelView } from "../../core/index.ts";
import { STYLE } from "../../orca-plugin/panel/style.ts";
import { type PanelView, renderStage } from "../../orca-plugin/panel/view.ts";
import { groupWorld } from "../brief/group-world.ts";

// Decision 220: the owner's (14)(15) on the group detail's tables, and the section hierarchy.

let html = "";
test.before(async () => {
  const g = panelView(await (await groupWorld()).input(), { group: "api-migration" });
  assert.ok(g.ok);
  html = renderStage(g.value as unknown as PanelView);
});

const WIDE = STYLE.split("@container panel (max-width: 719px)")[0] ?? "";
const NARROW = /@container panel \(max-width: 719px\) \{(.*)\n\}/s.exec(STYLE)?.[1] ?? "";
const rule = (css: string, sel: string) =>
  new RegExp(`(?:^|\\n)\\s*${sel.replace(/[.()]/g, "\\$&")} \\{[^}]*`).exec(css)?.[0] ?? "";

/** Each named table's rows as lists of [class, label] per cell. */
function table(title: string): { cls: string; label: string; text: string }[][] {
  const at = html.search(new RegExp(`>${title}(?: <span class="count">\\d+</span>)?</h[23]>`));
  assert.ok(at >= 0, title);
  const t = /<tbody>(.*?)<\/tbody>/s.exec(html.slice(at))?.[1] ?? "";
  return [...t.matchAll(/<tr [^>]*>(.*?)<\/tr>/gs)].map((r) =>
    [...(r[1] ?? "").matchAll(/<td(?: data-l="([^"]*)")?(?: class="([^"]*)")?[^>]*>(.*?)<\/td>/gs)].map((c) => ({
      label: c[1] ?? "",
      cls: c[2] ?? "",
      text: (c[3] ?? "").replace(/<[^>]+>/g, ""),
    })),
  );
}
const FOUR = ["크리티컬 패스", "왜 준비되지 않았나", "간선", "끊긴 선행"];

test("(14) the first column of a graph table is not held to the 64px id column", () => {
  assert.doesNotMatch(WIDE, /(^|\n)\.tbl th:first-child, \.tbl td:first-child \{[^}]*width: 64px/);
  assert.match(WIDE, /\.tbl:not\(\.gt\) th:first-child, \.tbl:not\(\.gt\) td:first-child \{ width: 64px; \}/);
});

test("(14) graph cells wrap at words, never inside an id or a Hangul word", () => {
  const td = rule(WIDE, ".tbl.gt td");
  assert.match(td, /overflow-wrap: break-word;/);
  assert.match(td, /word-break: keep-all;/);
  assert.match(rule(WIDE, ".tbl.gt td.nw"), /white-space: nowrap; width: 1%;/);
  assert.match(rule(WIDE, ".tbl.gt td.it"), /min-width: \d+em;/);
  assert.match(rule(WIDE, ".tbl.gt td.tx"), /min-width: \d+em;/);
});

test("(14) the role widths hold only in a wide panel, so a narrow card's title cells are not squeezed to 1%", () => {
  const wideOnly = /@container panel \(min-width: 720px\) \{([^@]*?)\n\}/s.exec(STYLE)?.[1] ?? "";
  for (const sel of [".tbl.gt td.nw", ".tbl.gt td.it", ".tbl.gt td.tx"]) {
    assert.ok(rule(wideOnly, sel), `${sel} sits in the wide-only block`);
    assert.equal(rule(WIDE.replace(wideOnly, ""), sel), "", `${sel} is not a rule at every width`);
  }
});

test("(14) the four tables give each column one role: short cells nowrap, item cells and the long text take the width", () => {
  const want: Record<string, Record<string, string>> = {
    "크리티컬 패스": { 단계: "nw", 항목: "it", 상태: "nw", "단계 이름": "tx" },
    "왜 준비되지 않았나": { 항목: "it", "막는 선행": "it", "간선 종류": "kind nw", "선행 상태": "nw", "해야 할 일": "tx" },
    간선: { 종류: "kind nw", 선행: "it", 후속: "it", 비고: "tx" },
    "끊긴 선행": { 항목: "it", "끊긴 선행": "it", 처리: "tx" },
  };
  for (const name of FOUR) {
    const rows = table(name);
    assert.ok(rows.length > 0, name);
    for (const r of rows) {
      const got = Object.fromEntries(r.filter((c) => c.label).map((c) => [c.label, c.cls.replace(/\s*\bhd\b/, "").trim()]));
      assert.deepEqual(got, want[name], name);
    }
  }
});

test("(15) every card of the four tables opens with a title line: the item id, then its state", () => {
  for (const name of FOUR) {
    for (const r of table(name)) {
      const head = r.filter((c) => /\bhd\b/.test(c.cls));
      assert.ok(head.length > 0, `${name}: no title cell`);
      const line = head.map((c) => c.text).join(" ");
      assert.match(line, /i\d{3}/, `${name}: ${line}`);
      assert.match(line, /📅|🟢|🔄|🚧|⏳|✅|⏸️|🗑️|❓/u, `${name}: ${line} names no state`);
      const brk = r.findIndex((c) => c.cls === "brk");
      assert.ok(brk > 0, `${name}: no rule under the title line`);
    }
  }
});

test("(15) a narrow panel draws each graph row as a bordered card under its section heading", () => {
  assert.match(rule(NARROW, ".tbl.gt tbody"), /display: flex; flex-direction: column; gap: var\(--s2\);/);
  const tr = rule(NARROW, ".tbl.gt tr");
  assert.match(tr, /border: 1px solid var\(--rule-2\);/);
  assert.match(tr, /border-radius: var\(--r2\);/);
  assert.match(rule(NARROW, ".tbl.gt td.hd"), /order: -2;.*font-weight: 600;/);
  assert.match(rule(NARROW, ".tbl.gt td.hd::before"), /content: none;/);
  assert.match(rule(NARROW, ".tbl.gt td.brk"), /order: -1;.*border-bottom: 1px solid var\(--rule\);/);
  assert.match(rule(NARROW, ".tbl.gt .hs"), /display: inline;/);
  assert.match(rule(WIDE, ".tbl.gt .hs"), /display: none;/);
  assert.match(rule(NARROW, ".tbl.gt"), /margin-top: var\(--s2\);/);
});

test("(3) headings step down from the group title to sections to sub-tables, and sections sit a step apart", () => {
  const px = (v: string) => Number(/var\(--text-(\w+)\)/.exec(v)?.[1] ? { xs: 11, sm: 12, base: 13, md: 15 }[/var\(--text-(\w+)\)/.exec(v)?.[1] as "xs"] : 0);
  const size = (sel: string) => px(/font-size: ([^;]+);/.exec(rule(WIDE, sel))?.[1] ?? "");
  assert.ok(size("h1") > size(".sec-h h2") && size(".sec-h h2") > size("h3"), `${size("h1")} ${size(".sec-h h2")} ${size("h3")}`);
  assert.match(rule(WIDE, "section"), /margin: 0 0 var\(--s5\);/);
  assert.match(rule(WIDE, ".gwrap"), /margin: 0 0 var\(--s5\);/);
});
