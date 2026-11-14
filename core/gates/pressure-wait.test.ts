import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate, GATES } from "./index.ts";
import { PRESSURE_WAIT, type WaitDeps, waitForLoad } from "./pressure-wait.ts";
import { pressureGate } from "./pressure.ts";
import { sleepLoop } from "./sleep-loop.ts";
import type { Facts, LoadVerdict, Role, ToolCall } from "./types.ts";

// Decision 256: after a [gate:pressure] refusal the session starts `sangsoe pressure wait` in the
// background; its one exit is the one wake. The samples and the clock are injected, so no test waits 30s.

const OK: LoadVerdict = { level: "ok", reasons: [] };
const HIGH: LoadVerdict = { level: "warn", reasons: ["load/CPU 1.50 ≥ 경고 1.3"] };

/** Readings in order, then the last one forever; `sleeps` counts the waits between readings. */
function world(readings: readonly LoadVerdict[]): WaitDeps & { reads: () => number; sleeps: () => number } {
  let t = 0;
  let i = 0;
  let slept = 0;
  return {
    load: () => readings[Math.min(i++, readings.length - 1)] ?? OK,
    now: () => t,
    sleep: async (ms) => {
      slept += 1;
      t += ms;
    },
    reads: () => i,
    sleeps: () => slept,
  };
}

test("refused, then the load reads ok twice in a row: one line that says to run the same call again", async () => {
  const w = world([HIGH, HIGH, OK, OK]);
  const r = await waitForLoad(w);
  assert.equal(r.cleared, true);
  assert.equal(r.lines.length, 1);
  assert.match(r.lines[0] ?? "", /^\[pressure-wait\] The load dropped \(was warn: load\/CPU 1\.50 ≥ 경고 1\.3\)/);
  assert.match(r.lines[0] ?? "", /run the same call again, once, unless you already ran it after the refusal\.$/);
  assert.equal(w.reads(), 4);
  assert.equal(w.sleeps(), 3, "one interval between readings, none after the last");
});

test("a second clear for the same refusal: the wait has already ended, so it reads nothing more", async () => {
  const w = world([HIGH, OK, OK, HIGH, OK, OK]);
  await waitForLoad(w);
  assert.equal(w.reads(), 3, "the readings after the first clear are never taken");
});

test("the load stays high: it waits until the deadline and ends with the deadline line, not a retry", async () => {
  const w = world([HIGH]);
  const r = await waitForLoad(w);
  assert.equal(r.cleared, false);
  assert.match(r.lines[0] ?? "", /^\[pressure-wait\] The load is still warn after 120 minutes \(load\/CPU 1\.50/);
  assert.doesNotMatch(r.lines[0] ?? "", /run the same call again/);
  assert.equal(w.now(), PRESSURE_WAIT.deadlineMs);
  assert.equal(w.reads(), PRESSURE_WAIT.deadlineMs / PRESSURE_WAIT.intervalMs + 1);
});

test("hysteresis: ok, high, ok, ok ends only at the last reading", async () => {
  const w = world([OK, HIGH, OK, OK, HIGH]);
  const r = await waitForLoad(w);
  assert.equal(r.cleared, true);
  assert.equal(w.reads(), 4);
  assert.equal(w.now(), 3 * PRESSURE_WAIT.intervalMs);
});

test("the readings are 30 seconds apart and two ok readings end the wait", () => {
  assert.equal(PRESSURE_WAIT.intervalMs, 30_000);
  assert.equal(PRESSURE_WAIT.okStreak, 2);
  assert.equal(PRESSURE_WAIT.deadlineMs, 2 * 60 * 60_000);
});

const facts = (role: Role, load: LoadVerdict = OK): Facts => ({
  role: () => role,
  load: () => load,
  ownOpenPrs: () => [],
  readScript: () => undefined,
  doneBlockers: () => [],
  sangsoe: () => true,
});
const bash = (command: string, background: boolean): ToolCall => ({
  tool: "Bash",
  input: { command, ...(background ? { run_in_background: true } : {}) },
  cwd: "/w",
  subagent: false,
});
const startUnit: ToolCall = { tool: "mcp__plugin_sangsoe_sangsoe__start_unit", input: {}, cwd: "/w", subagent: false };

test("the refusal names the wait command, run_in_background, one retry, and one wait per session", () => {
  const reason = pressureGate(startUnit, facts("lead", HIGH))?.reason ?? "";
  assert.match(reason, /Nothing was queued: run the same call again once the load drops\./);
  assert.match(reason, /start `sangsoe pressure wait` with run_in_background: true/);
  assert.match(reason, /when it finishes, run the same call once/);
  assert.match(reason, /If a `sangsoe pressure wait` is already running in this session, do not start another/);
  assert.match(reason, /If you run the call again before it finishes, stop that wait/);
});

test("no gate refuses the wait command, in the background or not, for any role and at any load", () => {
  for (const role of ["orchestrator", "lead", "worker", "general"] as const) {
    for (const background of [true, false]) {
      const call = bash("sangsoe pressure wait", background);
      assert.equal(sleepLoop(call, facts(role, HIGH)), null);
      assert.deepEqual(evaluate(call, facts(role, HIGH), GATES).verdicts, [], `${role} background=${background}`);
    }
  }
});
