// Plugin tests live outside orca-plugin/ so they are not part of the folder Orca fingerprints.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { EVENTS } from "../orca-plugin/main.ts";
import { dagSvg } from "../orca-plugin/panel/probe.ts";
import { meetsSqliteFloor, ownKey, probeSqlite } from "../orca-plugin/probe.ts";
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
  const timers: { ms: number; next: number; fn: () => void }[] = [];
  const clock: Clock = {
    now: () => now,
    every(ms, fn) {
      const t = { ms, next: ms, fn };
      timers.push(t);
      return () => timers.splice(timers.indexOf(t), 1);
    },
  };
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const t = timers.filter((x) => x.next <= end).sort((a, b) => a.next - b.next)[0];
      if (!t) break;
      now = t.next;
      t.next += t.ms;
      t.fn();
      await new Promise((r) => setImmediate(r));
    }
    now = end;
  };
  return { clock, advance, timers };
}

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

test("the probe panel draws an inline SVG with one path per edge", () => {
  const svg = dagSvg(
    [
      { id: "A", col: 0, row: 0 },
      { id: "B", col: 1, row: 0 },
    ],
    [{ from: "A", to: "B" }],
  );
  assert.match(svg, /^<svg /);
  assert.equal(svg.match(/<path /g)?.length, 1);
  assert.equal(svg.match(/<rect /g)?.length, 2);
});
