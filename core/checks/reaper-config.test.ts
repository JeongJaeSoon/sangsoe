import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CheckContext } from "./check.ts";
import { DOCTOR_CHECKS, START_CHECKS } from "./index.ts";
import { reaperConfig } from "./reaper-config.ts";

function homeWith(config: string | null): string {
  const home = mkdtempSync(join(tmpdir(), "sangsoe-reaper-home-"));
  if (config !== null) {
    mkdirSync(join(home, ".config", "sangsoe"), { recursive: true });
    writeFileSync(join(home, ".config", "sangsoe", "config.json"), config);
  }
  return home;
}

const run = (home: string) => reaperConfig.run({ home } as CheckContext);

test("decision 153: no reaper section is a doctor notice that REAPER only marks, naming what to set", async () => {
  for (const config of [null, "{}", '{"watch": {"repos": []}}']) {
    const home = homeWith(config);
    try {
      const r = await run(home);
      assert.equal(r.status, "notice", String(config));
      assert.match(r.summary, /표시만/);
      assert.match(r.fix ?? "", /"reaper": \{"protect": \[\]\}/);
      assert.match(r.fix ?? "", /\.config\/sangsoe\/config\.json/);
    } finally {
      rmSync(home, { recursive: true });
    }
  }
});

test("decision 201: a config file that cannot be read is a warning that every round stops, not the mark-only notice", async () => {
  for (const config of ['{"reaper": {}}', '{"reaper": {"protect": "x"}}', "not json", "[]"]) {
    const home = homeWith(config);
    try {
      const r = await run(home);
      assert.equal(r.status, "warn", config);
      assert.match(r.summary, /읽지 못했다/);
      assert.match(r.summary, /아무것도 지우지 않는다/);
    } finally {
      rmSync(home, { recursive: true });
    }
  }
});

test("a reaper section turns the row ok with the protect count and grace", async () => {
  const home = homeWith('{"reaper": {"protect": ["main", "/w/keep"], "grace_minutes": 45}}');
  try {
    const r = await run(home);
    assert.equal(r.status, "ok");
    assert.match(r.summary, /보호 2/);
    assert.match(r.summary, /45분/);
  } finally {
    rmSync(home, { recursive: true });
  }
});

test("the row is doctor-only, so a session start stays quiet", () => {
  assert.ok(DOCTOR_CHECKS.includes(reaperConfig));
  assert.ok(!START_CHECKS.includes(reaperConfig));
});
