import assert from "node:assert/strict";
import { test } from "node:test";
import {
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

function retargetWorld() {
  const w = createWorld([{ id: ITEM, run: RUN, status: "completed", title: "api retry" }], { currentRun: RUN });
  const { store, orca } = w;
  const pull = (base: string) => ({ number: 12, merged_at: null, state: "open", mergeable_state: "clean", user: { login: "alice" }, head: { sha: HEAD, ref: "feature-b", repo: { full_name: REPO } }, base: { ref: base }, labels: [] });
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
  /** GitHub's side of the PR: its base and its one review, which a retarget dismisses. */
  const github = (base: string, review: string) => {
    routes[`repos/${REPO}/pulls?state=open&per_page=100`] = ok([pull(base)]);
    routes[`repos/${REPO}/pulls/12`] = ok(pull(base));
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
  store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: PR, task: ITEM, base: "feature-a", head_sha: HEAD } });
  store.append({ type: "verify_tier_set", source: "pr-monitor", payload: { pr: PR, head_sha: HEAD, computed: "V2", effective: "V2", actor: "pr-monitor", accepted: true, reason: "x" } });
  store.append({ type: "review_verdict", source: "review record", actor: "codex", dedupe_key: dedupeKey(EVENTS.review_verdict, PR, HEAD, "codex", "0"), payload: { pr: PR, head_sha: HEAD, act_on: 0, reviewer: "codex", author: "alice" } });
  for (const kind of ["test", "run"]) {
    store.append({ type: "evidence", source: "test", subject: PR, actor: "worker:u11", payload: { kind, head_sha: HEAD, exit_code: 0, not_verified: ["prod"] } });
  }
  store.append({ type: "land_requested", source: "land", payload: { pr: PR, head_sha: HEAD, reason: "merge_on_approval" } });
  const view = async (): Promise<ViewInput> => {
    const listed = await orca.taskList({ run: RUN });
    const tasks = listed.ok ? listed.value.map((t) => ({ id: t.id, runId: RUN, status: t.status, deps: [] as string[] })) : [];
    return { events: store.events(), orca: { tasks, gates: [] }, now: new Date(NOW).toISOString() };
  };
  // review record reads the PR's author, head and base from GitHub through gh api.
  const reviewExec = async (_cmd: string, args: readonly string[]) => {
    const jq = String(args.at(-1));
    const base = (routes[`repos/${REPO}/pulls/12`] as { data: { base: { ref: string } } }).data.base.ref;
    return { code: 0, stdout: jq.includes(".base.ref") ? `alice\t${HEAD}\t${base}\n` : `alice\t${HEAD}\n`, stderr: "" };
  };
  return { w, store, github, monitor, landDeps, merges, view, reviewExec };
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

  // A reviewer approves again on GitHub at the same head: still no merge-ready report.
  x.github("main", "APPROVED");
  await runMonitor("pr", x.monitor);
  assert.deepEqual(x.store.events({ type: "pr_ready_to_merge" }), []);

  const recorded = await recordReviewVerdict({ repo: REPO, pr: 12, head: HEAD, actOn: 0, reviewer: "codex" }, {
    exec: x.reviewExec,
    // The shared in-memory store stays open after review record closes its handle.
    openStore: () => ({ append: (e: never) => x.store.append(e), close: () => {} }) as never,
  });
  assert.ok(recorded.inserted, recorded.note);

  assert.deepEqual(graphRead.why(await x.view(), ITEM), [], "the review clears the row");
  await runMonitor("pr", x.monitor);
  assert.equal(x.store.events({ type: "pr_ready_to_merge" }).length, 1);
  const landed = await landPr(x.landDeps);
  assert.ok(landed.ok, JSON.stringify(landed));
  assert.equal(x.merges.length, 1);
});
