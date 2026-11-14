// Decision 257: the 리소스 section re-reads on the panel's own 30-second tick, only while it is open
// and the panel is shown. Folded or hidden, a tick reads nothing; showing it again reads at once.
// A read still running is never doubled.
import assert from "node:assert/strict";
import { test } from "node:test";
import { foldReads, panelReads, STORE_HINT_MS, tickParts } from "../../orca-plugin/panel/refresh.ts";
import { PARTS, STALE_MS } from "../../orca-plugin/panel/resources.ts";
import { REFRESH_MS } from "../../orca-plugin/panel/view.ts";
import type { Clock } from "../../orca-plugin/timer.ts";

function fakeClock() {
  let now = 0;
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
  return { clock, advance, now: () => now, timers: () => timers.length };
}

const settle = () => new Promise((r) => setImmediate(r));

/** The panel's interval with the section's loop on it; the test sets the fold and the visibility. */
function panel(o: { open?: boolean; visible?: boolean; may?: () => boolean; slow?: boolean } = {}) {
  const c = fakeClock();
  const state = { open: o.open ?? false, visible: o.visible ?? true };
  const reads: { at: number; why: string }[] = [];
  let running = 0;
  let most = 0;
  const release: (() => void)[] = [];
  const loop = foldReads({
    read: async (why) => {
      reads.push({ at: c.now(), why });
      running += 1;
      most = Math.max(most, running);
      if (o.slow) await new Promise<void>((res) => release.push(res));
      running -= 1;
    },
    may: o.may ?? (() => true),
    shown: () => state.open && state.visible,
  });
  let briefReads = 0;
  const brief = panelReads({
    read: async () => {
      briefReads += 1;
    },
    may: () => state.visible,
    tick: loop.tick,
    clock: c.clock,
  });
  const set = (s: Partial<typeof state>) => {
    Object.assign(state, s);
    loop.sync();
  };
  return {
    ...c,
    set,
    reads,
    loop,
    push: brief.changed,
    briefReads: () => briefReads,
    stop: async () => {
      await brief.stop();
      await loop.stop();
    },
    most: () => most,
    release: () => {
      for (const f of release.splice(0)) f();
    },
  };
}

test("on the panel's 30-second tick, and only while the section is open and the panel visible", async () => {
  assert.equal(REFRESH_MS, 30_000);
  const p = panel();
  const timers = p.timers();
  p.set({});
  await p.advance(5 * REFRESH_MS);
  assert.equal(p.reads.length, 0, "a folded section never reads by itself");

  p.set({ open: true });
  await settle();
  assert.deepEqual(p.reads, [{ at: 5 * REFRESH_MS, why: "show" }], "opening reads at once");
  assert.equal(p.timers(), timers, "and adds no timer of its own");
  await p.advance(2 * REFRESH_MS);
  assert.deepEqual(
    p.reads.map((r) => r.at),
    [5, 6, 7].map((m) => m * REFRESH_MS),
  );
  assert.deepEqual(
    p.reads.slice(1).map((r) => r.why),
    ["tick", "tick"],
  );
  await p.stop();
});

test("a store push is not a tick: the section does not read on it", async () => {
  const p = panel({ open: true });
  p.set({});
  await settle();
  const before = p.reads.length;
  p.push();
  await p.advance(STORE_HINT_MS + 1);
  assert.equal(p.briefReads(), 1, "the push read the panel");
  assert.equal(p.reads.length, before);
  await p.stop();
});

test("folding or hiding stops its reads; showing again reads once at once and resumes", async () => {
  const p = panel({ open: true });
  p.set({});
  await settle();
  await p.advance(REFRESH_MS);
  assert.equal(p.reads.length, 2);

  p.set({ visible: false });
  await p.advance(10 * REFRESH_MS);
  assert.equal(p.reads.length, 2, "nothing is read while hidden");

  p.set({ visible: true });
  await settle();
  assert.deepEqual(p.reads.at(-1), { at: 11 * REFRESH_MS, why: "show" }, "shown again: read at once");
  await p.advance(REFRESH_MS);
  assert.deepEqual(p.reads.at(-1), { at: 12 * REFRESH_MS, why: "tick" }, "then at the next tick");

  p.set({ open: false });
  await p.advance(10 * REFRESH_MS);
  assert.equal(p.reads.length, 4, "nothing is read while folded");
  await p.stop();
});

test("a sync that changes nothing does not read", async () => {
  const p = panel({ open: true });
  p.set({});
  await settle();
  p.set({});
  p.set({ visible: true });
  await settle();
  assert.equal(p.reads.length, 1);
  await p.stop();
});

test("a read still running is never doubled, by the tick or by showing again", async () => {
  const p = panel({ open: true, slow: true });
  p.set({});
  await settle();
  await p.advance(3 * REFRESH_MS);
  p.set({ visible: false });
  p.set({ visible: true });
  await settle();
  assert.equal(p.reads.length, 1, "ticks and a re-show during the read start nothing");
  assert.equal(p.most(), 1);
  p.release();
  await settle();
  await p.advance(REFRESH_MS);
  assert.equal(p.reads.length, 2, "the next tick after it ends reads");
  p.release();
  await p.stop();
});

test("a tick the panel may not take is skipped", async () => {
  let may = false;
  const p = panel({ open: true, may: () => may });
  p.set({});
  await p.advance(2 * REFRESH_MS);
  assert.deepEqual(p.reads, []);
  may = true;
  await p.advance(REFRESH_MS);
  assert.deepEqual(p.reads, [{ at: 3 * REFRESH_MS, why: "tick" }]);
  await p.stop();
});

test("the tick asks 정리 후보 only before its last read would turn 낡음", () => {
  assert.deepEqual(tickParts(REFRESH_MS, 0), ["load", "made"]);
  assert.deepEqual(tickParts(STALE_MS - 2 * REFRESH_MS, 0), ["load", "made"]);
  assert.deepEqual(tickParts(STALE_MS - REFRESH_MS, 0), PARTS, "the last tick before 낡음 reads all three");
  assert.deepEqual(tickParts(STALE_MS + 1, 0), PARTS);
  // A tick every 30 s from a read at 0: 정리 후보 again every 4.5 minutes, never past STALE_MS.
  let at = 0;
  const cand: number[] = [];
  for (let t = REFRESH_MS; t <= 40 * REFRESH_MS; t += REFRESH_MS) {
    if (tickParts(t, at).includes("candidates")) {
      cand.push(t / REFRESH_MS);
      at = t;
    }
  }
  assert.deepEqual(cand, [9, 18, 27, 36]);
});

test("stop waits for the read in flight, and nothing reads after it", async () => {
  const p = panel({ open: true, slow: true });
  p.set({});
  await settle();
  let stopped = false;
  const s = p.stop().then(() => {
    stopped = true;
  });
  await settle();
  assert.equal(stopped, false);
  p.release();
  await s;
  assert.equal(stopped, true);
  p.loop.tick();
  p.set({ visible: false });
  p.set({ visible: true });
  await settle();
  assert.equal(p.reads.length, 1);
});
