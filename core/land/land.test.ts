import assert from "node:assert/strict";
import { test } from "node:test";
import { dedupeKey, EVENTS } from "../contract/index.ts";
import type { GhClient, GhResponse } from "../gh/client.ts";
import { Store } from "../store/store.ts";
import type { TierConfig } from "../verify/verify-tier.ts";
import { mergeConfirm } from "./github.ts";
import { type LandDeps, type LandInput, land } from "./land.ts";
import { tierOfPr } from "./tier.ts";

const REPO = "acme/api";
const PR = "acme/api#12";
const HEAD = "a".repeat(40);
const OLD = "c".repeat(40);
const ok = (data: unknown): GhResponse<unknown> => ({ kind: "ok", status: 200, data });
const TIER: TierConfig = {
  docs_globs: ["docs/"],
  test_globs: ["test/"],
  ui_globs: ["web/"],
  v3_globs: [".github/"],
  protected_paths: ["infra/"],
  owners: ["owner1"],
};
const STRICT = [
  { type: "pull_request", parameters: { required_approving_review_count: 1, dismiss_stale_reviews_on_push: true } },
  { type: "required_status_checks", parameters: { required_status_checks: [{ context: "unit" }], strict_required_status_checks_policy: true } },
];
const LOOSE = [{ type: "pull_request", parameters: { required_approving_review_count: 0 } }];

function pull(n: number, extra: Record<string, unknown> = {}) {
  return { state: "open", draft: false, head: { sha: HEAD }, base: { ref: "main" }, user: { login: "alice" }, labels: [], mergeable_state: "blocked", ...extra, number: n };
}

function routes(o: { files?: unknown[]; rules?: unknown[]; pull?: Record<string, unknown> } = {}): Record<string, GhResponse<unknown>> {
  const files = o.files ?? [{ filename: "core/a.ts", patch: "@@ -1 +1 @@\n-a\n+b" }];
  return {
    [`repos/${REPO}/pulls/12`]: ok(pull(12, o.pull)),
    [`repos/${REPO}/pulls/12/files?per_page=100&page=1`]: ok(files),
    [`repos/${REPO}/rules/branches/main`]: ok(o.rules ?? STRICT),
  };
}

function fakeGh(r: Record<string, GhResponse<unknown>>): GhClient & { paths: string[] } {
  const paths: string[] = [];
  return {
    paths,
    async get<T>(path: string) {
      paths.push(path);
      return (r[path] ?? { kind: "error", status: 404, message: "Not Found" }) as GhResponse<T>;
    },
  };
}

type Harness = { store: Store; merges: unknown[]; deps: LandDeps; gh: ReturnType<typeof fakeGh> };

function harness(r: Record<string, GhResponse<unknown>>, mergeOk = true): Harness {
  const store = Store.open({ path: ":memory:" });
  const merges: unknown[] = [];
  const gh = fakeGh(r);
  return {
    store,
    merges,
    gh,
    deps: {
      gh,
      openStore: () => ({ events: () => store.events(), append: (e) => store.append(e), close: () => {} }),
      merge: async (a) => {
        merges.push(a);
        return mergeOk ? { ok: true, message: "auto-merge enabled" } : { ok: false, message: "Pull request is in clean status" };
      },
      config: () => ({ tier: TIER, protectedPaths: TIER.protected_paths }),
    },
  };
}

const verdict = (store: Store, head = HEAD, actOn = 0, reviewer = "codex") =>
  store.append({
    type: "review_verdict",
    source: "review record",
    actor: reviewer,
    dedupe_key: dedupeKey(EVENTS.review_verdict, PR, head, reviewer, String(actOn)),
    payload: { pr: PR, head_sha: head, act_on: actOn, reviewer, author: "alice" },
  });
const stackEdge = (store: Store, pred: string, succ: string) =>
  store.append({ type: "edge_added", source: "GRAPH", dedupe_key: dedupeKey(EVENTS.edge_added, pred, succ, "stacked_on"), payload: { pred, succ, kind: "stacked_on" } });
const opened = (store: Store, pr: string, task: string) => store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr, task } });
const evidence = (store: Store, kind: string, extra: Record<string, unknown> = {}, actor = "worker:u11") =>
  store.append({ type: "evidence", source: "test", subject: PR, actor, payload: { kind, head_sha: HEAD, exit_code: 0, not_verified: ["prod"], ...extra } });
const ready = (store: Store) => {
  verdict(store);
  evidence(store, "test");
  evidence(store, "run");
};
const landRows = (store: Store) =>
  store.events().filter((e) => e.type === "land_failed" || e.type === "land_requested").map((e) => `${e.type}:${String(e.payload.reason ?? "")}`);
const input = (extra: Partial<LandInput> = {}): LandInput => ({ repo: REPO, pr: 12, ...extra });

test("all checks pass and the four conditions hold: gh pr merge --auto, land_requested", async () => {
  const h = harness(routes());
  ready(h.store);
  const r = await land(input(), h.deps);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.value.action, "auto_merge");
  assert.equal(r.value.tier, "V2");
  assert.deepEqual(h.merges, [{ repo: REPO, pr: 12, head: HEAD }]);
  assert.deepEqual(landRows(h.store), ["land_requested:"]);
});

test("GitHub calls keep the repo's given case; only the event key is lowercased", async () => {
  // A fine-grained token answers 404 for a private repo named in another case.
  const given = "Acme/API";
  const h = harness(Object.fromEntries(Object.entries(routes()).map(([k, v]) => [k.replace(REPO, given), v])));
  ready(h.store);
  const r = await land(input({ repo: given }), h.deps);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.value.pr, PR);
  assert.ok(h.gh.paths.every((p) => p.startsWith(`repos/${given}/`)), h.gh.paths.join("\n"));
  assert.deepEqual(h.merges, [{ repo: given, pr: 12, head: HEAD }]);

  h.store.append({ type: "main_red", source: "pr-monitor", payload: { repo: REPO, sha: "d".repeat(40), run_id: "77" } });
  const frozen = await land(input({ repo: given }), h.deps);
  assert.equal(frozen.ok ? "" : frozen.refusal.code, "main_red", "the stored lowercase main state still matches");

  const tier = await tierOfPr(h.deps, { repo: given, pr: 12 });
  assert.ok(tier.ok, JSON.stringify(tier));
  assert.equal(tier.value.pr, PR);
  assert.ok(h.gh.paths.every((p) => p.startsWith(`repos/${given}/`)));
});

test("a condition false: land_requested{merge_on_approval} and no merge", async () => {
  const h = harness(routes({ rules: LOOSE }));
  ready(h.store);
  const r = await land(input(), h.deps);
  assert.ok(r.ok);
  assert.equal(r.value.action, "merge_on_approval");
  assert.deepEqual(h.merges, []);
  assert.deepEqual(landRows(h.store), ["land_requested:merge_on_approval"]);
});

test("decision 81's re-call: approved by another login and green at the head, so land asks GitHub to merge", async () => {
  const r0 = routes({ rules: LOOSE, pull: { mergeable_state: "clean" } });
  r0[`repos/${REPO}/pulls/12/reviews?per_page=100&page=1`] = ok([
    { user: { login: "alice" }, state: "APPROVED", commit_id: HEAD },
    { user: { login: "bob" }, state: "APPROVED", commit_id: HEAD, author_association: "MEMBER" },
  ]);
  r0[`repos/${REPO}/commits/${HEAD}/check-runs?per_page=100`] = ok({ total_count: 1, check_runs: [{ status: "completed", conclusion: "success" }] });
  const h = harness(r0);
  ready(h.store);
  const r = await land(input(), h.deps);
  assert.ok(r.ok);
  assert.equal(r.value.action, "merge_approved");
  assert.equal(h.merges.length, 1);
  assert.deepEqual(landRows(h.store), ["land_requested:approved"]);
});

test("an approval counts only from a member, collaborator, owner or a login in config owners", async () => {
  const approvedBy = async (login: string, association: string) => {
    const r0 = routes({ rules: LOOSE, pull: { mergeable_state: "clean" } });
    r0[`repos/${REPO}/pulls/12/reviews?per_page=100&page=1`] = ok([
      { user: { login }, state: "APPROVED", commit_id: HEAD, author_association: association },
    ]);
    r0[`repos/${REPO}/commits/${HEAD}/check-runs?per_page=100`] = ok({ total_count: 1, check_runs: [{ status: "completed", conclusion: "success" }] });
    const h = harness(r0);
    ready(h.store);
    const r = await land(input(), h.deps);
    return { action: r.ok && r.value.action, merges: h.merges.length };
  };
  assert.deepEqual(await approvedBy("outsider", "NONE"), { action: "merge_on_approval", merges: 0 });
  assert.deepEqual(await approvedBy("drive-by", "CONTRIBUTOR"), { action: "merge_on_approval", merges: 0 });
  assert.deepEqual(await approvedBy("Owner1", "NONE"), { action: "merge_approved", merges: 1 });
  assert.deepEqual(await approvedBy("carol", "COLLABORATOR"), { action: "merge_approved", merges: 1 });
});

test("only the author approved: still merge_on_approval", async () => {
  const r0 = routes({ rules: LOOSE, pull: { mergeable_state: "clean" } });
  r0[`repos/${REPO}/pulls/12/reviews?per_page=100&page=1`] = ok([{ user: { login: "alice" }, state: "APPROVED", commit_id: HEAD }]);
  const h = harness(r0);
  ready(h.store);
  const r = await land(input(), h.deps);
  assert.equal(r.ok && r.value.action, "merge_on_approval");
  assert.deepEqual(h.merges, []);
});

test("evidence is checked before the conditions: a missing kind is land_failed{evidence_missing:<kind>}, nothing scheduled", async () => {
  const h = harness(routes());
  verdict(h.store);
  evidence(h.store, "test");
  const r = await land(input(), h.deps);
  assert.deepEqual(r.ok ? null : [r.refusal.code, r.refusal.reason.split(" ")[0]], ["evidence_missing", "evidence_missing:run"]);
  assert.deepEqual(landRows(h.store), ["land_failed:evidence_missing:run"]);
  assert.deepEqual(h.merges, []);
  assert.ok(!h.gh.paths.some((p) => p.includes("/rules/")), "the four conditions were not read");
});

test("evidence at an older head does not count", async () => {
  const h = harness(routes());
  verdict(h.store);
  evidence(h.store, "test", { head_sha: OLD });
  evidence(h.store, "run");
  const r = await land(input(), h.deps);
  assert.equal(r.ok ? "" : r.refusal.reason.split(" ")[0], "evidence_missing:test");
});

test("the author's own passing evidence does not count (R-04)", async () => {
  const h = harness(routes());
  verdict(h.store);
  evidence(h.store, "test", {}, "alice");
  evidence(h.store, "run");
  const r = await land(input(), h.deps);
  assert.equal(r.ok ? "" : r.refusal.reason.split(" ")[0], "evidence_missing:test");
  assert.match(r.ok ? "" : r.refusal.reason, /written by the PR's author/);
});

test("a docs-only PR (V0) needs no evidence rows", async () => {
  const h = harness(routes({ files: [{ filename: "docs/a.md", patch: "@@ -1 +1 @@\n-a\n+b" }] }));
  verdict(h.store);
  const r = await land(input(), h.deps);
  assert.equal(r.ok && r.value.tier, "V0");
});

test("no review verdict, or one with Act-on left, is refused", async () => {
  const none = harness(routes());
  const r1 = await land(input(), none.deps);
  assert.equal(r1.ok ? "" : r1.refusal.code, "review_missing");
  const actOn = harness(routes());
  verdict(actOn.store, HEAD, 2);
  verdict(actOn.store, HEAD, 0, "claude");
  const r2 = await land(input(), actOn.deps);
  assert.deepEqual(r2.ok ? null : [r2.refusal.code, r2.refusal.reason.split(" ")[0]], ["review_act_on", "review_act_on:2"]);
});

test("main_red freezes the repo for everything but main_fix", async () => {
  const h = harness(routes());
  ready(h.store);
  h.store.append({ type: "main_red", source: "pr-monitor", payload: { repo: REPO, sha: "d".repeat(40), run_id: "77" } });
  const frozen = await land(input(), h.deps);
  assert.equal(frozen.ok ? "" : frozen.refusal.code, "main_red");
  const fix = await land(input({ mainFix: true }), h.deps);
  assert.equal(fix.ok && fix.value.action, "auto_merge");
  assert.deepEqual(landRows(h.store), ["land_failed:main_red", "land_requested:"]);
});

test("scenario repo_level_main (land side): one main state per repo, any group's green clears it", async () => {
  const h = harness(routes());
  ready(h.store);
  h.store.append({ type: "main_red", source: "pr-monitor", actor: "lead:group-a", payload: { repo: REPO, sha: "d".repeat(40), run_id: "77" } });
  h.store.append({ type: "main_red", source: "pr-monitor", payload: { repo: "acme/web", sha: "e".repeat(40), run_id: "78" } });
  assert.equal((await land(input(), h.deps)).ok, false, "red from group A blocks group B's PR in the same repo");
  h.store.append({ type: "main_green", source: "pr-monitor", actor: "lead:group-b", payload: { repo: REPO, sha: "f".repeat(40), run_id: "79" } });
  const r = await land(input(), h.deps);
  assert.ok(r.ok, "group B's green clears the repo; acme/web's red is another repo");
});

test("scenario stack_bottom: only the bottom PR can land; an upper one is refused with the order", async () => {
  const h = harness(routes());
  ready(h.store);
  opened(h.store, "acme/api#10", "task_a");
  opened(h.store, "acme/api#11", "task_b");
  opened(h.store, PR, "task_c");
  stackEdge(h.store, "task_a", "task_b");
  stackEdge(h.store, "task_b", "task_c");
  const upper = await land(input(), h.deps);
  assert.equal(upper.ok ? "" : upper.refusal.code, "stack_order");
  assert.match(upper.ok ? "" : upper.refusal.fix, /land acme\/api#10 first/);
  h.store.append({ type: "pr_merged", source: "pr-monitor", payload: { pr: "acme/api#10", merge_sha: "1".repeat(40) } });
  const middle = await land(input(), h.deps);
  assert.match(middle.ok ? "" : middle.refusal.fix, /land acme\/api#11 first/);
  h.store.append({ type: "pr_merged", source: "pr-monitor", payload: { pr: "acme/api#11", merge_sha: "2".repeat(40) } });
  assert.ok((await land(input(), h.deps)).ok, "the bottom merged, so the upper one opens");
});

test("a stacked_on predecessor task with no PR opened fails closed", async () => {
  const h = harness(routes());
  ready(h.store);
  opened(h.store, PR, "task_c");
  stackEdge(h.store, "task_x", "task_c");
  const r = await land(input(), h.deps);
  assert.equal(r.ok ? "" : r.refusal.code, "stack_order");
  assert.match(r.ok ? "" : r.refusal.reason, /task_x/);
  assert.deepEqual(landRows(h.store), ["land_failed:stack_order:task_x"]);
});

test("a PR with no task mapping fails closed while a stacked_on edge has a successor task with no PR", async () => {
  const h = harness(routes());
  ready(h.store);
  opened(h.store, "acme/api#10", "task_a");
  stackEdge(h.store, "task_a", "task_c");
  const r = await land(input(), h.deps);
  assert.equal(r.ok ? "" : r.refusal.code, "stack_order");
  assert.match(r.ok ? "" : r.refusal.reason, /task_c/);
  h.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: PR } });
  assert.equal((await land(input(), h.deps)).ok, false, "a pr_opened without task maps nothing");
  opened(h.store, "acme/api#13", "task_c");
  assert.ok((await land(input(), h.deps)).ok, "task_c is another PR's, so nothing is stacked under this one");
});

test("a removed stacked_on edge no longer blocks", async () => {
  const h = harness(routes());
  ready(h.store);
  opened(h.store, "acme/api#10", "task_a");
  opened(h.store, PR, "task_c");
  stackEdge(h.store, "task_a", "task_c");
  h.store.append({ type: "edge_removed", source: "GRAPH", payload: { pred: "task_a", succ: "task_c", kind: "stacked_on", reason: "restacked" } });
  assert.ok((await land(input(), h.deps)).ok);
});

function retarget(samePatch: boolean): Harness {
  const r0 = routes();
  const patch = (body: string) => ok({ status: "ahead", files: [{ filename: "core/a.ts", patch: body }] });
  r0[`repos/${REPO}/compare/feature-a...${OLD}`] = patch("@@ -3,1 +3,1 @@\n-a\n+b");
  r0[`repos/${REPO}/compare/main...${HEAD}`] = patch(samePatch ? "@@ -9,1 +9,1 @@\n-a\n+ b" : "@@ -9,1 +9,1 @@\n-a\n+c");
  const h = harness(r0);
  verdict(h.store, OLD);
  evidence(h.store, "test");
  evidence(h.store, "run");
  h.store.append({ type: "pr_base_changed", source: "pr-monitor", payload: { pr: PR, from: "feature-a", to: "main" } });
  return h;
}

test("scenario retarget_approval (land side): base changed and the head differs, so land refuses for re-review", async () => {
  const h = retarget(false);
  const r = await land(input(), h.deps);
  assert.equal(r.ok ? "" : r.refusal.code, "review_stale");
  assert.match(r.ok ? "" : r.refusal.fix, /review the head aaaaaaa/);
  assert.deepEqual(landRows(h.store), [`land_failed:review_stale:${OLD.slice(0, 7)}`]);
});

test("scenario retarget_approval (land side): the same patch-id inherits the verdict", async () => {
  const h = retarget(true);
  const r = await land(input(), h.deps);
  assert.ok(r.ok, JSON.stringify(r));
  assert.match(r.value.note, /verdict inherited from ccccccc by patch-id/);
});

test("refusals before the judgment: unreadable PR, closed PR, draft, moved head, rate limit", async () => {
  const unreadable = harness({});
  const r1 = await land(input(), unreadable.deps);
  assert.equal(r1.ok ? "" : r1.refusal.code, "pr_unreadable");
  assert.deepEqual(landRows(unreadable.store), ["land_failed:pr_unreadable"]);

  const merged = harness(routes({ pull: { state: "closed", merged: true } }));
  assert.equal((await land(input(), merged.deps)).ok ? "" : "pr_not_open", "pr_not_open");
  assert.deepEqual(landRows(merged.store), ["land_failed:pr_not_open:merged"]);

  const draft = harness(routes({ pull: { draft: true } }));
  const r3 = await land(input(), draft.deps);
  assert.equal(r3.ok ? "" : r3.refusal.reason.split(" ")[0], "pr_not_open:draft");

  const moved = harness(routes());
  const r4 = await land(input({ headSha: OLD }), moved.deps);
  assert.equal(r4.ok ? "" : r4.refusal.code, "head_moved");

  const limited = harness({ [`repos/${REPO}/pulls/12`]: { kind: "rate_limited", resource: "core", resetAt: 1_900_000_000 } });
  const r5 = await land(input(), limited.deps);
  assert.equal(r5.ok ? "" : r5.refusal.code, "rate_limited");
});

test("invalid input touches nothing", async () => {
  const h = harness(routes());
  for (const bad of [{ repo: "acme", pr: 12 }, { repo: REPO, pr: 0 }, { repo: REPO, pr: 12, headSha: "abc" }]) {
    const r = await land(bad, h.deps);
    assert.equal(r.ok ? "" : r.refusal.code, "invalid_input");
  }
  assert.deepEqual(h.gh.paths, []);
  assert.deepEqual(landRows(h.store), []);
});

test("GitHub refusing the merge is land_failed{merge_refused}", async () => {
  const h = harness(routes(), false);
  ready(h.store);
  const r = await land(input(), h.deps);
  assert.equal(r.ok ? "" : r.refusal.code, "merge_refused");
  assert.match(r.ok ? "" : r.refusal.reason, /clean status/);
  assert.deepEqual(landRows(h.store), ["land_failed:merge_refused"]);
});

test("--dry-run runs the same judgment and writes nothing (R-03)", async () => {
  const h = harness(routes());
  ready(h.store);
  const dry = await land(input({ dryRun: true }), h.deps);
  assert.ok(dry.ok);
  assert.deepEqual([dry.value.action, dry.value.dry_run], ["auto_merge", true]);
  assert.deepEqual(h.merges, []);
  assert.deepEqual(landRows(h.store), []);
  const refused = harness(routes());
  const r = await land(input({ dryRun: true }), refused.deps);
  assert.equal(r.ok ? "" : r.refusal.code, "review_missing");
  assert.deepEqual(landRows(refused.store), []);
  const real = await land(input(), refused.deps);
  assert.deepEqual(real.ok ? null : real.refusal, r.ok ? null : r.refusal, "the dry run's refusal is the real one");
});

test("an unreadable config is V3 and fails closed", async () => {
  const h = harness(routes());
  ready(h.store);
  h.deps.config = () => ({ tier: null, protectedPaths: null });
  const r = await land(input(), h.deps);
  assert.equal(r.ok ? "" : r.refusal.reason.split(" ")[0], "evidence_missing:dev");
});

test("merge_confirm: true only when GitHub shows it merged and the merge commit is on main", async () => {
  const M = "9".repeat(40);
  const base = (pullData: Record<string, unknown>, status: string) =>
    fakeGh({
      [`repos/${REPO}/pulls/12`]: ok(pull(12, pullData)),
      [`repos/${REPO}`]: ok({ default_branch: "main" }),
      [`repos/${REPO}/compare/main...${M}`]: ok({ status }),
    });
  assert.equal((await mergeConfirm(base({ state: "closed", merged: true, merge_commit_sha: M }, "behind"), REPO, 12)).merged, true);
  assert.equal((await mergeConfirm(base({ state: "closed", merged: true, merge_commit_sha: M }, "identical"), REPO, 12)).merged, true);
  assert.equal((await mergeConfirm(base({ state: "closed", merged: true, merge_commit_sha: M }, "diverged"), REPO, 12)).merged, false);
  assert.equal((await mergeConfirm(base({ state: "closed", merged: false, merge_commit_sha: M }, "behind"), REPO, 12)).merged, false);
  assert.equal((await mergeConfirm(fakeGh({}), REPO, 12)).merged, false);
});
