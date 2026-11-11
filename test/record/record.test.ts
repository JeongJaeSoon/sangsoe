import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { after, test } from "node:test";
import { landTool } from "../../claude-plugin/mcp/tools/land.ts";
import {
  dedupeKey,
  EVENTS,
  expandFlow,
  type GhClient,
  type GhResponse,
  type LandConfig,
  type LandDeps,
  loadFlow,
  planFlow,
  ready,
  recordStage,
  type Store,
  tierOfPr,
} from "../../core/index.ts";
import { expectSameViaBothEntrances, viaMcp } from "../boundaries/both-entrances.ts";
import { createGraphWorld } from "../graph/world.ts";
import { exec, HEAD, openStore, PR_BRANCH, REPO, reset, rows, world } from "./world.ts";

// Decision 171: evidence and stage_recorded each have one recording entrance (an MCP tool and a
// CLI command over one core function). A PR above V0 lands once a non-author records its
// evidence; the PR's author, by name or as the calling session, records nothing.
after(() => rmSync(world.dir, { recursive: true, force: true }));

const dirs = { tools: new URL("./entrances/tools/", import.meta.url), commands: new URL("./entrances/commands/", import.meta.url) };
const evidence = (extra: Record<string, unknown> = {}) =>
  viaMcp("evidence_record", { repo: REPO, pr: 12, head_sha: HEAD, kind: "test", exit_code: 0, not_verified: ["prod"], recorder: "lead", ...extra }, dirs);

const ok = (data: unknown): GhResponse<unknown> => ({ kind: "ok", status: 200, data });
const TIER = { docs_globs: ["docs/"], test_globs: ["test/"], ui_globs: [], v3_globs: [".github/"], protected_paths: [], owners: [] };
/** Land on an opted-in repo (decision 158): a V2 source change, green checks, no GitHub approval. */
function landDeps(merged: unknown[] = [], config: LandConfig = { tier: TIER, protectedPaths: [], verdictMergeRepos: [REPO] }): LandDeps {
  const routes: Record<string, GhResponse<unknown>> = {
    [`repos/${REPO}/pulls/12`]: ok({ state: "open", draft: false, head: { sha: HEAD }, base: { ref: "main" }, user: { login: world.author }, labels: [], mergeable_state: "clean" }),
    [`repos/${REPO}/pulls/12/files?per_page=100&page=1`]: ok([{ filename: "core/a.ts", patch: "@@ -1 +1 @@\n-a\n+b" }]),
    [`repos/${REPO}/rules/branches/main`]: ok([]),
    [`repos/${REPO}/pulls/12/reviews?per_page=100&page=1`]: ok([]),
    [`repos/${REPO}/compare/main...${HEAD}`]: ok({ status: "ahead" }),
  };
  const gh: GhClient = { get: async <T>(path: string) => (routes[path] ?? { kind: "error", status: 404, message: "Not Found" }) as GhResponse<T> };
  return {
    gh,
    openStore,
    merge: async () => assert.fail("no --auto on the verdict path"),
    config: () => config,
    prGate: async () => ({ kind: "ok", data: { headSha: HEAD, unresolvedThreads: 0, checks: [{ name: "unit", required: true, state: "pass" }], methods: ["squash"] } }),
    mergeNow: async (a) => {
      merged.push(a);
      return { ok: true, message: "merged" };
    },
  };
}
const verdict = () => {
  const s = openStore();
  s.append({ type: "review_verdict", source: "review record", actor: "claude", dedupe_key: dedupeKey(EVENTS.review_verdict, "acme/api#12", HEAD, "claude"), payload: { pr: "acme/api#12", head_sha: HEAD, act_on: 0, reviewer: "claude", author: "alice" } });
  s.close();
};
const land = async () => landTool(() => landDeps()).handler({ repo: REPO, pr: 12, dry_run: true });

test("a V2 PR is refused evidence_missing naming evidence_record, and lands once a non-author records test and run", async () => {
  reset();
  verdict();
  const before = await land();
  assert.equal(before.ok ? "" : before.refusal.code, "evidence_missing");
  assert.match(before.ok ? "" : before.refusal.fix, /evidence_record tool \(CLI: sangsoe evidence record\)/);

  assert.deepEqual(await evidence(), { ok: true, value: `recorded: test evidence on acme/api#12 ${HEAD} by lead, exit 0` });
  assert.deepEqual((await evidence({ kind: "run" })).ok, true);
  assert.deepEqual(rows("evidence")[0], {
    actor: "lead",
    subject: "acme/api#12",
    payload: { kind: "test", head_sha: HEAD, exit_code: 0, not_verified: ["prod"] },
  });
  const merged: unknown[] = [];
  const landed = await landTool(() => landDeps(merged)).handler({ repo: REPO, pr: 12 });
  assert.ok(landed.ok, JSON.stringify(landed));
  assert.equal((landed.value as { action: string }).action, "merge_verdict");
  assert.match((landed.value as { note: string }).note, /V2: test, run/);
  assert.deepEqual(merged, [{ repo: REPO, pr: 12, head: HEAD, method: "squash" }]);
});

test("decision 172: a config with only verdict_merge_repos is V3 through land and verify-tier, naming the missing lists", async () => {
  reset();
  verdict();
  const gap = "config.json lacks verify_tier.docs_globs, verify_tier.test_globs, verify_tier.ui_globs, verify_tier.v3_globs, protected_paths";
  const config: LandConfig = { tier: null, protectedPaths: null, verdictMergeRepos: [REPO], tierGap: gap };
  const r = await landTool(() => landDeps([], config)).handler({ repo: REPO, pr: 12, dry_run: true });
  assert.equal(r.ok ? "" : r.refusal.code, "evidence_missing");
  assert.match(r.ok ? "" : r.refusal.reason, new RegExp(`V3 \\(tier source: none \\(fail-closed V3\\): ${gap}\\)`));
  const t = await tierOfPr(landDeps([], config), { repo: REPO, pr: 12 });
  assert.ok(t.ok);
  assert.deepEqual([t.value.effective, t.value.tier_source], ["V3", `none (fail-closed V3): ${gap}`]);
  const full = await tierOfPr(landDeps(), { repo: REPO, pr: 12 });
  assert.ok(full.ok);
  assert.deepEqual([full.value.effective, full.value.tier_source], ["V2", "config"]);
});

test("the PR's author is refused by name through both entrances, and by its checkout through the tool", async () => {
  reset();
  const byName = await expectSameViaBothEntrances({
    tool: "evidence_record",
    input: { repo: REPO, pr: 12, head_sha: HEAD, kind: "test", exit_code: 0, not_verified: ["prod"], recorder: "Alice" },
    argv: ["evidence", "record", "--repo", REPO, "--pr", "12", "--head", HEAD, "--kind", "test", "--exit-code", "0", "--not-verified", "prod", "--recorder", "Alice"],
    dirs,
  });
  assert.equal(byName.ok ? "" : byName.refusal.code, "evidence_refused");
  assert.match(byName.ok ? "" : byName.refusal.reason, /Alice is the author of acme\/api#12/);

  world.session = { sha: "c".repeat(40), branch: PR_BRANCH };
  const byBranch = await evidence();
  assert.equal(byBranch.ok ? "" : byBranch.refusal.code, "recorder_is_author");
  world.session = { sha: HEAD, branch: "HEAD" };
  const byCommit = await evidence();
  assert.equal(byCommit.ok ? "" : byCommit.refusal.code, "recorder_is_author");
  world.session = null;
  const unknown = await evidence();
  assert.equal(unknown.ok ? "" : unknown.refusal.code, "recorder_unknown");
  assert.deepEqual(rows("evidence"), []);

  verdict();
  const s = openStore();
  s.append({ type: "evidence", source: "test", subject: "acme/api#12", actor: "alice", payload: { kind: "test", head_sha: HEAD, exit_code: 0, not_verified: ["prod"] } });
  s.close();
  const still = await land();
  assert.match(still.ok ? "" : still.refusal.reason, /test: written by the PR's author/, "a row the author slipped in by hand still does not count");
});

test("evidence the reader could never count is refused before it is written", async () => {
  reset();
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ head_sha: "d".repeat(40) }, /is not the head of acme\/api#12/],
    [{ kind: "owner_done" }, /"kind" must be one of \["test","run","ui","dev"\]/],
    [{ not_verified: [" "] }, /not_verified must name at least one thing/],
    [{ path: "/tmp/out.log" }, /path and sha256 go together/],
  ];
  for (const [extra, want] of cases) {
    const r = await evidence(extra);
    assert.match(r.ok ? "" : r.refusal.reason, want);
  }
  assert.deepEqual(rows("evidence"), []);
});

test("stage_record writes stage_recorded for a merged PR only, and a deploys_after edge waiting on it advances", async () => {
  reset();
  const notMerged = await viaMcp("stage_record", { repo: REPO, pr: 12, stage: "merge", sha: "abc1234", recorder: "lead" }, dirs);
  assert.match(notMerged.ok ? "" : notMerged.refusal.reason, /has not merged/);
  world.merged = true;
  const r = await expectSameViaBothEntrances({
    tool: "stage_record",
    input: { repo: REPO, pr: 12, stage: "merge", sha: "abc1234", recorder: "Alice" },
    argv: ["stage", "record", "--repo", REPO, "--pr", "12", "--stage", "merge", "--sha", "abc1234", "--recorder", "Alice"],
    dirs,
  });
  assert.match(r.ok ? "" : r.refusal.reason, /Alice is the author/);
  world.session = { sha: "c".repeat(40), branch: PR_BRANCH };
  const bySession = await viaMcp("stage_record", { repo: REPO, pr: 12, stage: "merge", sha: "abc1234", recorder: "lead" }, dirs);
  assert.equal(bySession.ok ? "" : bySession.refusal.code, "recorder_is_author");
  assert.deepEqual(rows("stage_recorded"), []);
  world.session = { sha: "b".repeat(40), branch: "lead/program" };
  const recordedViaTool = await viaMcp("stage_record", { repo: REPO, pr: 12, stage: "dev", sha: "abc1234", recorder: "lead" }, dirs);
  assert.deepEqual(recordedViaTool, { ok: true, value: "recorded: acme/api#12 dev at abc1234 by lead" });
  assert.deepEqual(rows("stage_recorded"), [{ actor: "lead", subject: null, payload: { pr: "acme/api#12", stage: "dev", sha: "abc1234" } }]);

  // The flow GRAPH expands waits on this row: deploy_dev is not ready until merge is recorded.
  const w = createGraphWorld();
  const p = planFlow(loadFlow("ship-change"), { repo: REPO });
  assert.ok(p.ok, JSON.stringify(p));
  const e = await expandFlow(w, { plan: p.value, run: "run_a", who: "lead:api", requestId: "req-1" });
  assert.ok(e.ok, JSON.stringify(e));
  const steps = e.value.steps as Record<string, string>;
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#12", task: steps.impl as string } });
  for (const id of ["impl", "review"]) w.complete(steps[id] as string);
  w.store.append({ type: "pr_merged", source: "pr-monitor", payload: { pr: "acme/api#12", merge_sha: "abc1234" } });
  w.complete(steps.merge as string);
  const readyIds = async () => ready(await w.input()).map((x) => x.task);
  assert.ok(!(await readyIds()).includes(steps.deploy_dev as string), "merged, but no merge stage yet");

  // The graph world keeps its store open, so the entrance gets one whose close does nothing.
  const graphStore = { append: (row: Parameters<Store["append"]>[0]) => w.store.append(row), close() {} } as unknown as Store;
  const recorded = await recordStage({ repo: REPO, pr: 12, stage: "merge", sha: "abc1234", recorder: "lead" }, { exec, openStore: () => graphStore });
  assert.deepEqual(recorded, { ok: true, note: "recorded: acme/api#12 merge at abc1234 by lead" });
  assert.ok((await readyIds()).includes(steps.deploy_dev as string), "the recorded stage opens deploy_dev");
});
