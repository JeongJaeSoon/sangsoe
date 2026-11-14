import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readParts, renderResources } from "../../orca-plugin/panel/resources.ts";
import { STYLE } from "../../orca-plugin/panel/style.ts";
import { renderStage } from "../../orca-plugin/panel/view.ts";
import { NOW, PARTS_GOT, VIEW } from "../fixtures/panel/rc3-state.ts";
import { scratchDir } from "../scratch.ts";
import { dump, noBrowser, orcaPage } from "./browser.ts";

// U133 (decision 262): the 리소스 section is pinned to the panel's bottom, so opening it is a sheet over
// the board, not more page under it. A board taller than the panel, scrolled to its middle, must not
// move or grow when the section opens, and the sheet must lie inside the panel.

const HEIGHT = 700;
const WIDTH = 544;
const SCROLLED = 300;

type Before = { docH: number; scrollY: number };
type After = Before & { sheet: { top: number; bottom: number }; vh: number; maxHeight: string; bodyScroll: boolean; stage: number };

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
  const { before, after } = got;
  assert.ok(before.docH > HEIGHT + SCROLLED, `the board is taller than the panel (${before.docH})`);
  assert.equal(before.scrollY, SCROLLED, "the board starts scrolled to its middle");
  assert.equal(after.scrollY, before.scrollY, "the board did not scroll when the section opened");
  assert.equal(after.docH, before.docH, "the page did not grow when the section opened");
  assert.equal(Math.round(after.stage), 0, "the board did not reflow");
  assert.ok(after.sheet.top >= 0, `the sheet's top (${after.sheet.top}) is inside the panel`);
  assert.equal(Math.round(after.sheet.bottom), after.vh, "the sheet grows up from the panel's bottom");
  assert.ok(after.sheet.bottom - after.sheet.top < after.vh, "the sheet leaves part of the board in view");
  assert.notEqual(after.maxHeight, "none", "a body taller than the panel scrolls inside the sheet");
});
