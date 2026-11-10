import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CheckContext } from "./check.ts";
import { DOCTOR_CHECKS, START_CHECKS } from "./index.ts";
import { watchRepos } from "./watch-repos.ts";

function homeWith(config: string | null): string {
  const home = mkdtempSync(join(tmpdir(), "sangsoe-watch-home-"));
  if (config !== null) {
    mkdirSync(join(home, ".config", "sangsoe"), { recursive: true });
    writeFileSync(join(home, ".config", "sangsoe", "config.json"), config);
  }
  return home;
}

async function run(config: string | null) {
  const home = homeWith(config);
  try {
    return await watchRepos.run({ home } as CheckContext);
  } finally {
    rmSync(home, { recursive: true });
  }
}

test("decision 168: no watch.repos is a doctor notice naming the setting and the file", async () => {
  for (const config of [null, "{}", '{"watch": {}}', '{"watch": {"repos": []}}', "not json"]) {
    const r = await run(config);
    assert.equal(r.status, "notice", String(config));
    assert.match(r.summary, /pr monitor/);
    assert.match(r.fix ?? "", /"watch": \{"repos": \["owner\/name"\]\}/);
    assert.match(r.fix ?? "", /\.config\/sangsoe\/config\.json/);
  }
});

test("an empty list and an unreadable section say different things", async () => {
  assert.match((await run('{"watch": {"repos": []}}')).summary, /watch\.repos 가 비었다/);
  assert.match((await run('{"watch": {"repos": ["acme/api"], "authors": 3}}')).summary, /없거나 읽을 수 없다/);
});

test("a watched repo turns the row ok with the count", async () => {
  const r = await run('{"watch": {"repos": ["acme/api", "acme/web"]}}');
  assert.equal(r.status, "ok");
  assert.match(r.summary, /2개/);
});

test("the row is doctor-only, so a session start stays quiet", () => {
  assert.ok(DOCTOR_CHECKS.includes(watchRepos));
  assert.ok(!START_CHECKS.includes(watchRepos));
});
