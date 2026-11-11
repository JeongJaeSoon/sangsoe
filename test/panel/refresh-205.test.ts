// Decision 205: a store write reaches the panel as a push, and the panel re-reads within a few seconds.
// The 30-second interval stays for what only Orca changed. Reads never overlap and never starve.
import assert from "node:assert/strict";
import { test } from "node:test";
import { panelReads, STORE_HINT_MS } from "../../orca-plugin/panel/refresh.ts";
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
  return { clock, advance, now: () => now };
}

const settle = () => new Promise((r) => setImmediate(r));

test("a store write is read within a few seconds, not at the next 30-second tick", async () => {
  assert.ok(STORE_HINT_MS <= 3000, "a few seconds");
  assert.ok(STORE_HINT_MS < REFRESH_MS);
  const { clock, advance, now } = fakeClock();
  const reads: number[] = [];
  const r = panelReads({ read: async () => void reads.push(now()), may: () => true, clock });
  try {
    await advance(1000);
    r.changed();
    await advance(STORE_HINT_MS);
    assert.deepEqual(reads, [1000 + STORE_HINT_MS]);
    await advance(REFRESH_MS);
    assert.ok(reads.includes(REFRESH_MS), "the interval read for what only Orca changed stays");
  } finally {
    await r.stop();
  }
});

test("continuous writes still read, at most once per window, never overlapping", async () => {
  const { clock, advance } = fakeClock();
  let open = 0;
  let most = 0;
  let reads = 0;
  const r = panelReads({
    read: async () => {
      open += 1;
      most = Math.max(most, open);
      reads += 1;
      await new Promise((res) => setImmediate(res));
      open -= 1;
    },
    may: () => true,
    clock,
  });
  try {
    for (let t = 0; t < 10_000; t += 100) {
      r.changed();
      await advance(100);
      await settle();
    }
    assert.ok(reads >= Math.floor(10_000 / STORE_HINT_MS) - 1, `a stream of writes does not starve the reads (${reads})`);
    assert.ok(reads <= Math.ceil(10_000 / STORE_HINT_MS) + 1, `at most one read per window (${reads})`);
    assert.equal(most, 1);
  } finally {
    await r.stop();
  }
});

test("a write during a read leaves exactly one more read; a closed gate reads nothing", async () => {
  const { clock, advance } = fakeClock();
  let release: () => void = () => {};
  let reads = 0;
  const r = panelReads({
    read: () => {
      reads += 1;
      return new Promise<void>((res) => {
        release = res;
      });
    },
    may: () => true,
    clock,
  });
  try {
    r.changed();
    await advance(STORE_HINT_MS);
    assert.equal(reads, 1);
    r.changed();
    r.changed();
    await advance(STORE_HINT_MS * 3);
    assert.equal(reads, 1, "no second read while the first runs");
    release();
    await settle();
    await advance(STORE_HINT_MS);
    assert.equal(reads, 2, "one more read after it");
    release();
    await settle();
    await advance(STORE_HINT_MS * 3);
    assert.equal(reads, 2);
  } finally {
    await r.stop();
  }

  const gate = fakeClock();
  let gated = 0;
  const g = panelReads({
    read: async () => {
      gated += 1;
    },
    may: () => false,
    clock: gate.clock,
  });
  try {
    g.changed();
    await gate.advance(REFRESH_MS + STORE_HINT_MS);
    assert.equal(gated, 0, "hidden, failed, busy or typing: no read");
  } finally {
    await g.stop();
  }
});
