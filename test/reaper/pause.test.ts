// Decision 182: while Orca is closed nothing runs; the first round after it catches up once.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { judgeStall } from "../../core/index.ts";
import { dropScratch, finishedCard, MIN, rounds, world } from "./harness.ts";

after(dropScratch);

const rms = (w: ReturnType<typeof world>) => w.orca.calls.filter((c) => c.startsWith("worktreeRm"));

const HOUR = 60 * MIN;

test("the first round after a long pause catches up once and records the slots it missed", async () => {
  const w = world();
  w.intervalMs = 10 * MIN;
  await w.round();
  w.clock.now += 10 * HOUR;
  const caught = await w.round();
  assert.equal(caught.missed, 59);
  w.clock.now += 10 * MIN;
  const next = await w.round();
  assert.equal(next.missed, 0);
  assert.deepEqual(
    w.types("reap_round").map((r) => r.missed),
    [undefined, 59, undefined],
    "one catch-up row, not one row per missed slot",
  );
});

test("a gap under two periods is not a pause", async () => {
  const w = world();
  w.intervalMs = 10 * MIN;
  await w.round();
  w.clock.now += 19 * MIN;
  assert.equal((await w.round()).missed, 0);
});

test("a sighting from before the pause does not pair with the catch-up round", async () => {
  const w = world();
  w.intervalMs = 10 * MIN;
  finishedCard(w, "paused");
  await w.round();
  w.clock.now += 10 * HOUR;
  const caught = await w.round();
  assert.deepEqual(caught.targets, [], "the catch-up round only marks");
  assert.deepEqual(
    w.types("reap_candidate").map((c) => [c.round, c.state]),
    [
      [1, "seen"],
      [2, "seen"],
    ],
  );
  w.clock.now += 10 * MIN;
  await rounds(w, 2, 10);
  assert.deepEqual(rms(w), [], "the 30 minute grace counts from the catch-up round");
  w.clock.now += 10 * MIN;
  await w.round();
  assert.equal(rms(w).length, 1, "two rounds and the grace after reopening");
});

test("reopening Orca after a long close is a pause, not a timer stall; a stall after reopening still alarms", async () => {
  const w = world();
  w.intervalMs = 10 * MIN;
  await w.round();
  w.clock.now += 10 * HOUR;
  const openedAt = w.clock.now;
  w.clock.now += 1 * MIN;
  const period = 10 * MIN;
  assert.deepEqual(judgeStall(w.store.events(), w.clock.now, period, openedAt), [], "the first Orca event comes before the catch-up round");
  assert.equal(judgeStall(w.store.events(), w.clock.now, period).length, 1, "without the open time it would alarm");
  w.clock.now = openedAt + 31 * MIN;
  assert.deepEqual(
    judgeStall(w.store.events(), w.clock.now, period, openedAt).map((p) => p.type),
    ["timer_stalled"],
    "no timer round in three periods since the open is a real stall",
  );
});
