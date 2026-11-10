import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readLandConfig } from "../land/ports.ts";
import { verifyTier } from "../verify/verify-tier.ts";
import type { CheckContext } from "./check.ts";
import { DOCTOR_CHECKS, START_CHECKS } from "./index.ts";
import { tierConfig } from "./tier-config.ts";
import { tierUnreadable } from "../land/land.ts";

function homeWith(config: string | null): string {
  const home = mkdtempSync(join(tmpdir(), "sangsoe-tier-home-"));
  if (config !== null) {
    mkdirSync(join(home, ".config", "sangsoe"), { recursive: true });
    writeFileSync(join(home, ".config", "sangsoe", "config.json"), config);
  }
  return home;
}
const FULL = JSON.stringify({
  protected_paths: ["infra/"],
  owners: ["alice"],
  verify_tier: { docs_globs: ["docs/"], test_globs: ["test/"], ui_globs: [], v3_globs: [".github/"] },
});

test("decision 172: a config holding only verdict_merge_repos tiers a docs PR V3 and names every missing list", async () => {
  const home = homeWith('{"verdict_merge_repos": ["acme/api"]}');
  try {
    const c = readLandConfig(home);
    assert.equal(c.tier, null);
    assert.deepEqual(c.verdictMergeRepos, ["acme/api"]);
    const v = verifyTier([{ path: "docs/a.md", patch: "@@ -1 +1 @@\n-a\n+b" }], [], c.tier, tierUnreadable(c));
    assert.equal(v.effective, "V3");
    assert.equal(
      v.reason,
      "tier source: none (fail-closed V3): config.json lacks verify_tier.docs_globs, verify_tier.test_globs, verify_tier.ui_globs, verify_tier.v3_globs, protected_paths",
    );
    const r = await tierConfig.run({ home } as CheckContext);
    assert.equal(r.status, "notice");
    assert.match(r.summary, /lacks verify_tier\.docs_globs/);
    assert.match(r.fix ?? "", /README, Land: Verify tier/);
  } finally {
    rmSync(home, { recursive: true });
  }
});

test("one list short is the same V3 as none, and names that list only", () => {
  const partial = JSON.parse(FULL);
  delete partial.verify_tier.ui_globs;
  const home = homeWith(JSON.stringify(partial));
  try {
    assert.equal(readLandConfig(home).tierGap, "config.json lacks verify_tier.ui_globs");
  } finally {
    rmSync(home, { recursive: true });
  }
});

test("no file names the file; a full section is ok and the row is doctor-only", async () => {
  const none = homeWith(null);
  const full = homeWith(FULL);
  try {
    assert.match(readLandConfig(none).tierGap ?? "", /config\.json is missing or not JSON/);
    const r = await tierConfig.run({ home: full } as CheckContext);
    assert.equal(r.status, "ok");
    assert.equal(readLandConfig(full).tierGap, undefined);
  } finally {
    rmSync(none, { recursive: true });
    rmSync(full, { recursive: true });
  }
  assert.ok(DOCTOR_CHECKS.includes(tierConfig));
  assert.ok(!START_CHECKS.includes(tierConfig));
});
