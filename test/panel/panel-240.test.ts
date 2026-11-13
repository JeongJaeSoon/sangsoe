import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { type ResView, renderResBody } from "../../orca-plugin/panel/resources.ts";
import { STYLE } from "../../orca-plugin/panel/style.ts";

// Decision 240: what the owner recorded and only the owner clears is listed under 기록됨·오너 손,
// with nothing to press.

const AT = "2026-11-14T03:00:00.000Z";
const NOW = Date.parse(AT) + 60_000;
const ok = <T>(value: T) => ({ ok: true as const, value });

type Rec = { kind: string; ref: string; owner: string; since: string };
const view = (recorded?: Rec[]): ResView => ({
  at: AT,
  load: ok({ level: "ok" as const, reasons: [], loadPerCpu: 0.2, memFreePct: 60, diskFreeGb: 66 }),
  episode: { state: "none" },
  band: null,
  made: {
    worktrees: ok({ count: 1, kb: 1024 }),
    terminals: ok({ count: 1 }),
    processes: ok({ claude: { count: 1, kb: 1024 }, node: { count: 1, kb: 1024 } }),
    tmp: ok({ count: 0, kb: 0 }),
    ...(recorded ? { recorded } : {}),
  },
  worktrees: ok({ rows: [], markOnly: false, unseen: [] }),
  tmp: ok({ count: 0, kb: 0 }),
  trash: true,
});

const owned = (html: string) => {
  const at = html.indexOf("기록됨·오너 손");
  if (at < 0) return "";
  return html.slice(at, html.indexOf("<h3>정리 후보", at));
};

test("recorded rows are listed under 기록됨·오너 손 with kind, ref and owner, and nothing to press", () => {
  const html = renderResBody({ kind: "shown", view: view([{ kind: "checkout", ref: "/tmp/<x>", owner: "task_a", since: AT }]) }, NOW);
  const block = owned(html);
  assert.ok(block, "the list is drawn");
  assert.match(block, /checkout/);
  assert.match(block, /task_a/);
  assert.match(block, /\/tmp\/&lt;x&gt;/, "the ref is escaped");
  assert.doesNotMatch(block, /data-res=|<button/, "no control: sangsoe never clears these");
});

test("no recorded row, or a core that does not send them, draws no list", () => {
  assert.equal(owned(renderResBody({ kind: "shown", view: view([]) }, NOW)), "");
  assert.equal(owned(renderResBody({ kind: "shown", view: view() }, NOW)), "");
});

// PANEL_PREVIEW_DIR=<dir> writes the open section with a long path and many rows at 440 / 600 / 900px
// for the headless measure (ui-review): overflow, nested scrollers, wrapping, row heights.
test("preview pages for the owner list (only with PANEL_PREVIEW_DIR)", { skip: !process.env.PANEL_PREVIEW_DIR }, () => {
  const dir = process.env.PANEL_PREVIEW_DIR ?? "";
  mkdirSync(dir, { recursive: true });
  const long = `/tmp/${"deep-folder/".repeat(12)}checkout-with-a-very-long-name`;
  const many: Rec[] = [
    { kind: "checkout", ref: long, owner: "task_0123456789abcdef", since: AT },
    ...Array.from({ length: 24 }, (_, i) => ({ kind: ["branch", "file", "process", "registration"][i % 4] ?? "file", ref: `ref-${i}`, owner: `task_${i}`, since: AT })),
  ];
  const measure = `<script>addEventListener("load",()=>{const r=document.getElementById("res");const q=(s)=>[...r.querySelectorAll(s)];const box=(e)=>e.getBoundingClientRect();const out=q("*").filter(e=>box(e).right>box(r).right+0.5).map(e=>e.className||e.tagName);const scrollers=q("*").filter(e=>{const s=getComputedStyle(e);return /(auto|scroll)/.test(s.overflowX+s.overflowY)&&(e.scrollHeight>e.clientHeight||e.scrollWidth>e.clientWidth);}).length;const rows={};for(const t of q("table.owned tbody tr")){const h=Math.round(box(t).height);rows[h]=(rows[h]||0)+1;}const wrapped=q("table.owned td").filter(e=>e.scrollHeight>36).length;const p=document.createElement("pre");p.id="measure";p.textContent=JSON.stringify({pageOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,resOverflow:out,scrollers,rowHeights:rows,wrapped});document.body.append(p);});</script>`;
  for (const [name, rows] of [["one", many.slice(0, 1)], ["many", many]] as const) {
    for (const width of [440, 600, 900]) {
      const page = `<!doctype html><html lang="ko" class="light"><head><meta charset="utf-8"><style>${STYLE}</style></head><body style="width:${width}px;margin:0"><section id="res">${renderResBody({ kind: "shown", view: view(rows) }, NOW)}</section>${measure}</body></html>`;
      writeFileSync(join(dir, `owned-${name}-${width}.html`), page);
    }
  }
});
