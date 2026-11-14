import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readParts, renderResources } from "../../orca-plugin/panel/resources.ts";
import { STYLE } from "../../orca-plugin/panel/style.ts";
import { renderStage } from "../../orca-plugin/panel/view.ts";
import { NOW, PARTS_GOT, VIEW } from "../fixtures/panel/rc3-state.ts";
import { scratchDir } from "../scratch.ts";
import { spawnSync } from "node:child_process";
import { chrome, dump, noBrowser, orcaPage } from "./browser.ts";

/** With SANGSOE_CAPTURE_DIR set, also saves a PNG of the page as drawn: the screen capture a UI review reads. */
function capture(dir: string, page: string, name: string, width: number, height: number): void {
  const out = process.env.SANGSOE_CAPTURE_DIR;
  const bin = chrome();
  if (!out || !bin) return;
  spawnSync(bin, ["--headless=new", "--disable-gpu", "--allow-file-access-from-files", `--user-data-dir=${join(dir, "shot")}`, `--window-size=${width},${height}`, "--virtual-time-budget=3000", "--run-all-compositor-stages-before-draw", "--hide-scrollbars", `--screenshot=${join(out, name)}`, `file://${join(dir, page)}`], { timeout: 60_000 });
}

// U133 (decision 262): the 리소스 section is pinned to the panel's bottom, so opening it is a sheet over
// the board, not more page under it. A board taller than the panel, scrolled to its middle, must not
// move or grow when the section opens, and the sheet must lie inside the panel.

const HEIGHT = 700;
const WIDTH = 544;
const SCROLLED = 300;

type Before = { docH: number; scrollY: number };
type After = Before & { sheet: { top: number; bottom: number }; vh: number; maxHeight: string; bodyScroll: boolean; bodyH: number; innerLen: number; stage: number };

function page(stage: string, closed: string, open: string): string {
  const mount = `
const st = document.createElement("style"); st.textContent = ${JSON.stringify(STYLE)}; document.head.append(st);
const root = document.getElementById("root");
const box = document.createElement("section"); box.id = "res"; root.after(box);
box.innerHTML = ${JSON.stringify(closed)};
root.innerHTML = ${JSON.stringify(stage)};
addEventListener("load", () => {
  const d = document.documentElement;
  scrollTo(0, ${SCROLLED});
  const before = { docH: d.scrollHeight, scrollY: scrollY };
  const stage0 = document.querySelector("#root main").getBoundingClientRect().height;
  box.innerHTML = ${JSON.stringify(open)};
  const sheet = document.querySelector("#res .res-fold").getBoundingClientRect();
  const body = document.querySelector("#res .res-body");
  window.measured = {
    before,
    after: {
      docH: d.scrollHeight, scrollY: scrollY, vh: innerHeight,
      sheet: { top: sheet.top, bottom: sheet.bottom },
      maxHeight: getComputedStyle(body).maxHeight,
      bodyScroll: body.scrollHeight > body.clientHeight,
      bodyH: body.getBoundingClientRect().height,
      innerLen: body.innerHTML.length,
      stage: document.querySelector("#root main").getBoundingClientRect().height - stage0,
    },
  };
});`;
  return orcaPage("", `<script>${mount}</script>\n`);
}

test("opening the 리소스 section covers the board: it neither scrolls nor grows, and the sheet stays in the panel", { skip: noBrowser }, async () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ id: `i${100 + i}`, cells: [{ text: "📅" }, { text: `i${100 + i} acme task ${i}` }, { text: "—" }, { text: "선행 대기" }, { text: "—" }] }));
  const model = VIEW.model as Extract<typeof VIEW.model, { inProgress: unknown }>;
  const long = { ...VIEW, model: { ...model, inProgress: { ...model.inProgress, count: 60, rows } } } as typeof VIEW;
  const now = Date.parse(NOW);
  const state = await readParts(async (input) => PARTS_GOT[input?.part ?? "load"], () => undefined);
  const dir = scratchDir("sangsoe-panel-");
  writeFileSync(join(dir, "p.html"), page(renderStage(long), renderResources({ kind: "idle" }, false, now), renderResources(state, true, now, 24)));
  const outer = `<!doctype html><html><body style="margin:0"><iframe name="p" src="p.html" style="display:block;border:0;width:${WIDTH}px;height:${HEIGHT}px"></iframe><pre id="out"></pre><script>
addEventListener("load", () => setTimeout(() => { document.getElementById("out").textContent = JSON.stringify(document.querySelector("iframe").contentWindow.measured); }, 200));</script></body></html>`;
  const got = dump(dir, outer) as { before: Before; after: After };
  capture(dir, "index.html", "sheet-544.png", WIDTH, HEIGHT);
  const { before, after } = got;
  assert.ok(before.docH > HEIGHT + SCROLLED, `the board is taller than the panel (${before.docH})`);
  assert.equal(before.scrollY, SCROLLED, "the board starts scrolled to its middle");
  assert.ok(after.innerLen > 0 && after.bodyH > 100, `the sheet has a body (${after.innerLen} chars, ${after.bodyH}px)`);
  assert.equal(after.scrollY, before.scrollY, "the board did not scroll when the section opened");
  assert.equal(after.docH, before.docH, "the page did not grow when the section opened");
  assert.equal(Math.round(after.stage), 0, "the board did not reflow");
  assert.ok(after.sheet.top >= 0, `the sheet's top (${after.sheet.top}) is inside the panel`);
  assert.equal(Math.round(after.sheet.bottom), after.vh, "the sheet grows up from the panel's bottom");
  assert.ok(after.sheet.bottom - after.sheet.top < after.vh, "the sheet leaves part of the board in view");
  assert.notEqual(after.maxHeight, "none", "a body taller than the panel scrolls inside the sheet");
});

// Owner UI 10: the second line of a card with a PR link broke "워커가 다음 지시를 기다림" mid-word onto
// two lines. The status text is one line cut with an ellipsis, the PR link keeps its width, and the
// title holds the whole text.
test("a card's status text stays on one line beside its PR link at 455px, whole in its title", { skip: noBrowser }, () => {
  const text = "워커가 지시를 기다림 그리고 한동안 아무도 답하지 않아서 이 글은 아주 길다";
  const rows = [
    { id: "i045", cells: [{ text: "🔄" }, { text: "└ i045 U130: live agents" }, { text: "sangsoe#156", link: "https://github.com/acme/api/pull/156" }, { text: text }, { text: "term_dcdf1234-0000-4000-8000-000000000000 87m" }] },
    { id: "i046", cells: [{ text: "🔄" }, { text: "└ i046 U131: probe" }, { text: "—" }, { text: text }, { text: "term_6a051234-0000-4000-8000-000000000000 8m" }] },
  ];
  const model = VIEW.model as Extract<typeof VIEW.model, { inProgress: unknown }>;
  const view = { ...VIEW, model: { ...model, inProgress: { ...model.inProgress, count: 2, rows } } } as typeof VIEW;
  const mount = `
const st = document.createElement("style"); st.textContent = ${JSON.stringify(STYLE)}; document.head.append(st);
document.getElementById("root").innerHTML = ${JSON.stringify(renderStage(view))};
addEventListener("load", () => {
  const card = (id) => {
    const td = document.querySelector('tr[data-id="' + id + '"] td.mid');
    const pr = document.querySelector('tr[data-id="' + id + '"] td.pr');
    const tr = document.querySelector('tr[data-id="' + id + '"]').getBoundingClientRect();
    const who = document.querySelector('tr[data-id="' + id + '"] td.who').getBoundingClientRect();
    return { over: Math.round(who.right - tr.right), h: td.getBoundingClientRect().height, scrollW: td.scrollWidth, clientW: td.clientWidth, title: td.getAttribute("title"), prW: pr ? pr.getBoundingClientRect().width : null, prScrollW: pr ? pr.scrollWidth : null };
  };
  window.measured = { withPr: card("i045"), plain: card("i046") };
});`;
  const dir = scratchDir("sangsoe-panel-");
  writeFileSync(join(dir, "c.html"), orcaPage("", `<script>${mount}</script>\n`));
  const outer = `<!doctype html><html><body style="margin:0"><iframe src="c.html" style="display:block;border:0;width:455px;height:700px"></iframe><pre id="out"></pre><script>
addEventListener("load", () => setTimeout(() => { document.getElementById("out").textContent = JSON.stringify(document.querySelector("iframe").contentWindow.measured); }, 200));</script></body></html>`;
  const got = dump(dir, outer) as Record<"withPr" | "plain", { over: number; h: number; scrollW: number; clientW: number; title: string; prW: number | null; prScrollW: number | null }>;
  capture(dir, "index.html", "cards-455.png", 455, 700);
  for (const [name, m] of Object.entries(got)) {
    assert.ok(m.h <= 16, `${name}: the status text is ${m.h}px tall, one 16px line`);
    assert.equal(m.title, text, `${name}: the title holds the whole text`);
    assert.ok(m.over <= 0, `${name}: 누가 runs ${m.over}px past the card's edge`);
  }
  assert.ok(got.withPr.scrollW > got.withPr.clientW, "the long text is cut, not wrapped");
  assert.ok((got.withPr.prScrollW ?? 0) <= (got.withPr.prW ?? 0) + 1, "the PR link is whole");
});
