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

// GitHub's own names, as `gh api repos/<entry> --jq .full_name` answers them. A public repository is
// answered in any case; a fine-grained token gets 404 for a private one named in another case.
const PUBLIC = ["acme/api", "acme/web"];
const PRIVATE = ["Acme-Org/Tools"];

async function run(config: string | null, asked: string[] = []) {
  const home = homeWith(config);
  const exec: CheckContext["exec"] = async (file, args) => {
    assert.deepEqual([file, args[0], args.slice(2)], ["gh", "api", ["--jq", ".full_name"]]);
    asked.push(String(args[1]));
    const entry = String(args[1]).slice("repos/".length);
    const name = PUBLIC.find((n) => n.toLowerCase() === entry.toLowerCase()) ?? PRIVATE.find((n) => n === entry);
    return name ? { code: 0, stdout: `${name}\n`, stderr: "" } : { code: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" };
  };
  try {
    return await watchRepos.run({ home, exec } as CheckContext);
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
  const asked: string[] = [];
  const r = await run('{"watch": {"repos": ["acme/api", "acme/web"]}}', asked);
  assert.equal(r.status, "ok");
  assert.match(r.summary, /2개/);
  assert.deepEqual(asked, ["repos/acme/api", "repos/acme/web"], "each entry is asked as written");
});

test("275: an entry in another case than GitHub's is a warning that names GitHub's spelling", async () => {
  const r = await run('{"watch": {"repos": ["Acme/API", "acme/web"]}}');
  assert.equal(r.status, "warn");
  assert.match(r.summary, /"Acme\/API" 는 GitHub 에서 "acme\/api" 이다/);
  assert.doesNotMatch(r.summary, /acme\/web/, "an entry that matches is not named");
  assert.match(r.fix ?? "", /exactly as GitHub shows it/);
});

test("275: an entry GitHub does not answer (a private repository in another case, no access, no network) is a warning, never ok", async () => {
  const r = await run('{"watch": {"repos": ["acme-org/tools"]}}');
  assert.equal(r.status, "warn");
  assert.match(r.summary, /acme-org\/tools/);
  assert.match(r.summary, /대소문자가 다르거나, 권한이 없거나, GitHub 에 닿지 못했다/);
  assert.match(r.fix ?? "", /gh api repos\/<owner>\/<name> --jq \.full_name/);
  assert.equal((await run('{"watch": {"repos": ["Acme-Org/Tools"]}}')).status, "ok", "the same repository in GitHub's case");
});

test("275: an entry that is not owner/name is a warning and is not sent to GitHub", async () => {
  const asked: string[] = [];
  const r = await run('{"watch": {"repos": ["https://github.com/acme/api"]}}', asked);
  assert.equal(r.status, "warn");
  assert.match(r.summary, /owner\/name 꼴이 아니다/);
  assert.deepEqual(asked, []);
});

test("the row is doctor-only, so a session start stays quiet", () => {
  assert.ok(DOCTOR_CHECKS.includes(watchRepos));
  assert.ok(!START_CHECKS.includes(watchRepos));
});
