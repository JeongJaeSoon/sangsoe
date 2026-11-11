import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildGroup,
  DEFAULT_MONITOR_CONFIG,
  dedupeKey,
  EVENTS,
  type GhClient,
  type GhResponse,
  graphRead,
  land,
  type LandDeps,
  type MonitorDeps,
  nullChatProvider,
  recordReviewVerdict,
  runMonitor,
  VERSION,
  type ViewInput,
  type ViewTask,
} from "../../core/index.ts";
import { createWorld } from "../decision/world.ts";

// G31 (decision 215) through the real path: GitHub retargets a stacked PR to main and dismisses its
// approval, pr-monitor records the base change, the queue round makes the re-review item, land and
// the merge-ready report hold until a review is recorded after the change, and that review clears it.

const REPO = "acme/api";
const PR = "acme/api#12";
const HEAD = "a".repeat(40);
const RUN = "run_000000000001";
const ITEM = "task_000000000001";
const NOW = Date.parse("2026-11-10T12:00:00Z");
const ok = (data: unknown): GhResponse<unknown> => ({ kind: "ok", status: 200, data });

/** The open PR #12 was stacked on: its head branch is feature-a. */
const BELOW = "acme/api#11";
const BELOW_ITEM = "task_000000000011";

function retargetWorld(also: string[] = [], o: { below?: boolean } = {}) {
  const w = createWorld(
    [ITEM, ...also, ...(o.below ? [BELOW_ITEM] : [])].map((id) => ({ id, run: RUN, status: "completed" as const, title: "api retry" })),
    { currentRun: RUN },
  );
  const { store, orca } = w;
  const pull = (base: string, state = "open") => ({ number: 12, merged_at: null, state, mergeable_state: "clean", user: { login: "alice" }, head: { sha: HEAD, ref: "feature-b", repo: { full_name: REPO } }, base: { ref: base }, labels: [] });
  const below = { number: 11, merged_at: null, state: "open", mergeable_state: "clean", user: { login: "alice" }, head: { sha: "b".repeat(40), ref: "feature-a", repo: { full_name: REPO } }, base: { ref: "main" }, labels: [] };
  const approval = (state: string) => [{ id: 501, user: { login: "bob" }, state, commit_id: HEAD, author_association: "MEMBER", submitted_at: "2026-11-10T09:00:00Z" }];
  const routes: Record<string, GhResponse<unknown>> = {
    [`repos/${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=30`]: ok([]),
    [`repos/${REPO}/commits/${HEAD}/check-runs?per_page=100`]: ok({ total_count: 1, check_runs: [{ status: "completed", conclusion: "success" }] }),
    [`repos/${REPO}/pulls/12/files?per_page=100&page=1`]: ok([{ filename: "core/a.ts", patch: "@@ -1 +1 @@\n-a\n+b" }]),
    [`repos/${REPO}/rules/branches/main`]: ok([
      { type: "pull_request", parameters: { required_approving_review_count: 1, dismiss_stale_reviews_on_push: true } },
      { type: "required_status_checks", parameters: { required_status_checks: [{ context: "unit" }], strict_required_status_checks_policy: true } },
    ]),
  };
  // GitHub keeps a merged PR's branch and its rules: a PR still based on it is mergeable there.
  routes[`repos/${REPO}/rules/branches/feature-a`] = routes[`repos/${REPO}/rules/branches/main`] as GhResponse<unknown>;
  /**
   * GitHub's side of the PR: its base and its one review, which a retarget dismisses. `closed`: #12
   * is closed unmerged; `belowGone`: #11 is no longer open (merged, its branch kept).
   */
  const github = (base: string, review: string, s: { closed?: boolean; belowGone?: boolean } = {}) => {
    const state = s.closed ? "closed" : "open";
    routes[`repos/${REPO}/pulls?state=open&per_page=100`] = ok([...(s.closed ? [] : [pull(base)]), ...(o.below && !s.belowGone ? [below] : [])]);
    routes[`repos/${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=30`] = ok(s.closed ? [pull(base, state)] : []);
    routes[`repos/${REPO}/pulls/12`] = ok(pull(base, state));
    routes[`repos/${REPO}/pulls/12/reviews?per_page=100`] = ok(approval(review));
    routes[`repos/${REPO}/pulls/12/reviews?per_page=100&page=1`] = ok(approval(review));
  };
  github("feature-a", "APPROVED");
  const gh: GhClient = { get: async <T>(path: string) => (routes[path] ?? { kind: "error", status: 404, message: "Not Found" }) as GhResponse<T> };
  const monitor: MonitorDeps = {
    orca,
    exec: async () => ({ code: 1, stdout: "", stderr: "" }),
    events: (f) => store.events(f),
    append: (e) => store.append(e),
    now: () => NOW,
    config: DEFAULT_MONITOR_CONFIG,
    chat: nullChatProvider,
    sample: () => ({ cpus: 8 }),
    gh,
    watch: () => ({ repos: [REPO], authors: [], linkedOnly: true, owners: [] }),
    tier: () => null,
    core: { store, orca },
    coreVersion: VERSION,
  };
  const merges: unknown[] = [];
  const landDeps: LandDeps = {
    gh,
    openStore: () => ({ events: () => store.events(), append: (e) => store.append(e), close: () => {} }),
    merge: async (a) => {
      merges.push(a);
      return { ok: true, message: "auto-merge enabled" };
    },
    config: () => ({ tier: { docs_globs: ["docs/"], test_globs: ["test/"], ui_globs: [], v3_globs: [], protected_paths: [], owners: [] }, protectedPaths: [] }),
  };
  // The PR as it stood stacked on feature-a: opened, reviewed clean at HEAD, evidence in, waiting on approval.
  store.append({ type: "item_created", source: "core:item", payload: { task: ITEM, alias: "i001", who: "lead:api", done_when: "PR merged", owner_action: 0 }, entity: "task", entity_id: ITEM });
  store.append({ type: "item_extra_set", source: "core:item", payload: { task: ITEM, lead: "api" }, entity: "task", entity_id: ITEM });
  for (const task of [ITEM, ...also]) {
    store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: PR, task, base: "feature-a", head_sha: HEAD, head: "feature-b" } });
  }
  if (o.below) {
    store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: BELOW, task: BELOW_ITEM, base: "main", head_sha: "b".repeat(40), head: "feature-a" } });
  }
  store.append({ type: "verify_tier_set", source: "pr-monitor", payload: { pr: PR, head_sha: HEAD, computed: "V2", effective: "V2", actor: "pr-monitor", accepted: true, reason: "x" } });
  store.append({ type: "review_verdict", source: "review record", actor: "codex", dedupe_key: dedupeKey(EVENTS.review_verdict, PR, HEAD, "codex", "0"), payload: { pr: PR, head_sha: HEAD, act_on: 0, reviewer: "codex", author: "alice" } });
  for (const kind of ["test", "run"]) {
    store.append({ type: "evidence", source: "test", subject: PR, actor: "worker:u11", payload: { kind, head_sha: HEAD, exit_code: 0, not_verified: ["prod"] } });
  }
  store.append({ type: "land_requested", source: "land", payload: { pr: PR, head_sha: HEAD, reason: "merge_on_approval" } });
  const view = async (): Promise<ViewInput> => {
    const listed = await orca.taskList({ run: RUN });
    const tasks = listed.ok ? listed.value.map((t): ViewTask => ({ id: t.id, runId: RUN, status: t.status as ViewTask["status"], deps: [] })) : [];
    return { events: store.events(), orca: { tasks, gates: [] }, now: new Date(NOW).toISOString() };
  };
  // review record reads the PR's author and head from GitHub through gh api.
  const reviewExec = async () => ({ code: 0, stdout: `alice\t${HEAD}\n`, stderr: "" });
  const record = () =>
    recordReviewVerdict(
      { repo: REPO, pr: 12, head: HEAD, actOn: 0, reviewer: "codex" },
      // The shared in-memory store stays open after review record closes its handle.
      { exec: reviewExec, openStore: () => ({ events: (f: never) => store.events(f), append: (e: never) => store.append(e), close: () => {} }) as never },
    );
  return { w, store, github, monitor, landDeps, merges, view, record };
}

const landPr = (deps: LandDeps) => land({ repo: REPO, pr: 12 }, deps);

test("G31: a retarget that dismisses the approval makes a re-review item, and land and merge-ready hold until a review after it", async () => {
  const x = retargetWorld();
  x.github("main", "DISMISSED");

  await runMonitor("pr", x.monitor);
  assert.deepEqual(
    x.store.events({ type: "pr_base_changed" }).map((e) => e.payload),
    [{ pr: PR, from: "feature-a", to: "main" }],
  );

  const refused = await landPr(x.landDeps);
  assert.equal(refused.ok ? "ok" : refused.refusal.code, "rereview_needed", "the verdict at the same head predates the base change");
  assert.match(refused.ok ? "" : refused.refusal.fix, /review record/);
  assert.deepEqual(x.merges, []);

  await runMonitor("queue", x.monitor);
  const created = x.w.calls("orchestration task-create");
  assert.equal(created.length, 1, "one re-review item in the PR item's Run");
  const items = x.store.events({ type: "item_created" }).filter((e) => e.payload.task !== ITEM);
  assert.equal(items.length, 1);
  const rereview = String(items[0]?.payload.task);
  assert.deepEqual(
    x.store.events({ type: "edge_added" }).map((e) => e.payload),
    [{ pred: `item:${rereview}`, succ: `item:${ITEM}`, kind: "blocks" }],
  );
  await runMonitor("queue", x.monitor);
  assert.equal(x.w.calls("orchestration task-create").length, 1, "a later round makes no second item");
  const again = await landPr(x.landDeps);
  assert.match(again.ok ? "" : again.refusal.reason, new RegExp(String(items[0]?.payload.alias)), "the refusal names the re-review item");

  const why = graphRead.why(await x.view(), ITEM);
  assert.deepEqual(
    why.map((e) => [e.pred, e.kind]),
    [[rereview, "blocks"]],
    "the PR item's why-not-ready row names the re-review item",
  );
  const alias = String(items[0]?.payload.alias);
  assert.deepEqual(
    buildGroup(await x.view(), "api")?.why.rows.map((r) => r.cells.slice(0, 3).map((c) => c.text)),
    [["i001", alias, "blocks"]],
    "the panel's 왜 준비되지 않았나 table shows the same row, and the re-review item sits in the PR item's group",
  );

  // A reviewer approves again on GitHub at the same head: still no merge-ready report.
  x.github("main", "APPROVED");
  await runMonitor("pr", x.monitor);
  assert.deepEqual(x.store.events({ type: "pr_ready_to_merge" }), []);

  const recorded = await x.record();
  assert.ok(recorded.inserted, recorded.note);

  assert.deepEqual(graphRead.why(await x.view(), ITEM), [], "the review clears the row");
  assert.deepEqual(buildGroup(await x.view(), "api")?.why.rows, []);
  await runMonitor("pr", x.monitor);
  assert.equal(x.store.events({ type: "pr_ready_to_merge" }).length, 1);
  const landed = await landPr(x.landDeps);
  assert.ok(landed.ok, JSON.stringify(landed));
  assert.equal(x.merges.length, 1);
});

test("G31: a review recorded after the retarget but before pr-monitor saw it is recorded again and then counts", async () => {
  const x = retargetWorld();
  x.github("main", "DISMISSED");
  assert.equal((await x.record()).inserted, false, "reviewed against main, but no base change is recorded yet: the old row stands");
  await runMonitor("pr", x.monitor);
  const late = await landPr(x.landDeps);
  assert.equal(late.ok ? "ok" : late.refusal.code, "rereview_needed", "the change row came later, so that review cannot be told apart");
  assert.equal((await x.record()).inserted, true, "recording again is a new row, not a repeat");
  assert.ok((await landPr(x.landDeps)).ok);
});

test("G31: a PR bound to two items gets one re-review item with a blocks edge into each", async () => {
  const ITEM2 = "task_000000000002";
  const x = retargetWorld([ITEM2]);
  x.github("main", "DISMISSED");
  await runMonitor("pr", x.monitor);
  await runMonitor("queue", x.monitor);
  assert.equal(x.w.calls("orchestration task-create").length, 1);
  const rereview = String(x.store.events({ type: "item_created" }).find((e) => e.payload.task !== ITEM)?.payload.task);
  assert.deepEqual(
    x.store.events({ type: "edge_added" }).map((e) => e.payload.succ).sort(),
    [`item:${ITEM}`, `item:${ITEM2}`],
  );
  for (const task of [ITEM, ITEM2]) {
    assert.deepEqual(graphRead.why(await x.view(), task).map((e) => e.pred), [rereview], task);
  }
});

test("G22: retargeted off an open PR's head, the inferred stacked_on edge goes, and land passes after a review recorded after the change", async () => {
  const x = retargetWorld([], { below: true });
  const edge = { pred: `pr:${BELOW}`, succ: `item:${ITEM}`, kind: "stacked_on" };
  await runMonitor("queue", x.monitor);
  assert.deepEqual(x.store.events({ type: "edge_added" }).map((e) => e.payload), [edge], "queue-monitor infers the stack");
  const stacked = await landPr(x.landDeps);
  assert.equal(stacked.ok ? "ok" : stacked.refusal.code, "stack_order");

  x.github("main", "DISMISSED");
  await runMonitor("pr", x.monitor);
  await runMonitor("queue", x.monitor);
  assert.deepEqual(
    x.store.events({ type: "edge_removed" }).map((e) => [e.payload.pred, e.payload.succ, e.payload.kind]),
    [[edge.pred, edge.succ, edge.kind]],
    "the base change removes the stack edge",
  );
  await runMonitor("queue", x.monitor);
  assert.equal(x.store.events({ type: "edge_added" }).filter((e) => e.payload.kind === "stacked_on").length, 1, "a later round does not infer it again");

  const held = await landPr(x.landDeps);
  assert.equal(held.ok ? "ok" : held.refusal.code, "rereview_needed", "the stack no longer holds it; the re-review does");
  assert.deepEqual(graphRead.why(await x.view(), ITEM).map((e) => e.kind), ["blocks"]);

  assert.ok((await x.record()).inserted);
  const landed = await landPr(x.landDeps);
  assert.ok(landed.ok, JSON.stringify(landed));
  assert.equal(x.merges.length, 1);
});

test("S6 NOW-1: a PR closed, then reopened and retargeted, is open again: re-review item, why row and unstack follow", async () => {
  const x = retargetWorld([], { below: true });
  const edge = { pred: `pr:${BELOW}`, succ: `item:${ITEM}`, kind: "stacked_on" };
  await runMonitor("queue", x.monitor);
  assert.deepEqual(x.store.events({ type: "edge_added" }).map((e) => e.payload), [edge]);

  // Deleting feature-a by push closes #12 instead of retargeting it.
  x.github("feature-a", "APPROVED", { closed: true });
  await runMonitor("pr", x.monitor);
  assert.equal(x.store.events({ type: "pr_closed" }).length, 1);

  // The branch pushed back, #12 reopened, then retargeted to main.
  x.github("main", "DISMISSED");
  await runMonitor("pr", x.monitor);
  assert.deepEqual(x.store.events({ type: "pr_reopened" }).map((e) => e.payload), [{ pr: PR }]);
  assert.deepEqual(x.store.events({ type: "pr_base_changed" }).map((e) => e.payload), [{ pr: PR, from: "feature-a", to: "main" }]);

  await runMonitor("queue", x.monitor);
  assert.deepEqual(
    x.store.events({ type: "edge_removed" }).map((e) => [e.payload.pred, e.payload.succ]),
    [[edge.pred, edge.succ]],
    "unstack reads the reopened PR as open",
  );
  const items = x.store.events({ type: "item_created" }).filter((e) => e.payload.task !== ITEM);
  assert.equal(items.length, 1, "the re-review item is made for the reopened PR");
  assert.deepEqual(graphRead.why(await x.view(), ITEM).map((e) => [e.pred, e.kind]), [[String(items[0]?.payload.task), "blocks"]]);

  // Closed and reopened once more: each turn is its own row.
  x.github("main", "DISMISSED", { closed: true });
  await runMonitor("pr", x.monitor);
  assert.equal(x.store.events({ type: "pr_closed" }).length, 2);
  assert.deepEqual(graphRead.why(await x.view(), ITEM), [], "closed again: no row waits on it");
  x.github("main", "DISMISSED");
  await runMonitor("pr", x.monitor);
  assert.equal(x.store.events({ type: "pr_reopened" }).length, 2);
  assert.equal(graphRead.why(await x.view(), ITEM).length, 1);
});

test("S6 NOW-2: once the PR below merged with its branch kept, land refuses the PR still based on that branch and names the retarget", async () => {
  const x = retargetWorld([], { below: true });
  await runMonitor("queue", x.monitor);
  // land merged #11 with gh pr merge --squash and kept feature-a; GitHub leaves #12 on it.
  x.store.append({ type: "pr_merged", source: "pr-monitor", payload: { pr: BELOW, merge_sha: "c".repeat(40) } });
  x.github("feature-a", "APPROVED", { belowGone: true });

  const dead = await landPr(x.landDeps);
  assert.equal(dead.ok ? "ok" : dead.refusal.code, "base_merged", "an approved PR would merge into the merged PR's branch");
  assert.match(dead.ok ? "" : dead.refusal.fix, /gh pr edit 12 --repo acme\/api --base main/);
  assert.deepEqual(x.merges, []);
  const dry = await land({ repo: REPO, pr: 12, dryRun: true }, x.landDeps);
  assert.equal(dry.ok ? "ok" : dry.refusal.code, "base_merged", "the dry run says the same");

  // Retargeted as the fix says; until pr-monitor records the change, land does not judge the old review.
  x.github("main", "DISMISSED", { belowGone: true });
  const unseen = await landPr(x.landDeps);
  assert.equal(unseen.ok ? "ok" : unseen.refusal.code, "base_unrecorded");
  await runMonitor("pr", x.monitor);
  const held = await landPr(x.landDeps);
  assert.equal(held.ok ? "ok" : held.refusal.code, "rereview_needed", "the retarget takes the G31 path");
  assert.deepEqual(x.merges, []);
});

test("S6 NOW-2: a merged PR's branch that a new open PR reuses is not dead", async () => {
  const x = retargetWorld([], { below: true });
  await runMonitor("queue", x.monitor);
  x.store.append({ type: "pr_merged", source: "pr-monitor", payload: { pr: BELOW, merge_sha: "c".repeat(40) } });
  x.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#13", base: "main", head_sha: "d".repeat(40), head: "feature-a" } });
  x.github("feature-a", "APPROVED", { belowGone: true });
  const r = await landPr(x.landDeps);
  assert.notEqual(r.ok ? "ok" : r.refusal.code, "base_merged");
});
