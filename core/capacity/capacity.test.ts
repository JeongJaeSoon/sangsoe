import assert from "node:assert/strict";
import { test } from "node:test";
import { capacity, judgeLoad, sampleLoad } from "./capacity.ts";

test("judgeLoad: the worst metric sets the level, one reason per metric at warn or above", () => {
  assert.deepEqual(judgeLoad({ load5: 4, cpus: 8, memFreePct: 50, diskFreeGb: 200 }), { level: "ok", reasons: [] });
  const warn = judgeLoad({ load5: 11, cpus: 8, diskFreeGb: 200 });
  assert.equal(warn.level, "warn");
  assert.deepEqual(warn.reasons, ["load/CPU 1.38 ≥ 경고 1.3"]);
  const danger = judgeLoad({ load5: 11, cpus: 8, memFreePct: 9, diskFreeGb: 15 });
  assert.equal(danger.level, "danger");
  assert.equal(danger.reasons.length, 3);
});

test("judgeLoad: boundaries are inclusive, and an unmeasured metric judges nothing", () => {
  assert.equal(judgeLoad({ load5: 16, cpus: 8 }).level, "danger");
  assert.equal(judgeLoad({ diskFreeGb: 20 }).level, "warn");
  assert.equal(judgeLoad({ memFreePct: 10 }).level, "danger");
  assert.equal(judgeLoad({}).level, "ok");
  assert.equal(judgeLoad({ load5: 99 }).level, "ok", "load without a CPU count is not judged");
});

test("capacity: free slots under the limit, none under danger", () => {
  assert.equal(capacity({ live: 2, limit: 5, level: "ok" }), 3);
  assert.equal(capacity({ live: 2, limit: 5, level: "warn" }), 3);
  assert.equal(capacity({ live: 7, limit: 5, level: "ok" }), 0);
  assert.equal(capacity({ live: 0, limit: 5, level: "danger" }), 0);
});

test("sampleLoad reads this machine; memory is left unmeasured on macOS", () => {
  const s = sampleLoad(undefined, "darwin");
  assert.ok((s.cpus ?? 0) > 0);
  assert.equal(s.memFreePct, undefined);
  assert.equal(typeof sampleLoad(undefined, "linux").memFreePct, "number");
});
