import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { STYLE } from "../../orca-plugin/panel/style.ts";
import { type PanelView, renderStage } from "../../orca-plugin/panel/view.ts";
import { VIEW } from "../fixtures/panel/rc3-state.ts";
import { scratchDir } from "../scratch.ts";
import { dump, noBrowser, orcaPage } from "./browser.ts";

// U117 (owner point 6): the block above 열린 항목 at the owner's panel height, at the widths decision 248 measures.

const HEIGHT = 1070;
const WIDTHS = [440, 544, 600, 900] as const;

type Model = Extract<PanelView["model"], { stage: 1 }>;
const calm = VIEW;
const model = VIEW.model as Model;
const decision = { id: "d201", cells: [{ text: "d201" }, { text: "acme 배포 순서?" }, { text: "먼저 api" }, { text: "acme-api-503" }, { text: "2h" }] };
const busy = {
  ...VIEW,
  model: { ...model, todo: { total: 1, decisions: 1, other: 0 }, decisions: { ...model.decisions, count: 1, rows: [decision] } },
} as PanelView;

type Block = { tag: string; cls: string; text: string; h: number; size: number; weight: number; shown: boolean };
type Head = { top: number; prog: number; blocks: Block[] };

function measure(pages: Record<string, string>): Record<string, Head> {
  const dir = scratchDir("sangsoe-head-");
  const probe = `<script>addEventListener("load", () => {
  const main = document.querySelector("main");
  const prog = document.querySelector('section[aria-labelledby="h-prog"]');
  const blocks = [];
  for (const e of main.children) {
    if (e === prog) break;
    const s = getComputedStyle(e.matches("section") ? e.querySelector("h2") ?? e : e);
    // Kept out of the accessibility tree by display, visibility or aria-hidden; clipping keeps it in.
    const shown = s.display !== "none" && s.visibility === "visible" && !e.closest("[aria-hidden=true]");
    blocks.push({ tag: e.tagName.toLowerCase(), cls: e.className, text: e.textContent.trim(), h: Math.round(e.getBoundingClientRect().height), size: parseFloat(s.fontSize), weight: Number(s.fontWeight), shown });
  }
  window.head = { top: Math.round(main.getBoundingClientRect().top), prog: Math.round(prog.getBoundingClientRect().top), blocks };
});</script>`;
  for (const [name, stage] of Object.entries(pages)) {
    writeFileSync(join(dir, `${name}.html`), orcaPage(`<style>${STYLE}</style>\n`, `<script>document.getElementById("root").innerHTML = ${JSON.stringify(stage)};</script>\n${probe}\n`));
  }
  const frames = Object.keys(pages)
    .map((name) => `<iframe name="${name}" src="${name}.html" style="display:block;border:0;width:${name.split("-")[1]}px;height:${HEIGHT}px"></iframe>`)
    .join("");
  const outer = `<!doctype html><html><body style="margin:0">${frames}<pre id="out"></pre><script>
addEventListener("load", () => setTimeout(() => {
  const out = {};
  for (const f of document.querySelectorAll("iframe")) out[f.name] = f.contentWindow.head;
  document.getElementById("out").textContent = JSON.stringify(out);
}, 200));</script></body></html>`;
  return dump(dir, outer) as Record<string, Head>;
}

test("owner point 6: the status line leaves the screen but not the accessibility tree, and two empty owner sections are one line", { skip: noBrowser }, (t) => {
  const pages: Record<string, string> = {};
  for (const w of WIDTHS) {
    pages[`calm-${w}`] = renderStage(calm);
    pages[`busy-${w}`] = renderStage(busy);
  }
  const got = measure(pages);
  t.diagnostic(
    Object.entries(got)
      .map(([k, m]) => `${k} above-열린항목 ${m.prog - m.top}px [${m.blocks.map((b) => `${b.tag}${b.cls ? `.${b.cls}` : ""} ${b.h}px ${b.size}/${b.weight}`).join(", ")}]`)
      .join("; "),
  );
  for (const w of WIDTHS) {
    const c = got[`calm-${w}`] as Head;
    const b = got[`busy-${w}`] as Head;
    for (const m of [c, b]) {
      const h1 = m.blocks.filter((x) => x.tag === "h1");
      assert.equal(h1.length, 1, `${w}: stage 1 keeps its one h1`);
      assert.ok((h1[0]?.h ?? 99) <= 1, `${w}: the h1 takes ${h1[0]?.h}px on screen`);
      assert.ok(h1[0]?.shown, `${w}: a screen reader still reads the h1`);
      assert.match(h1[0]?.text ?? "", /^현황 · 묶음 1 · 내가 할 일 \d/);
    }
    // rc.4 before this: 152px with nothing for the owner to do; 94 after (95 on the ubuntu runner's fonts).
    assert.ok(c.prog - c.top <= 110, `${w}: ${c.prog - c.top}px above 열린 항목`);
    const owner = c.blocks.filter((x) => /결정 필요|오너가 할 일/.test(x.text));
    assert.equal(owner.length, 1, `${w}: one line says both owner counts are 0`);
    assert.match(owner[0]?.text ?? "", /결정 필요 0.*오너가 할 일 0.*없음/);
    // A decision to answer keeps today's two sections: the owner's call to act.
    assert.ok(b.blocks.some((x) => x.tag === "section" && /결정 필요 1/.test(x.text) && x.h > 40), `${w}: the open decision keeps its table`);
    const single = b.blocks.find((x) => x.tag === "section" && /^지금 오너가 할 일 0\s*없음$/.test(x.text));
    assert.ok(single, `${w}: 오너 할 일 keeps its own line`);
    // Measured against a one-line empty section in the same fonts, since a runner's fonts shift heights by a pixel.
    assert.ok((owner[0]?.h ?? 99) <= single.h, `${w}: that line is one line (${owner[0]?.h}px, an empty section ${single.h}px)`);
  }
});

test("owner point 6: the collapsed line rides with the 할 일 tab and only when both counts are 0", () => {
  const html = renderStage(calm);
  assert.equal(html.match(/data-tab="todo"/g)?.length, 1, "one line in the 할 일 view");
  assert.doesNotMatch(html, /aria-labelledby="h-(?:dec|me)"/);
  const other = { ...VIEW, model: { ...model, todo: { total: 1, decisions: 0, other: 1 }, ownerTodo: { ...model.ownerTodo, count: 1, rows: [{ id: "i040", cells: [{ text: "i040" }, { text: "acme 로그인" }, { text: "—" }, { text: "—" }, { text: "1h" }] }] } } } as PanelView;
  for (const v of [busy, other]) {
    const two = renderStage(v);
    assert.match(two, /aria-labelledby="h-dec"/);
    assert.match(two, /aria-labelledby="h-me"/);
    assert.equal(two.match(/data-tab="todo"/g)?.length, 2);
  }
});
