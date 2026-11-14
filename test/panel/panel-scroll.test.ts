import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readParts, renderResBody, renderResources, type ResState } from "../../orca-plugin/panel/resources.ts";
import { STYLE } from "../../orca-plugin/panel/style.ts";
import { renderStage } from "../../orca-plugin/panel/view.ts";
import { NOW, PARTS_GOT, VIEW } from "../fixtures/panel/rc3-state.ts";
import { scratchDir } from "../scratch.ts";
import { dump, noBrowser, orcaPage } from "./browser.ts";

// U116 (decision 248): the owner's rc.3 panel, 1070px tall, scrolled 25px at 544 with the 리소스
// section open. Drawn here in a real browser inside the page Orca builds for an html panel (no body
// tag, #root alone, the section mounted after it), at the panel widths the owner reads.

const HEIGHT = 1070;
const WIDTHS = [440, 544, 600, 900] as const;
// rc.3 left 24px under the closed heading and 36px under the open section's last line.
const UNDER_HEADING = 8;
// Decision 253 replaces 248's 24: the card pads 16 under its last line and ends 12 above the section's
// end, as far as the title's text sits below the rule: 8px more than rc.4 (24 → 32 on the rc.3 state,
// counted from the last line's text box).
const UNDER_LAST_LINE = 32;
const STAGE_GAP = 8;

const shown = async (): Promise<ResState> => readParts(async (input) => PARTS_GOT[input?.part ?? "load"], () => undefined);

/** Orca's html panel page for a .ts entry, with the entry's mount reduced to what it draws. */
function panelPage(stage: string, res: string): string {
  const mount = `
const st = document.createElement("style"); st.textContent = ${JSON.stringify(STYLE)}; document.head.append(st);
const root = document.getElementById("root");
const box = document.createElement("section"); box.id = "res"; root.after(box);
box.innerHTML = ${JSON.stringify(res)};
root.innerHTML = ${JSON.stringify(stage)};
addEventListener("load", () => {
  const d = document.documentElement;
  const rect = (q) => { const e = document.querySelector(q); return e ? e.getBoundingClientRect().toJSON() : null; };
  const scrollers = [...document.querySelectorAll("*")].filter((e) => {
    const s = getComputedStyle(e);
    return /(auto|scroll)/.test(s.overflowX + s.overflowY) && (e.scrollHeight > e.clientHeight || e.scrollWidth > e.clientWidth);
  }).map((e) => e.id || e.className || e.tagName);
  const sum = document.querySelector("#res summary");
  const body = document.querySelector("#res .res-body");
  const texts = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP));
  let lastText = null;
  while (texts.nextNode()) lastText = texts.currentNode;
  const line = document.createRange();
  if (lastText) line.selectNodeContents(lastText);
  const stageEnd = document.querySelector("#root main")?.lastElementChild;
  window.measured = {
    lastLine: lastText ? line.getBoundingClientRect().bottom : null,
    stageEnd: stageEnd ? stageEnd.getBoundingClientRect().bottom : null,
    vh: innerHeight, docH: d.scrollHeight, contentH: Math.round(document.getElementById("root").getBoundingClientRect().height + document.getElementById("res").getBoundingClientRect().height), hscroll: d.scrollWidth - d.clientWidth, scrollers,
    res: rect("#res"), summary: rect("#res summary"), stamp: rect("#res .res-h"),
    summaryWeight: Number(getComputedStyle(sum).fontWeight), bodyBorder: getComputedStyle(body).borderTopWidth,
  };
});`;
  return orcaPage("", `<script>${mount}</script>\n`);
}

type Measured = {
  vh: number;
  docH: number;
  contentH: number;
  hscroll: number;
  scrollers: string[];
  res: DOMRect;
  summary: DOMRect;
  stamp: DOMRect | null;
  summaryWeight: number;
  bodyBorder: string;
  lastLine: number | null;
  stageEnd: number | null;
};

/** One browser run over every width and fold state, each page in an iframe of the panel's size. */
function measure(pages: Record<string, string>, width: (name: string) => number): Record<string, Measured> {
  const dir = scratchDir("sangsoe-panel-");
  for (const [name, html] of Object.entries(pages)) writeFileSync(join(dir, `${name}.html`), html);
  const frames = Object.keys(pages)
    .map((name) => `<iframe name="${name}" src="${name}.html" style="display:block;border:0;width:${width(name)}px;height:${HEIGHT}px"></iframe>`)
    .join("");
  const outer = `<!doctype html><html><body style="margin:0">${frames}<pre id="out"></pre><script>
addEventListener("load", () => setTimeout(() => {
  const out = {};
  for (const f of document.querySelectorAll("iframe")) out[f.name] = f.contentWindow.measured;
  document.getElementById("out").textContent = JSON.stringify(out);
}, 200));</script></body></html>`;
  return dump(dir, outer) as Record<string, Measured>;
}

test("the rc.3 panel fits 1070px at 440 / 544 / 600 / 900 with the 리소스 section open or closed", { skip: noBrowser }, async (t) => {
  const stage = renderStage(VIEW);
  const now = Date.parse(NOW);
  const open = renderResources(await shown(), true, now, 24);
  const closed = renderResources({ kind: "idle" }, false, now);
  const pages: Record<string, string> = {};
  for (const w of WIDTHS) {
    pages[`open-${w}`] = panelPage(stage, open);
    pages[`closed-${w}`] = panelPage(stage, closed);
  }
  const got = measure(pages, (name) => Number(name.split("-")[1]));
  t.diagnostic(Object.entries(got).map(([k, m]) => `${k} content ${m?.contentH} docH ${m?.docH} vh ${m?.vh} resBottom ${m?.res.bottom} underHeading ${m ? m.vh - m.summary.bottom : "?"} underLastLine ${m?.lastLine ? Math.round(m.vh - m.lastLine) : "-"} hscroll ${m?.hscroll}`).join("; "));
  for (const [name, m] of Object.entries(got)) {
    assert.ok(m, `${name}: the page drew`);
    assert.equal(m.vh, HEIGHT, `${name}: the frame is the panel's height`);
    assert.ok(m.docH <= m.vh, `${name}: the document is ${m.docH - m.vh}px taller than the panel`);
    assert.equal(Math.round(m.vh - m.res.bottom), 0, `${name}: the 리소스 section ends at the panel's bottom`);
    assert.ok(m.hscroll <= 0, `${name}: ${m.hscroll}px of horizontal scroll`);
    assert.deepEqual(m.scrollers, [], `${name}: nothing scrolls inside the page`);
  }
  for (const w of WIDTHS) {
    const o = got[`open-${w}`] as Measured;
    const c = got[`closed-${w}`] as Measured;
    // Owner point 3: the open section reads apart from the closed one, by more than its chevron.
    assert.ok(o.summaryWeight > c.summaryWeight, `${w}: the open heading is heavier than the closed one`);
    assert.equal(o.bodyBorder, "1px", `${w}: the open body sits in a 1px frame`);
    // Owner point 4: the reading time and 새로 고침 sit on the heading's own line.
    const s = o.stamp as DOMRect;
    const mid = s.top + s.height / 2;
    assert.ok(mid > o.summary.top && mid < o.summary.bottom, `${w}: the reading time is on the 리소스 line`);
    assert.ok(s.right <= o.summary.right, `${w}: the reading time ends inside the line`);
    // Owner points 1 and 2: the blank under the closed heading and under the open section's last line.
    assert.ok(c.vh - c.summary.bottom <= UNDER_HEADING, `${w}: ${c.vh - c.summary.bottom}px blank under the closed 리소스 line`);
    const underLast = Math.round(o.vh - (o.lastLine as number));
    assert.ok(underLast <= UNDER_LAST_LINE, `${w}: ${underLast}px blank under the open section's last line`);
  }
});

test("a stage taller than the panel keeps a gap above the 리소스 section's rule", { skip: noBrowser }, async () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ id: `i${100 + i}`, cells: [{ text: "📅" }, { text: `i${100 + i} acme task ${i}` }, { text: "—" }, { text: "선행 대기" }, { text: "—" }] }));
  const model = VIEW.model as Extract<typeof VIEW.model, { inProgress: unknown }>;
  const long = { ...VIEW, model: { ...model, inProgress: { ...model.inProgress, count: 60, rows } } } as typeof VIEW;
  const closed = renderResources({ kind: "idle" }, false, Date.parse(NOW));
  const got = measure({ "long-544": panelPage(renderStage(long), closed) }, () => 544);
  const m = got["long-544"] as Measured;
  assert.ok(m.docH > m.vh, `the stage is taller than the panel (${m.docH} vs ${m.vh})`);
  const gap = Math.round(m.res.top - (m.stageEnd as number));
  assert.ok(gap >= STAGE_GAP, `${gap}px between the stage's last line and the 리소스 rule`);
});

test("owner point 5: the open section lists no 'sangsoe 가 만든 것' table and no process line", async () => {
  const html = renderResBody(await shown(), Date.parse(NOW));
  assert.doesNotMatch(html, /sangsoe 가 만든 것|claude 프로세스|node 프로세스|프로세스는 보여 주기만/);
  assert.match(html, /<h3>정리 후보<\/h3>/, "the cleanup list stays");
});
