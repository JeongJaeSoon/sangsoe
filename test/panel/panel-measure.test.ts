import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { RES_OPEN_KEY } from "../../orca-plugin/panel/resources.ts";
import { PARTS_GOT, VIEW } from "../fixtures/panel/rc3-state.ts";
import { scratchDir } from "../scratch.ts";
import { dump, noBrowser, orcaPage } from "./browser.ts";

// U116: the DevTools measurement script, run on the panel's own entry (index.ts) mounted in Orca's
// html page behind a frozen bridge like Orca's, the way the owner pastes it into the real panel.

const ROOT = new URL("../../", import.meta.url).pathname;
const SCRIPT = readFileSync(join(ROOT, "scripts/panel-measure.devtools.js"), "utf8");
const DELAY = { load: 120, made: 60, candidates: 300 } as const;

/** The panel entry and what it imports, as the browser module files Orca serves. */
function transpile(dir: string): void {
  mkdirSync(join(dir, "orca-plugin/panel"), { recursive: true });
  for (const f of ["timer.ts", "panel/index.ts", "panel/refresh.ts", "panel/resources.ts", "panel/style.ts", "panel/view.ts"]) {
    const src = readFileSync(join(ROOT, "orca-plugin", f), "utf8");
    const out = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, rewriteRelativeImportExtensions: true, verbatimModuleSyntax: true },
    });
    writeFileSync(join(dir, "orca-plugin", f.replace(/\.ts$/, ".js")), out.outputText);
  }
}

/**
 * Orca's bridge object is frozen down to plugin.request, so the script cannot wrap it either. With
 * `hold`, the 정리 후보 answer waits for releaseHeld(), so a read stays running however slow the runner.
 */
const bridge = (open: boolean, hold = false) => `<script>
const view = ${JSON.stringify(VIEW)};
const parts = ${JSON.stringify(PARTS_GOT)};
const delay = ${JSON.stringify(DELAY)};
const store = new Map([[${JSON.stringify(RES_OPEN_KEY)}, ${open}]]);
const later = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
const held = new Promise((r) => { window.releaseHeld = r; });
const answer = (part) => ${hold} && part === "candidates" ? held.then(() => later(delay[part], parts[part])) : later(delay[part], parts[part]);
Object.defineProperty(window, "orca", { value: Object.freeze({
  plugin: Object.freeze({
    request: (name, input) => name === "panel.brief" ? later(10, { ok: true, value: view })
      : name === "panel.resources" && input ? answer(input.part)
      : later(10, { ok: false, refusal: { code: "x", reason: "x", fix: "x" } }),
    on: () => undefined,
  }),
  storage: Object.freeze({ get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); } }),
}) });
</script>\n`;

/** Paste the script `at` ms after load, after `before` ran at 700 ms (the first read has ended by then). */
const run = (at = 1000, before = "") => `<script>
addEventListener("load", () => {
  setTimeout(() => { ${before} }, 700);
  setTimeout(() => {
    const s = document.createElement("script");
    s.textContent = ${JSON.stringify(SCRIPT)};
    document.body.append(s);
  }, ${at});
});
</script>\n`;

/** Paste the script once a reading row shows, then let the held part answer (CI run 43576209425 pasted after the read ended). */
const runWhileReading = (after = 500) => `<script>
addEventListener("load", () => {
  const paste = () => {
    if (!document.querySelector("#res .pending")) return setTimeout(paste, 20);
    const s = document.createElement("script");
    s.textContent = ${JSON.stringify(SCRIPT)};
    document.body.append(s);
    window.releaseHeld();
  };
  setTimeout(paste, ${after});
});
</script>\n`;

type Out = {
  mode: string;
  error?: string;
  first_read_ms: Record<string, number | null>;
  paints_ms: number[];
  timed_out: boolean;
  width: number;
  hscroll: number;
  doc_scrolls: boolean;
  nested_scrollers: number;
  res_gap_to_viewport_bottom: number;
  res_gap_to_page_end: number;
  stamp_on_heading: boolean;
  tail: string;
} & Spacing & { folded?: Spacing };

type Spacing = {
  res_space_above: number;
  res_space_below: number;
  res_card_pad_top: number | null;
  res_card_pad_bottom: number | null;
  res_arrow_off: number;
};

/** U123 (decision 253): each pair the owner saw as uneven, within 2px; returns what is not. */
function uneven(at: string, m: Spacing | undefined, open: boolean): string[] {
  if (!m) return [`${at}: no spacing measured`];
  const out: string[] = [];
  const near = (a: number | null, b: number | null, what: string) => {
    if (a === null || b === null || Math.abs(a - b) > 2) out.push(`${at}: ${what} ${a} vs ${b}`);
  };
  near(m.res_space_above, m.res_space_below, "space above the 리소스 title vs below the section");
  near(m.res_arrow_off, 0, "arrow centre vs title centre");
  if (open) near(m.res_card_pad_top, m.res_card_pad_bottom, "card padding top vs bottom");
  else if (m.res_card_pad_top !== null) out.push(`${at}: a closed section has no card`);
  return out;
}

test("the measurement script times the first open per part and the panel's layout, on the panel's own DOM", { skip: noBrowser }, (t) => {
  const dir = scratchDir("sangsoe-measure-");
  transpile(dir);
  const entry = '<script type="module" src="./orca-plugin/panel/index.js"></script>\n';
  const pages = {
    closed: orcaPage(bridge(false), entry + run()),
    open: orcaPage(bridge(true), entry + run()),
    // Read, then folded without reloading the frame: opening it again would only repaint that reading.
    reread: orcaPage(bridge(true), entry + run(1000, `document.querySelector("#res details.res-fold").open = false;`)),
    // Pasted while the panel's own first read is still running, late enough that an unheld read has ended.
    busy: orcaPage(bridge(true, true), entry + runWhileReading()),
  };
  for (const [name, html] of Object.entries(pages)) writeFileSync(join(dir, `${name}.html`), html);
  const frames = Object.keys(pages).map((n) => `<iframe name="${n}" src="${n}.html" style="display:block;border:0;width:544px;height:1070px"></iframe>`).join("\n");
  const outer = `<!doctype html><html><body style="margin:0">
${frames}
<pre id="out"></pre><script>
const read = () => {
  const got = {};
  for (const f of document.querySelectorAll("iframe")) got[f.name] = f.contentWindow.sangsoeMeasure ?? null;
  if (Object.values(got).some((v) => v === null)) return setTimeout(read, 100);
  document.getElementById("out").textContent = JSON.stringify(got);
};
addEventListener("load", () => setTimeout(read, 100));
</script></body></html>`;
  const got = dump(dir, outer, 20_000) as { closed: Out; open: Out; reread: Out; busy: Out };
  assert.match(got.reread.error ?? "", /^already_read/, "a frame that has read once gives no first-read times");
  assert.equal(got.reread.first_read_ms, undefined);
  assert.match(got.busy.error ?? "", /^busy/, "a read already running is not timed as a refresh");
  assert.equal(got.busy.first_read_ms, undefined);
  t.diagnostic(`SANGSOE_MEASURE ${JSON.stringify(got)}`);

  const c = got.closed;
  assert.equal(c.mode, "first_open");
  assert.equal(c.timed_out, false, "the done condition is met");
  const load = c.first_read_ms["PC 부하"] ?? -1;
  const cand = c.first_read_ms["정리 후보"] ?? -1;
  assert.ok(load >= DELAY.load && load < DELAY.candidates, `PC 부하 painted at ${load}ms, when its answer came`);
  assert.ok(cand >= DELAY.candidates, `정리 후보 painted at ${cand}ms`);
  assert.ok((c.first_read_ms.all ?? -1) >= cand, "the whole read ends with its last part");

  const o = got.open;
  assert.equal(o.mode, "refresh", "an open fold is timed by 새로 고침");
  assert.equal(o.timed_out, false);
  assert.deepEqual(Object.keys(o.first_read_ms), ["all"], "no part is timed while the last reading stands in");
  assert.ok((o.first_read_ms.all ?? -1) >= DELAY.candidates);
  assert.ok(o.paints_ms.length >= 2, "each part's answer repaints");

  for (const m of [c, o]) {
    assert.equal(m.width, 544);
    assert.equal(m.doc_scrolls, false);
    assert.ok(m.hscroll <= 0);
    assert.equal(m.nested_scrollers, 0);
    assert.equal(m.res_gap_to_viewport_bottom, 0);
    assert.equal(m.res_gap_to_page_end, 0);
    assert.equal(m.stamp_on_heading, true);
    assert.match(m.tail, /상세: sangsoe brief/);
  }
  assert.equal(o.folded, undefined, "a refresh never sees the section closed");
  assert.deepEqual([...uneven("closed", c.folded, false), ...uneven("first open", c, true), ...uneven("refresh", o, true)], []);
});
