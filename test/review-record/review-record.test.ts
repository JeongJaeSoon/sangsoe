import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { after, test } from "node:test";
import { landTool } from "../../claude-plugin/mcp/tools/land.ts";
import type { GhClient, GhResponse, LandDeps } from "../../core/index.ts";
import { expectSameViaBothEntrances, viaCli, viaMcp } from "../boundaries/both-entrances.ts";
import { HEAD, openStore, PR_BRANCH, REPO, reset, world } from "./world.ts";

// Decisions 111, 158, 162: a lead records an independent verdict through MCP, and land's verdict
// path reads that row. The PR's author, as reviewer or as the calling session, records nothing.
after(() => rmSync(world.dir, { recursive: true, force: true }));

const dirs = { tools: new URL("./entrances/tools/", import.meta.url), commands: new URL("./entrances/commands/", import.meta.url) };
const record = (extra: Record<string, unknown> = {}) =>
  viaMcp("review_record", { repo: REPO, pr: 12, head_sha: HEAD, act_on: 0, reviewer: "claude", ...extra }, dirs);
const verdicts = () => {
  const s = openStore();
  try {
    return s.events({ type: "review_verdict" }).map((e) => e.payload);
  } finally {
    s.close();
  }
};

const ok = (data: unknown): GhResponse<unknown> => ({ kind: "ok", status: 200, data });
/** Land on an opted-in repo (decision 158): green checks, evidence at the head, no GitHub approval. */
function landDeps(merged: unknown[]): LandDeps {
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
    config: () => ({
      tier: { docs_globs: ["docs/"], test_globs: ["test/"], ui_globs: [], v3_globs: [".github/"], protected_paths: [], owners: [] },
      protectedPaths: [],
      verdictMergeRepos: [REPO],
    }),
    prGate: async () => ({ kind: "ok", data: { headSha: HEAD, unresolvedThreads: 0, checks: [{ name: "unit", required: true, state: "pass" }], methods: ["squash"] } }),
    mergeNow: async (a) => {
      merged.push(a);
      return { ok: true, message: "merged" };
    },
  };
}

test("a non-author session records a verdict at the head, and land's verdict path merges on it", async () => {
  reset();
  const r = await record();
  assert.deepEqual(r, { ok: true, value: `recorded: acme/api#12 ${HEAD} reviewed by claude, 0 Act-on` });
  assert.deepEqual(verdicts(), [{ pr: "acme/api#12", head_sha: HEAD, act_on: 0, reviewer: "claude", author: "alice" }]);

  const s = openStore();
  for (const kind of ["test", "run"]) {
    s.append({ type: "evidence", source: "test", subject: "acme/api#12", actor: "worker:u31", payload: { kind, head_sha: HEAD, exit_code: 0, not_verified: ["prod"] } });
  }
  s.close();
  const merged: unknown[] = [];
  const landed = await landTool(() => landDeps(merged)).handler({ repo: REPO, pr: 12 });
  assert.ok(landed.ok, JSON.stringify(landed));
  assert.equal((landed.value as { action: string }).action, "merge_verdict");
  assert.deepEqual(merged, [{ repo: REPO, pr: 12, head: HEAD, method: "squash" }]);
});

test("the session whose checkout holds the PR is refused before GitHub's author is read; nothing is written", async () => {
  reset();
  world.session = { sha: "c".repeat(40), branch: PR_BRANCH };
  const byBranch = await record();
  assert.equal(byBranch.ok ? "" : byBranch.refusal.code, "recorder_is_author");
  world.session = { sha: HEAD, branch: "HEAD" };
  const byCommit = await record();
  assert.equal(byCommit.ok ? "" : byCommit.refusal.code, "recorder_is_author", "a detached checkout at the PR's head wrote it too");
  assert.ok(!world.calls.some((c) => c.includes("@tsv")), "core's record was never reached");
  assert.deepEqual(verdicts(), []);
});

// Decision 227: the CLI is an agent session when Claude Code set CLAUDECODE; this suite runs the
// owner's shell unless a test says otherwise, whatever shell started it.
delete process.env.CLAUDECODE;
async function asAgent<T>(f: () => Promise<T>): Promise<T> {
  process.env.CLAUDECODE = "1";
  try {
    return await f();
  } finally {
    delete process.env.CLAUDECODE;
  }
}
const cliArgv = (reviewer = "claude") => ["review", "record", "--repo", REPO, "--pr", "12", "--head", HEAD, "--act-on", "0", "--reviewer", reviewer];

test("decision 227: `sangsoe review record` from the PR's author session is refused, so land still has no verdict", async () => {
  reset();
  for (const session of [{ sha: "c".repeat(40), branch: PR_BRANCH }, { sha: HEAD, branch: "HEAD" }]) {
    world.session = session;
    const r = await asAgent(() => viaCli(cliArgv(), dirs));
    assert.equal(r.ok ? "" : r.refusal.code, "recorder_is_author", JSON.stringify(r));
    assert.match(r.ok ? "" : r.refusal.fix, /sends the reviewed head, the reviewer and the evidence to its lead/);
  }
  world.session = { sha: "c".repeat(40), branch: PR_BRANCH };
  const both = await asAgent(() =>
    expectSameViaBothEntrances({ tool: "review_record", input: { repo: REPO, pr: 12, head_sha: HEAD, act_on: 0, reviewer: "claude" }, argv: cliArgv(), dirs }),
  );
  assert.equal(both.ok ? "" : both.refusal.code, "recorder_is_author");
  assert.deepEqual(verdicts(), []);

  const s = openStore();
  for (const kind of ["test", "run"]) {
    s.append({ type: "evidence", source: "test", subject: "acme/api#12", actor: "worker:u31", payload: { kind, head_sha: HEAD, exit_code: 0, not_verified: ["prod"] } });
  }
  s.close();
  const landed = await landTool(() => landDeps([])).handler({ repo: REPO, pr: 12, dry_run: true });
  assert.equal(landed.ok ? "" : landed.refusal.code, "review_missing", JSON.stringify(landed));

  world.session = { sha: "b".repeat(40), branch: "lead/program" };
  assert.equal((await asAgent(() => viaCli(cliArgv(), dirs))).ok, true, "another session records");
  world.session = { sha: "c".repeat(40), branch: PR_BRANCH };
  world.calls = [];
  assert.equal((await viaCli(cliArgv("codex"), dirs)).ok, true, "the owner's shell records");
  assert.ok(!world.calls.some((c) => c.startsWith("git ")), "the owner's shell reads no checkout");
  assert.deepEqual(
    verdicts().map((v) => v.reviewer),
    ["claude", "codex"],
  );
});

test("a session with no readable checkout is refused, never taken for someone else", async () => {
  reset();
  world.session = null;
  const r = await record();
  assert.equal(r.ok ? "" : r.refusal.code, "recorder_unknown");
  assert.deepEqual(verdicts(), []);
});

test("the PR's author as reviewer: the same refusal through the tool and `sangsoe review record`", async () => {
  reset();
  const r = await expectSameViaBothEntrances({
    tool: "review_record",
    input: { repo: REPO, pr: 12, head_sha: HEAD, act_on: 0, reviewer: "Alice" },
    argv: ["review", "record", "--repo", REPO, "--pr", "12", "--head", HEAD, "--act-on", "0", "--reviewer", "Alice"],
    dirs,
  });
  assert.equal(r.ok ? "" : r.refusal.code, "review_refused");
  assert.match(r.ok ? "" : r.refusal.reason, /Alice is the author of acme\/api#12/);
  assert.deepEqual(verdicts(), []);
});

test("S2: a later verdict with another count at the same head is stored; the same count again stands", async () => {
  reset();
  assert.equal((await record({ reviewer: "codex" })).ok, true);
  const worse = await record({ reviewer: "codex", act_on: 2 });
  assert.match(worse.ok ? String(worse.value) : "", /^recorded/);
  assert.deepEqual(
    verdicts().map((v) => v.act_on),
    [0, 2],
    "the worse row is kept, and land reads the one with findings",
  );
  const r = await expectSameViaBothEntrances({
    tool: "review_record",
    input: { repo: REPO, pr: 12, head_sha: HEAD, act_on: 2, reviewer: "codex" },
    argv: ["review", "record", "--repo", REPO, "--pr", "12", "--head", HEAD, "--act-on", "2", "--reviewer", "codex"],
    dirs,
  });
  assert.match(r.ok ? String(r.value) : "", /^already recorded/);
  assert.equal(verdicts().length, 2);
});
