import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { RES_OPEN_KEY, readParts } from "../../orca-plugin/panel/resources.ts";
import { REFRESH_MS } from "../../orca-plugin/panel/view.ts";
import { NOW, PARTS_GOT, VIEW } from "../fixtures/panel/rc3-state.ts";
import { scratchDir } from "../scratch.ts";
import { dump, noBrowser, orcaPage, transpilePanel } from "./browser.ts";

// Decision 257 on the panel's own entry in Orca's html page: the 리소스 section reads on the panel's
// tick while open and shown, asks 정리 후보 only on show, open and refresh, never runs two reads at
// once, and rewrites only what changed. The page's clock is the injected one: its 30-second
// interval runs every TICK ms, and document.visibilityState is the frame's own `vis`.

const TICK = 1000;
const ROW = { ref: "inst-a", name: "acme-api-old", path: "/w/acme-api-old", gone: false, state: "finished", why: "PR merged", kb: 2048 };

type Cfg = { vary?: boolean; rows?: boolean; slow?: boolean; old?: boolean };

const bridge = (cfg: Cfg) => `<script>
const fast = setInterval;
window.setInterval = (fn, ms, ...a) => fast(fn, ms === ${REFRESH_MS} ? ${TICK} : ms, ...a);
// The panel's clock runs window.skew ms ahead of the answers' own times.
const realNow = Date.now;
window.skew = 0;
Date.now = () => realNow() + window.skew;
window.vis = "visible";
Object.defineProperty(document, "visibilityState", { get: () => window.vis, configurable: true });
const view = ${JSON.stringify(VIEW)};
const base = ${JSON.stringify(PARTS_GOT)};
const cfg = ${JSON.stringify(cfg)};
const row = ${JSON.stringify(ROW)};
const store = new Map([[${JSON.stringify(RES_OPEN_KEY)}, true]]);
const later = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
window.asks = [];
window.wholes = 0;
window.overlap = 0;
const whole = () => {
  const l = base.load.value, m = base.made.value, c = base.candidates.value;
  return { ok: true, value: { at: new Date().toISOString(), load: l.load, episode: l.episode, made: m.made, worktrees: c.worktrees, tmp: c.tmp, trash: c.trash } };
};
const open = {};
const reply = (part) => {
  const r = structuredClone(base[part]);
  r.value.at = new Date().toISOString();
  if (part === "load" && cfg.vary) r.value.load.value.loadPerCpu = 0.3 + asks.length / 10;
  if (part === "candidates" && cfg.rows) r.value.worktrees.value.rows = [row];
  return r;
};
Object.defineProperty(window, "orca", { value: Object.freeze({
  plugin: Object.freeze({
    request: (name, input) => {
      if (name === "panel.brief") return later(10, { ok: true, value: view });
      if (name !== "panel.resources") return later(10, { ok: false, refusal: { code: "x", reason: "x", fix: "x" } });
      if (!input) {
        wholes += 1;
        return later(50, whole());
      }
      const part = input.part;
      if (cfg.old) {
        asks.push(part);
        return later(10, { ok: false, refusal: { code: "core_old", reason: "this core reads the section whole", fix: "read it whole" } });
      }
      if (open[part]) overlap += 1;
      open[part] = true;
      asks.push(part);
      return later(cfg.slow && asks.length > 3 ? 500 : 50).then(() => { open[part] = false; return reply(part); });
    },
    on: () => undefined,
  }),
  storage: Object.freeze({ get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); } }),
}) });
</script>\n`;

/** Steps at virtual times after load; `out` collects what the outer page reads. */
const steps = (s: Record<number, string>) => `<script>
window.out = {};
const res = () => document.getElementById("res");
const body = () => res().querySelector(".res-body");
const tag = () => { for (const e of body().children) e.__kept = true; };
const kept = (sel) => body().querySelector(sel)?.__kept === true;
const marks = () => [...body().childNodes].filter((n) => n.nodeType === 8).map((n) => n.nodeValue);
const press = (what) => res().querySelector('[data-res="' + what + '"]').click();
const show = (v) => { window.vis = v; document.dispatchEvent(new Event("visibilitychange")); };
const tick = () => ({ ...res().dataset });
addEventListener("load", () => {
${Object.entries(s)
  .map(([at, code]) => `  setTimeout(() => { ${code} }, ${at});`)
  .join("\n")}
});
</script>\n`;

const frames: Record<string, { cfg: Cfg; steps: Record<number, string> }> = {
  same: {
    cfg: {},
    steps: {
      500: "out.first = [...asks].sort(); out.marks = marks(); tag();",
      3500: "out.asks = [...asks]; out.kept = [...body().children].filter((e) => !e.matches('.res-h')).every((e) => e.__kept === true); out.tick = tick(); out.done = true;",
    },
  },
  load: {
    cfg: { vary: true },
    steps: {
      500: "tag();",
      1500: "out.loadKept = kept('.load-h'); out.candKept = [...body().querySelectorAll('h3')].find((h) => h.textContent === '정리 후보')?.__kept === true; out.tick = tick(); out.done = true;",
    },
  },
  hidden: {
    cfg: {},
    steps: {
      300: "show('hidden');",
      3300: "out.hidden = asks.length; show('visible');",
      3400: "out.shown = asks.slice(3);",
      4500: "out.after = asks.slice(6); out.done = true;",
    },
  },
  confirm: {
    cfg: { rows: true },
    steps: {
      500: "press('ask');",
      3500: "out.asks = asks.length; out.confirm = !!res().querySelector('.confirm'); out.done = true;",
    },
  },
  late: {
    cfg: { rows: true, slow: true },
    steps: {
      1200: "out.inFlight = asks.length; press('ask');",
      1800: "out.confirm = !!res().querySelector('.confirm'); out.tick = tick();",
      3500: "out.asks = asks.length; out.done = true;",
    },
  },
  // 정리 후보 falls due on the 2 s tick (the clock jumped 4.5 min); 정리… during that read drops it,
  // so the 3 s tick must ask 정리 후보 again.
  dropped: {
    cfg: { rows: true, slow: true },
    steps: {
      1200: "window.skew = 270000;",
      2200: "press('ask');",
      2600: "press('cancel');",
      3700: "out.asks = asks.slice(3); out.done = true;",
    },
  },
  old: {
    cfg: { old: true },
    steps: {
      3500: "out.asks = asks.length; out.wholes = wholes; out.done = true;",
    },
  },
  refresh: {
    cfg: { slow: true },
    steps: {
      1200: "out.inFlight = asks.length; press('refresh'); out.reading = res().querySelector('.fresh').textContent; out.asksAtPress = asks.length;",
      1600: "out.loud = asks.slice(5);",
      2700: "out.overlap = overlap; out.stamp = res().querySelector('.fresh').textContent; out.done = true;",
    },
  },
};

test("257: a part asked again that fails keeps its last answer, and the reading is as old as its oldest part", async () => {
  const kept = await readParts(async (input) => PARTS_GOT[input?.part ?? "load"], () => undefined);
  assert.ok(kept.kind === "shown" && kept.got);
  const later = new Date(Date.parse(NOW) + 60_000).toISOString();
  const fresh = (p: "load" | "made") => {
    const r = PARTS_GOT[p];
    assert.ok(r.ok);
    return { ok: true, value: { ...r.value, at: later } };
  };
  const asked: string[] = [];
  const s = await readParts(
    async (input) => {
      asked.push(input?.part ?? "whole");
      return input?.part === "load" ? { ok: false, refusal: { code: "orca_error", reason: "x", fix: "x" } } : fresh("made");
    },
    () => undefined,
    { parts: ["load", "made"], kept: kept.got },
  );
  assert.deepEqual(asked, ["load", "made"]);
  assert.ok(s.kind === "shown" && s.got);
  assert.equal(s.got.load, kept.got.load, "the failed part keeps the kept answer");
  assert.equal(s.got.candidates, kept.got.candidates, "the part not asked comes from kept");
  assert.equal(s.view.at, NOW, "the oldest part's time");
  assert.ok(s.view.load.ok);
});

test("257: the section reads on the panel's tick while open and shown, one read at a time, rewriting only what changed", { skip: noBrowser }, (t) => {
  const dir = scratchDir("sangsoe-257-");
  transpilePanel(dir);
  const entry = '<script type="module" src="./orca-plugin/panel/index.js"></script>\n';
  for (const [name, f] of Object.entries(frames)) writeFileSync(join(dir, `${name}.html`), orcaPage(bridge(f.cfg), entry + steps(f.steps)));
  const iframes = Object.keys(frames)
    .map((n) => `<iframe name="${n}" src="${n}.html" style="display:block;border:0;width:544px;height:1070px"></iframe>`)
    .join("\n");
  const outer = `<!doctype html><html><body style="margin:0">
${iframes}
<pre id="out"></pre><script>
const read = () => {
  const got = {};
  for (const f of document.querySelectorAll("iframe")) got[f.name] = f.contentWindow.out ?? null;
  if (Object.values(got).some((v) => !v?.done)) return setTimeout(read, 100);
  document.getElementById("out").textContent = JSON.stringify(got);
};
addEventListener("load", () => setTimeout(read, 100));
</script></body></html>`;
  // biome-ignore lint/suspicious/noExplicitAny: the page's own JSON
  const got = dump(dir, outer, 20_000) as Record<string, any>;
  t.diagnostic(JSON.stringify(got));

  const s = got.same;
  assert.deepEqual(s.first, ["candidates", "load", "made"], "a mount with the fold stored open asks each part once");
  assert.deepEqual(s.marks, ["res:note", "res:load", "res:made", "res:candidates"], "the pieces are marked by comments, not elements");
  assert.deepEqual(s.asks.slice(3), ["load", "made", "load", "made", "load", "made"], "each tick asks load and made only");
  assert.equal(s.kept, true, "an unchanged answer rewrites no element");
  assert.equal(s.tick.tickPaint, "none");
  assert.equal(s.tick.tickParts, "load+made");
  assert.ok(Number(s.tick.tickMs) >= 50, `the tick's cost is kept: ${s.tick.tickMs}ms`);

  assert.equal(got.load.tick.tickPaint, "load", "a moving gauge rewrites the load piece alone");
  assert.equal(got.load.loadKept, false);
  assert.equal(got.load.candKept, true, "정리 후보 stays as it was drawn");

  assert.deepEqual(
    got.dropped.asks,
    ["load", "made", "load", "made", "candidates", "load", "made", "candidates"],
    "a dropped 정리 후보 answer does not count as read: the next tick asks again",
  );

  assert.equal(got.old.asks, 3, "a core that reads only whole is asked in parts once, at mount");
  assert.equal(got.old.wholes, 1, "and its ticks read nothing");

  assert.equal(got.hidden.hidden, 3, "a hidden panel's ticks read nothing");
  assert.deepEqual([...got.hidden.shown].sort(), ["candidates", "load", "made"], "shown again: all three at once");
  assert.deepEqual(got.hidden.after, ["load", "made"], "then the tick resumes");

  assert.equal(got.confirm.asks, 3, "no tick reads while the confirm list is open");
  assert.equal(got.confirm.confirm, true);

  assert.equal(got.late.inFlight, 5, "a tick was in flight when 정리… was pressed");
  assert.equal(got.late.confirm, true, "its answer does not close the confirm list");
  assert.equal(got.late.tick.tickPaint, undefined, "and is dropped");
  assert.equal(got.late.asks, 5);

  const r = got.refresh;
  assert.equal(r.inFlight, 5);
  assert.equal(r.reading, "읽는 중…", "새로 고침 during a tick shows the reading row at once");
  assert.equal(r.asksAtPress, 5, "and asks nothing while the tick runs");
  assert.deepEqual([...r.loud].sort(), ["candidates", "load", "made"], "then reads all three after it");
  assert.equal(r.overlap, 0, "no part is ever asked while it is still being read");
  assert.match(r.stamp, /읽음$/);
});

// Focus needs the page itself: a frame inside another page never takes it in headless Chrome.
test("257: focus in a piece a tick rewrites goes back to the same button", { skip: noBrowser }, () => {
  const dir = scratchDir("sangsoe-257f-");
  transpilePanel(dir);
  const entry = '<script type="module" src="./orca-plugin/panel/index.js"></script>\n';
  const report = `const pre = document.createElement("pre"); pre.id = "out"; pre.textContent = JSON.stringify(out); document.body.append(pre);`;
  const page = orcaPage(
    bridge({ vary: true }),
    entry +
      steps({
        500: "res().querySelector('[data-res=\"h24\"]').focus(); out.before = document.activeElement?.getAttribute('data-res') ?? null;",
        1500: `out.after = document.activeElement?.getAttribute('data-res') ?? null; out.tick = tick(); ${report}`,
      }),
  );
  const got = dump(dir, page, 5000) as { before: string | null; after: string | null; tick: { tickPaint?: string } };
  assert.equal(got.before, "h24");
  assert.equal(got.tick.tickPaint, "load", "the tick rewrote the piece holding focus");
  assert.equal(got.after, "h24");
});
