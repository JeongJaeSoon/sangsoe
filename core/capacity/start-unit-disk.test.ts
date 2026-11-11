import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pressureGate } from "../gates/pressure.ts";
import type { Facts, ToolCall } from "../gates/types.ts";
import { DEFAULT_THRESHOLDS, judgeLoad, readThresholds, sampleLoad } from "./capacity.ts";

const startUnit: ToolCall = { tool: "mcp__plugin_sangsoe_sangsoe__start_unit", input: {}, cwd: "/w", subagent: false };

const factsAt = (load: ReturnType<typeof judgeLoad>): Facts => ({
  role: () => "lead",
  load: () => load,
  ownOpenPrs: () => undefined,
  readScript: () => undefined,
});

function homeWith(config: string | null): string {
  const home = mkdtempSync(join(tmpdir(), "sangsoe-capacity-home-"));
  if (config !== null) {
    mkdirSync(join(home, ".config", "sangsoe"), { recursive: true });
    writeFileSync(join(home, ".config", "sangsoe", "config.json"), config);
  }
  return home;
}

test("decision 210: 38 GB free and a low load do not hold a start_unit", () => {
  const load = judgeLoad({ load5: 1.56, cpus: 10, diskFreeGb: 38 });
  assert.deepEqual(load, { level: "ok", reasons: [] });
  assert.equal(pressureGate(startUnit, factsAt(load)), null);
});

test("decision 210: disk warns at 20 GB and is danger at 10 GB; the hold stays fail-closed below", () => {
  assert.equal(judgeLoad({ diskFreeGb: 20.4 }).level, "ok");
  assert.equal(judgeLoad({ diskFreeGb: 20 }).level, "warn");
  assert.equal(judgeLoad({ diskFreeGb: 10 }).level, "danger");
  const v = pressureGate(startUnit, factsAt(judgeLoad({ load5: 1, cpus: 10, diskFreeGb: 15 })));
  assert.equal(v?.decision, "deny");
});

test("decision 210: the refusal names the binding resource, its value and its threshold first", () => {
  const load = judgeLoad({ load5: 14, cpus: 10, diskFreeGb: 8 });
  assert.equal(load.level, "danger");
  assert.deepEqual(load.reasons, ["디스크 여유 8 GB ≤ 위험 10 GB", "load/CPU 1.40 ≥ 경고 1.3"]);
  const v = pressureGate(startUnit, factsAt(load));
  assert.match(v?.reason ?? "", /^\[gate:pressure\] The machine is at danger: 디스크 여유 8 GB ≤ 위험 10 GB, load\/CPU 1\.40/);
});

test("decision 210: config.json capacity overrides the defaults per metric; a malformed entry keeps the default", () => {
  const cases: [string | null, typeof DEFAULT_THRESHOLDS][] = [
    [null, DEFAULT_THRESHOLDS],
    ["{}", DEFAULT_THRESHOLDS],
    ["not json", DEFAULT_THRESHOLDS],
    ['{"capacity": {"disk_free_gb": [60, 30]}}', { ...DEFAULT_THRESHOLDS, diskFreeGb: [60, 30] }],
    ['{"capacity": {"load_per_cpu": [1.5, 2.5], "mem_free_pct": [15, 5]}}', { ...DEFAULT_THRESHOLDS, loadPerCpu: [1.5, 2.5], memFreePct: [15, 5] }],
    ['{"capacity": {"disk_free_gb": [10, 20]}}', DEFAULT_THRESHOLDS],
    ['{"capacity": {"load_per_cpu": [2.5, 1.5]}}', DEFAULT_THRESHOLDS],
    ['{"capacity": {"disk_free_gb": ["20", 10]}}', DEFAULT_THRESHOLDS],
    ['{"capacity": {"disk_free_gb": [20]}}', DEFAULT_THRESHOLDS],
    ['{"capacity": {"disk_free_gb": [-1, -5]}}', DEFAULT_THRESHOLDS],
    ['{"capacity": [1, 2]}', DEFAULT_THRESHOLDS],
  ];
  for (const [config, want] of cases) {
    const home = homeWith(config);
    try {
      assert.deepEqual(readThresholds(home), want, String(config));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }
});

test("decision 210: sampleLoad(home) carries that home's thresholds into judgeLoad, so every caller judges alike", () => {
  const home = homeWith('{"capacity": {"disk_free_gb": [60, 30]}}');
  try {
    const sample = { ...sampleLoad(home), load5: 0, diskFreeGb: 38 };
    const load = judgeLoad(sample);
    assert.equal(load.level, "warn");
    assert.deepEqual(load.reasons, ["디스크 여유 38 GB ≤ 경고 60 GB"]);
    assert.equal(judgeLoad(sample, DEFAULT_THRESHOLDS).level, "ok", "an explicit threshold still wins");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
