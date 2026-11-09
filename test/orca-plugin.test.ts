// Plugin tests live outside orca-plugin/ so they are not part of the folder Orca fingerprints.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { coreUrl, type PanelCore } from "../orca-plugin/core-link.ts";
import activate, { deactivate, EVENTS, type OrcaWorker } from "../orca-plugin/main.ts";
import { type ExecProbe, meetsSqliteFloor, ownKey, probeExec, probeSqlite } from "../orca-plugin/probe.ts";
import { type Clock, startRounds } from "../orca-plugin/timer.ts";

const root = new URL("..", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("orca-plugin/orca-plugin.json", root), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));

test("manifest version is the package.json version (decision 99)", () => {
  assert.equal(manifest.version, pkg.version);
});

test("manifest is a trusted worker with the four events, a panel and a status bar item", () => {
  assert.equal(manifest.execution, "trusted-worker");
  assert.equal(manifest.id, "sangsoe");
  assert.equal(manifest.publisher, undefined, "publisher is derived by Orca");
  assert.deepEqual(manifest.contributes.events.map((e: { on: string }) => e.on).sort(), [...EVENTS].sort());
  const commandIds = manifest.contributes.commands.map((c: { id: string }) => c.id);
  for (const item of manifest.contributes.statusBarItems) assert.ok(commandIds.includes(item.command));
});

test("decision 35 SQLite floor", () => {
  for (const ok of ["3.51.3", "3.52.0", "3.50.7", "3.44.6", "4.0.0"]) assert.ok(meetsSqliteFloor(ok), ok);
  for (const bad of ["3.51.2", "3.50.6", "3.44.5", "3.45.0", "3.49.9", "2.9.9"]) assert.ok(!meetsSqliteFloor(bad), bad);
});

test("ownKey picks the one sangsoe key and refuses ambiguity", () => {
  const list = (...keys: string[]) => JSON.stringify({ ok: true, result: { plugins: keys.map((pluginKey) => ({ pluginKey })) } });
  assert.equal(ownKey(list("acme.monitor", "local.sangsoe")), "local.sangsoe");
  assert.equal(ownKey(list("acme.monitor")), null);
  assert.equal(ownKey(list("local.sangsoe", "acme.sangsoe")), null);
  assert.equal(ownKey(list("local.sangsoe").slice(0, 20)), null, "a cut-off list is not a crash");
  for (const odd of ["null", '{"result":{"plugins":{}}}', '{"result":{"plugins":[null]}}', '{"result":{"plugins":[{}]}}']) {
    assert.equal(ownKey(odd), null, odd);
  }
});

test("probeExec keeps parseable output whole when asked", async () => {
  const long = "x".repeat(5000);
  const capped = await probeExec(process.execPath, ["-e", `process.stdout.write("${long}")`]);
  assert.equal(capped.out.length, 2000);
  const whole = await probeExec(process.execPath, ["-e", `process.stdout.write("${long}")`], 8000, Number.POSITIVE_INFINITY);
  assert.equal(whole.out.length, 5000);
});

test("probeSqlite opens, writes and reads the version", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sangsoe-probe-"));
  try {
    const r = await probeSqlite(join(dir, "t1.db"));
    assert.ok(r.ok, JSON.stringify(r));
    if (r.ok) {
      assert.equal(r.rows, 1);
      assert.match(r.sqlite, /^3\.\d+\.\d+$/);
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});

function fakeClock() {
  let now = 0;
  // ms 0 marks a one-shot timer (`after`), removed once it fires.
  const timers: { ms: number; next: number; fn: () => void }[] = [];
  const add = (t: { ms: number; next: number; fn: () => void }) => {
    timers.push(t);
    return () => {
      const i = timers.indexOf(t);
      if (i >= 0) timers.splice(i, 1);
    };
  };
  const clock: Clock = {
    now: () => now,
    every: (ms, fn) => add({ ms, next: now + ms, fn }),
    after: (ms, fn) => add({ ms: 0, next: now + ms, fn }),
  };
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const t = timers.filter((x) => x.next <= end).sort((a, b) => a.next - b.next)[0];
      if (!t) break;
      now = t.next;
      if (t.ms === 0) timers.splice(timers.indexOf(t), 1);
      else t.next += t.ms;
      t.fn();
      await new Promise((r) => setImmediate(r));
    }
    now = end;
  };
  return { clock, advance, timers };
}

const settle = () => new Promise((r) => setImmediate(r));

test("hints coalesce inside the debounce window into one round, marked as a hint", async () => {
  const { clock, advance } = fakeClock();
  const triggers: number[] = [];
  const rounds = startRounds([{ id: "m", intervalMs: 60_000, run: (at) => void triggers.push(at) }], clock, { debounceMs: 1000 });
  rounds.hint("m");
  await advance(200);
  rounds.hint("m");
  rounds.hint("m");
  await advance(1000);
  assert.deepEqual(triggers, [1000], "three hints, one round, debounceMs after the first");
  const s = rounds.stats().m;
  assert.equal(s?.hints, 3);
  assert.equal(s?.runs, 1);
  assert.equal(s?.lastTrigger, "hint");
  assert.deepEqual(s?.gapsMs, [], "a hint round is not a timer tick, so it adds no gap");
  assert.equal(rounds.hint("nope"), false, "an unknown monitor is refused, not created");
  rounds.stop();
});

test("a hint while a round runs re-runs once after it, never alongside it", async () => {
  const { clock, advance } = fakeClock();
  let release: () => void = () => {};
  let running = 0;
  let maxRunning = 0;
  let started = 0;
  const rounds = startRounds(
    [
      {
        id: "m",
        intervalMs: 10_000,
        run: () =>
          new Promise<void>((r) => {
            started++;
            running++;
            maxRunning = Math.max(maxRunning, running);
            release = () => {
              running--;
              r();
            };
          }),
      },
    ],
    clock,
    { debounceMs: 100 },
  );
  await advance(10_000);
  assert.equal(started, 1);
  rounds.hint("m");
  rounds.hint("m");
  await advance(500);
  assert.equal(started, 1, "the hinted round waits for the running one");
  release();
  await settle();
  await advance(100);
  assert.equal(started, 2, "pending hints run exactly one more round");
  release();
  await settle();
  await advance(1000);
  assert.equal(started, 2);
  assert.equal(maxRunning, 1);
  rounds.stop();
});

test("a round over its cap is aborted and counted, and single-flight holds until it settles", async () => {
  const { clock, advance } = fakeClock();
  let signal: AbortSignal | undefined;
  let finish: () => void = () => {};
  let started = 0;
  const rounds = startRounds(
    [
      {
        id: "m",
        intervalMs: 1000,
        capMs: 300,
        run: (_at, s) =>
          new Promise<void>((r) => {
            started++;
            signal = s;
            finish = r;
          }),
      },
    ],
    clock,
  );
  await advance(1000);
  assert.equal(signal?.aborted, false);
  await advance(300);
  assert.equal(signal?.aborted, true, "the cap aborts the round's signal");
  assert.equal(rounds.stats().m?.timeouts, 1);
  await advance(1000);
  assert.equal(started, 1, "an aborted round that has not returned still blocks the next tick");
  finish();
  await settle();
  await advance(1000);
  assert.equal(started, 2);
  rounds.stop();
});

test("stop cancels pending hints and the cap timer", async () => {
  const { clock, advance, timers } = fakeClock();
  const rounds = startRounds([{ id: "m", intervalMs: 1000, capMs: 300, run: () => new Promise<void>(() => {}) }], clock);
  await advance(1000);
  rounds.hint("m");
  rounds.stop();
  assert.equal(timers.length, 0);
});

test("after stop, a hint or the end of the in-flight round starts nothing", async () => {
  const { clock, advance, timers } = fakeClock();
  let started = 0;
  let signal: AbortSignal | undefined;
  let finish: () => void = () => {};
  const rounds = startRounds(
    [
      {
        id: "m",
        intervalMs: 1000,
        run: (_at, s) =>
          new Promise<void>((r) => {
            started++;
            signal = s;
            finish = r;
          }),
      },
    ],
    clock,
    { debounceMs: 100 },
  );
  await advance(1000);
  rounds.hint("m");
  let stoppedAll = false;
  const stopping = rounds.stop().then(() => {
    stoppedAll = true;
  });
  assert.equal(signal?.aborted, true, "stop aborts the round in flight");
  rounds.hint("m");
  assert.equal(timers.length, 0, "a hint after stop arms nothing");
  await settle();
  assert.equal(stoppedAll, false, "stop resolves only once the round returns");
  finish();
  await stopping;
  await advance(5000);
  assert.equal(started, 1, "the hint pending at stop does not run after the round returns");
});

test("rounds run on their interval, record gaps and errors, and stop", async () => {
  const { clock, advance, timers } = fakeClock();
  let ok = 0;
  const rounds = startRounds(
    [
      { id: "a", intervalMs: 10, run: () => void ok++ },
      {
        id: "b",
        intervalMs: 25,
        run: () => {
          throw new Error("boom");
        },
      },
    ],
    clock,
  );
  await advance(50);
  const s = rounds.stats();
  assert.equal(ok, 5);
  assert.deepEqual(s.a?.gapsMs, [10, 10, 10, 10]);
  assert.equal(s.b?.errors, 2);
  assert.equal(s.b?.lastError, "boom");
  rounds.stop();
  assert.equal(timers.length, 0);
});

test("a round still running skips the next tick instead of overlapping", async () => {
  const { clock, advance } = fakeClock();
  let release: () => void = () => {};
  let started = 0;
  const rounds = startRounds(
    [{ id: "slow", intervalMs: 10, run: () => new Promise<void>((r) => { started++; release = r; }) }],
    clock,
  );
  await advance(30);
  assert.equal(started, 1);
  release();
  await new Promise((r) => setImmediate(r));
  await advance(10);
  assert.equal(started, 2);
  assert.equal(rounds.stats().slow?.runs, 2);
  rounds.stop();
});

function fakeWorker() {
  const handlers = new Map<string, (input: unknown) => unknown>();
  const commands = new Map<string, () => unknown>();
  const subscribed: string[] = [];
  const hostCalls: [string, unknown][] = [];
  const orca: OrcaWorker = {
    log: () => {},
    host: { call: async (m, p) => void hostCalls.push([m, p]) },
    events: { on: (e) => void subscribed.push(e) },
    commands: { register: (id, fn) => void commands.set(id, fn) },
    panels: { handle: (n, fn) => void handlers.set(n, fn) },
  };
  return { orca, handlers, commands, subscribed, hostCalls };
}

const ok = (cmd: string, out: string, err = ""): ExecProbe => ({ cmd, ok: true, code: 0, out, err, ms: 1 });

/** A PanelCore whose status line counts up, so each redraw is visible. */
function fakePanel(): { load: () => Promise<PanelCore>; acts: unknown[] } {
  let n = 0;
  const acts: unknown[] = [];
  const core: PanelCore = {
    brief: async (t) => ({ ok: true, value: { target: t } }),
    statusBar: async () => {
      n += 1;
      return { ok: true, value: { text: `🚧${n} · 결정0 · 🔄0`, tone: "neutral", tooltip: "t" } };
    },
    act: async (a) => {
      acts.push(a);
      return { ok: true, value: { status: "answered" } };
    },
  };
  return { load: async () => core, acts };
}

test("activate subscribes, registers and redraws status bar B from the core each round", async () => {
  const w = fakeWorker();
  const { clock, advance } = fakeClock();
  const execs: string[] = [];
  activate(w.orca, {
    clock,
    exec: async (cmd, args) => {
      execs.push([cmd, ...args].join(" "));
      return ok(cmd, "");
    },
    panel: fakePanel().load,
  });
  try {
    assert.deepEqual(w.subscribed.sort(), [...EVENTS].sort());
    assert.deepEqual([...w.commands.keys()], ["sangsoe.open"]);
    assert.deepEqual([...w.handlers.keys()].sort(), ["panel.act", "panel.brief", "probe.exec", "probe.open", "probe.report", "probe.t1"]);
    assert.deepEqual(execs, [], "starting the worker runs no command");
    await advance(60_000);
    const texts = w.hostCalls.map(([, p]) => (p as { text: string }).text);
    assert.deepEqual(texts, ["🚧1 · 결정0 · 🔄0", "🚧2 · 결정0 · 🔄0", "🚧3 · 결정0 · 🔄0"]);
    assert.deepEqual(execs, []);
  } finally {
    deactivate();
  }
});

test("panel requests reach the core unchanged; a malformed act and a missing core are refused", async () => {
  const w = fakeWorker();
  const { clock } = fakeClock();
  const p = fakePanel();
  activate(w.orca, { clock, exec: async (cmd) => ok(cmd, ""), panel: p.load });
  try {
    assert.deepEqual(await w.handlers.get("panel.brief")?.({ group: "api-migration" }), { ok: true, value: { target: { group: "api-migration" } } });
    await w.handlers.get("panel.act")?.({ kind: "answer", decision: "d012", choice: "recommended" });
    const bad = (await w.handlers.get("panel.act")?.({ kind: "close", item: "i035" })) as { ok: boolean };
    assert.equal(bad.ok, false);
    assert.deepEqual(p.acts, [{ kind: "answer", decision: "d012", choice: "recommended" }]);
  } finally {
    deactivate();
  }
  const w2 = fakeWorker();
  activate(w2.orca, { clock, exec: async (cmd) => ok(cmd, ""), panel: async () => "core not found" });
  try {
    const r = (await w2.handlers.get("panel.brief")?.({})) as { ok: boolean; refusal: { code: string } };
    assert.deepEqual([r.ok, r.refusal.code], [false, "core_unavailable"]);
    await new Promise((r) => setImmediate(r));
    assert.equal((w2.hostCalls[0]?.[1] as { text?: string } | undefined)?.text, "sangsoe ?", "no number is guessed");
  } finally {
    deactivate();
  }
});

test("the open command parses stdout only, so stderr noise does not break it", async () => {
  const w = fakeWorker();
  const { clock } = fakeClock();
  const list = JSON.stringify({ ok: true, result: { plugins: [{ pluginKey: "local.sangsoe" }] } });
  const opened: string[] = [];
  activate(w.orca, {
    clock,
    exec: async (cmd, args) => {
      if (args[1] === "list") return ok(cmd, list, "Electron diagnostic line");
      opened.push(args.join(" "));
      return ok(cmd, "{}");
    },
    panel: fakePanel().load,
  });
  try {
    assert.equal(await w.commands.get("sangsoe.open")?.(), "sangsoe: panel opened");
    assert.deepEqual(opened, [`plugin open local.sangsoe --panel ${manifest.contributes.panels[0].id} --json`]);
  } finally {
    deactivate();
  }
});

test("plugin code imports nothing outside orca-plugin/, and only core-link.ts names the core", () => {
  const dir = new URL("orca-plugin/", root);
  const files = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => /\.(m?ts|m?js|tsx)$/.test(f) && !f.startsWith("vendor/"));
  for (const f of files) {
    const depth = f.split("/").length - 1;
    const text = readFileSync(new URL(f, dir), "utf8");
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']*)["']/g)) {
      const ups = (m[1] ?? "").split("/").filter((s) => s === "..").length;
      assert.ok(ups <= depth, `${f} reaches outside the plugin folder: ${m[1]}`);
    }
    // Decisions 132, 152: the one run-time path outside the folder, a checkout's source core.
    const outside = [...text.matchAll(/["'](\.\.\/[^"']*)["']/g)].map((m) => m[1]).filter((s) => (s ?? "").split("/").filter((x) => x === "..").length > depth);
    if (f === "core-link.ts") assert.deepEqual(outside, ["../core/index.ts", "../.git"]);
    else assert.deepEqual(outside, [], `${f} names a path outside the plugin folder`);
  }
});

test("core-link loads only the core inside the approved folder in an installed tree, the source core in a checkout (decision 152)", () => {
  assert.equal(coreUrl()?.href, new URL("core/index.ts", root).href);
  const dir = mkdtempSync(join(tmpdir(), "sangsoe-link-"));
  const tree = (name: string, files: readonly string[]) => {
    for (const f of files) {
      mkdirSync(join(dir, name, f, ".."), { recursive: true });
      writeFileSync(join(dir, name, f), "");
    }
    return pathToFileURL(join(dir, name, "orca-plugin/core-link.ts")).href;
  };
  // A core changed beside the folder after approve is outside the hash: it must never be loaded.
  const planted = ["build-info.json", "core/index.ts", "dist/core/index.js"];
  try {
    const installed = tree("installed", [...planted, "orca-plugin/vendor/core/index.ts"]);
    assert.equal(coreUrl(installed)?.href, pathToFileURL(join(dir, "installed/orca-plugin/vendor/core/index.ts")).href);
    assert.equal(coreUrl(tree("unstaged", planted)), null, "no staged copy: nothing, not a core beside the folder");
    const checkout = tree("checkout", [".git", "core/index.ts", "dist/core/index.js"]);
    assert.equal(coreUrl(checkout)?.href, pathToFileURL(join(dir, "checkout/core/index.ts")).href);
    assert.equal(coreUrl(tree("empty", [])), null);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("activate starts the four monitors once the core opens, hints orca on agent status, and closes it", async () => {
  const w = fakeWorker();
  const { clock, advance } = fakeClock();
  const handlers = new Map<string, (p: unknown) => void>();
  w.orca.events.on = (e, h) => void handlers.set(e, h);
  const ran: string[] = [];
  let closed = 0;
  activate(w.orca, {
    clock,
    exec: async (cmd) => ok(cmd, ""),
    panel: fakePanel().load,
    monitors: async () => ({
      run: async (name) => {
        ran.push(name);
        return { planned: [], written: [], unseen: [], aborted: false };
      },
      close: () => void closed++,
    }),
  });
  try {
    await settle();
    handlers.get("agent.status.changed")?.({});
    handlers.get("agent.status.changed")?.({});
    await advance(5_000);
    assert.deepEqual(ran, ["orca"], "two status events, one hinted orca round");
    await advance(55_000);
    assert.deepEqual(ran, ["orca", "orca"]);
    await advance(240_000);
    assert.deepEqual(ran.filter((n) => n !== "orca").sort(), ["chat", "pr", "pr", "resource"], "pr every two minutes");
    const report = (await w.handlers.get("probe.report")?.(null)) as { monitors: { state: string; last: Record<string, unknown> } };
    assert.equal(report.monitors.state, "running");
    assert.deepEqual(Object.keys(report.monitors.last).sort(), ["chat", "orca", "pr", "resource"]);
  } finally {
    deactivate();
  }
  await settle();
  assert.equal(closed, 1);
});

test("deactivate aborts an in-flight monitor round and closes the core only after it returns", async () => {
  const w = fakeWorker();
  const { clock, advance } = fakeClock();
  let signal: AbortSignal | undefined;
  let finish: () => void = () => {};
  let closed = 0;
  activate(w.orca, {
    clock,
    exec: async (cmd) => ok(cmd, ""),
    panel: fakePanel().load,
    monitors: async () => ({
      run: (_name, s) =>
        new Promise((r) => {
          signal = s;
          finish = () => r({ planned: [], written: [], unseen: [], aborted: s?.aborted ?? false });
        }),
      close: () => void closed++,
    }),
  });
  await settle();
  await advance(60_000);
  deactivate();
  assert.equal(signal?.aborted, true, "stop aborts the round, so it writes nothing");
  await settle();
  assert.equal(closed, 0, "the store stays open while the round still holds it");
  finish();
  await settle();
  await settle();
  assert.equal(closed, 1);
});

test("a core that does not open leaves the worker running without monitors", async () => {
  const w = fakeWorker();
  const { clock } = fakeClock();
  activate(w.orca, { clock, exec: async (cmd) => ok(cmd, ""), panel: fakePanel().load, monitors: async () => "core not found" });
  try {
    await settle();
    const report = (await w.handlers.get("probe.report")?.(null)) as { monitors: { state: string } };
    assert.equal(report.monitors.state, "core not found");
  } finally {
    deactivate();
  }
});

test("the manifest's panel entry exists and the open command names that panel", () => {
  const [panel] = manifest.contributes.panels;
  assert.equal(panel.ui, "html");
  assert.ok(existsSync(new URL(`orca-plugin/${panel.entry}`, root)), panel.entry);
});
