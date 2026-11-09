import assert from "node:assert/strict";
import { test } from "node:test";
import { land, tierOfPr } from "../../core/index.ts";
import { expectSameViaBothEntrances, viaCli } from "../boundaries/both-entrances.ts";
import { evidence, fakeDeps, HEAD, REPO, reset, reviewed, world } from "./fake-deps.ts";

// L6 / R-03: the land function, the `land` MCP tool and `sangsoe land` give one result for one
// input. The fixture entrances are the real tool and command built over the fake world.
const dirs = { tools: new URL("./entrances/tools/", import.meta.url), commands: new URL("./entrances/commands/", import.meta.url) };
const landRows = () => world.store.events().filter((e) => e.type.startsWith("land_")).map((e) => `${e.type}:${String(e.payload.reason ?? "")}`);

async function threeWays(input: Record<string, unknown>, argv: string[]) {
  const fn = await land(
    {
      repo: String(input.repo),
      pr: Number(input.pr),
      ...(input.head_sha ? { headSha: String(input.head_sha) } : {}),
      dryRun: input.dry_run === true,
      mainFix: input.main_fix === true,
    },
    fakeDeps(),
  );
  const both = await expectSameViaBothEntrances({ tool: "land", input, argv: ["land", ...argv], dirs });
  assert.deepEqual(both, JSON.parse(JSON.stringify(fn)), "the function and the entrances differ");
  return both;
}

test("a dry run that would auto-merge: the same value three ways, nothing written or merged", async () => {
  reset();
  reviewed();
  evidence("test");
  evidence("run");
  const r = await threeWays({ repo: REPO, pr: 12, dry_run: true }, ["--repo", REPO, "--pr", "12", "--dry-run"]);
  assert.ok(r.ok);
  assert.equal((r.value as { action: string }).action, "auto_merge");
  assert.deepEqual([world.merges, landRows()], [[], []]);
});

test("a refusal: the same code, reason and fix three ways, one land_failed per call", async () => {
  reset();
  reviewed();
  evidence("test");
  const r = await threeWays({ repo: REPO, pr: 12, head_sha: HEAD }, ["--repo", REPO, "--pr", "12", "--head", HEAD]);
  assert.equal(r.ok ? "" : r.refusal.code, "evidence_missing");
  assert.deepEqual(landRows(), ["land_failed:evidence_missing:run", "land_failed:evidence_missing:run", "land_failed:evidence_missing:run"]);
});

test("a real land: three ways, three merge requests at the same head", async () => {
  reset([{ filename: "docs/a.md", patch: "@@ -1 +1 @@\n-a\n+b" }]);
  reviewed();
  const r = await threeWays({ repo: REPO, pr: 12 }, ["--repo", REPO, "--pr", "12"]);
  assert.ok(r.ok);
  assert.deepEqual(world.merges, Array(3).fill({ repo: REPO, pr: 12, head: HEAD }));
  assert.deepEqual(landRows(), ["land_requested:", "land_requested:", "land_requested:"]);
});

test("sangsoe verify-tier gives the function's value", async () => {
  reset([{ filename: "test/a.test.ts", patch: "@@ -1 +1 @@\n-a\n+b" }]);
  const cli = await viaCli(["verify-tier", "--repo", REPO, "--pr", "12"], dirs);
  const fn = await tierOfPr(fakeDeps(), { repo: REPO, pr: 12 });
  assert.deepEqual(cli, JSON.parse(JSON.stringify(fn)));
  assert.ok(cli.ok);
  assert.deepEqual([(cli.value as { effective: string }).effective, (cli.value as { evidence: string[] }).evidence], ["V1", ["test"]]);
});
