import assert from "node:assert/strict";
import { test } from "node:test";
import type { OrcaAdapter, TaskRow } from "../../contract/orca.ts";
import type { GhClient, GhResponse, RateBudget } from "../../gh/client.ts";
import { Store } from "../../store/store.ts";
import type { TierConfig } from "../../verify/verify-tier.ts";
import { nullChatProvider } from "../chat/provider.ts";
import { DEFAULT_MONITOR_CONFIG, type MonitorDeps } from "../monitor.ts";
import { runMonitor } from "../run.ts";
import type { WatchConfig } from "./config.ts";

const REPO = "acme/api";
const NOW = Date.parse("2026-11-10T12:00:00Z");
const SHA = "1".repeat(40);
const SHA2 = "2".repeat(40);
const HEAD = "a".repeat(40);
const TIER: TierConfig = { docs_globs: ["docs/"], test_globs: ["test/"], ui_globs: ["web/"], v3_globs: [".github/"], protected_paths: [], owners: ["owner1"] };
const ok = (data: unknown): GhResponse<unknown> => ({ kind: "ok", status: 200, data });
const OPEN = `repos/${REPO}/pulls?state=open&per_page=100`;
const CLOSED = `repos/${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=30`;
const url = (n: number) => `https://github.com/${REPO}/pull/${n}`;

const listed = (n: number, o: Record<string, unknown> = {}) => ({
  number: n,
  merged_at: null,
  user: { login: "alice" },
  head: { sha: HEAD, ref: `feature-${n}`, repo: { full_name: REPO } },
  base: { ref: "main" },
  labels: [],
  ...o,
});

type Task = TaskRow & { run: string };

function world(o: { watch?: Partial<WatchConfig>; budget?: RateBudget } = {}) {
  const store = Store.open({ path: ":memory:" });
  const routes: Record<string, GhResponse<unknown>> = { [OPEN]: ok([]), [CLOSED]: ok([]) };
  const refs: Record<string, unknown[]> = {};
  const dispatches: Record<string, { taskId: string; runId: string; liveness?: string }> = {};
  const messages: { to: string; subject: string; body: string }[] = [];
  const tasks = new Map<string, Task>();
  const worktrees: { id: string; projectId?: string; branch: string; isArchived: boolean; displayName: string }[] = [];
  const calls: string[] = [];
  const workerRows: { dispatchId: string; taskId: string; state: string; workspace: string }[] = [];
  const gh: GhClient = { get: async <T>(path: string) => (routes[path] ?? { kind: "error", status: 404, message: "Not Found" }) as GhResponse<T> };
  const orca = {
    referenceFind: async ({ query }: { query: string }) => ({ ok: true, value: { matches: refs[query] ?? [] } }),
    workerShow: async ({ dispatch }: { dispatch: string }) => {
      const s = dispatches[dispatch];
      return s ? { ok: true, value: { dispatchId: dispatch, state: "done", ...s } } : { ok: false, error: { code: "not_found", message: "" } };
    },
    taskList: async ({ run }: { run: string }) => ({ ok: true, value: [...tasks.values()].filter((t) => t.run === run) }),
    taskUpdate: async (a: { id: string; status: string; run?: string }) => {
      calls.push(`task-update ${a.id} ${a.status} run=${a.run}`);
      const t = tasks.get(a.id);
      if (t) t.status = a.status;
      return { ok: true, value: {} };
    },
    workerList: async () => ({ ok: true, value: { rows: workerRows, nonLocal: { rows: 0, hostIds: [] }, omittedHostIds: [], truncated: false } }),
    worktreeList: async () =>({ ok: true, value: { rows: worktrees, nonLocal: { rows: 0, hostIds: [] }, omittedHostIds: [], truncated: false } }),
    referenceAdd: async (a: { worktree: string; urls: string[] }) => {
      calls.push(`reference add ${a.urls.join(" ")} ${a.worktree}`);
      return { ok: true, value: {} };
    },
    send: async (m: { to: string; subject: string; body: string; type?: string }) => {
      // Orca's closed `send --type` set (`orchestration send --help`).
      if (!["status", "dispatch", "worker_done", "merge_ready", "escalation", "handoff", "decision_gate", "question", "heartbeat"].includes(m.type ?? "")) {
        return { ok: false, error: { code: "invalid_argument", message: `--type ${m.type}` } };
      }
      calls.push(`send ${m.to} ${m.subject}`);
      messages.push({ to: m.to, subject: m.subject, body: m.body });
      return { ok: true, value: { message: { id: `msg_${calls.length}` } } };
    },
  } as unknown as OrcaAdapter;
  const watch: WatchConfig = { repos: [REPO], authors: [], linkedOnly: true, owners: ["owner1"], ...o.watch };
  const deps: MonitorDeps = {
    orca,
    exec: async () => ({ code: 1, stdout: "", stderr: "" }),
    events: (f) => store.events(f),
    append: (e) => store.append(e),
    now: () => NOW,
    config: DEFAULT_MONITOR_CONFIG,
    chat: nullChatProvider,
    sample: () => ({}),
    gh,
    ghBudget: () => o.budget,
    watch: () => watch,
    tier: () => TIER,
    core: { store, orca },
  };
  /**
   * A Task Orca links to PR n through a local workspace whose agent is the Task's Dispatch. A
   * released worker leaves the workspace with no agent; worker-list still names its Dispatch.
   */
  const link = (n: number, task: string, status: string, run = "run_lead", released = false, liveness?: string) => {
    const dispatch = `ctx_${task}`;
    dispatches[dispatch] = { taskId: task, runId: run, ...(liveness ? { liveness } : {}) };
    tasks.set(task, { id: task, status, title: "t", run });
    workerRows.push({ dispatchId: dispatch, taskId: task, state: "succeeded", workspace: `ws_${task}` });
    const agents = released ? [] : [{ mailbox: `dispatch:${dispatch}`, linked: true }];
    const match = { workspace: { id: `ws_${task}`, hostId: "local", archived: false }, agents };
    refs[url(n)] = [...(refs[url(n)] ?? []), match];
  };
  /** GitHub's merge as decision 84 ① reads it: merged, and the merge commit on main. */
  const merged = (n: number, sha: string, by = "alice", onMain = true) => {
    routes[`repos/${REPO}/pulls/${n}`] = ok({ ...listed(n), state: "closed", merged: true, merge_commit_sha: sha, merged_by: { login: by } });
    routes[`repos/${REPO}`] = ok({ default_branch: "main" });
    routes[`repos/${REPO}/compare/main...${sha}`] = ok({ status: onMain ? "behind" : "diverged" });
  };
  const round = (d: Partial<MonitorDeps> = {}, without: (keyof MonitorDeps)[] = []) => {
    const used: Partial<MonitorDeps> = { ...deps, ...d };
    for (const k of without) delete used[k];
    return runMonitor("pr", used as MonitorDeps);
  };
  const rows = (type?: string) => store.events(type ? { type } : {}).filter((e) => e.source === "pr-monitor" || e.type === "notified");
  return { store, routes, tasks, worktrees, calls, messages, link, merged, round, rows, deps };
}

test("merge_suggests_close (§9 X4): merge confirmed → pr_merged, the PR item's Task completed in the same round, other open Tasks only suggested", async () => {
  const w = world();
  w.link(7, "task_item", "blocked");
  w.link(7, "task_other", "dispatched");
  w.link(7, "task_done", "completed");
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#7", task: "task_item" } });
  w.routes[CLOSED] = ok([listed(7, { merged_at: "2026-11-10T11:00:00Z" })]);
  w.merged(7, SHA);

  const r = await w.round();
  assert.deepEqual(r.acts.map((a) => [a.ok, a.detail]), [[true, "blocked → done"]]);
  assert.deepEqual(w.calls, ["task-update task_item completed run=run_lead"]);
  assert.equal(w.tasks.get("task_item")?.status, "completed");
  const types = r.written.map((x) => x.type);
  assert.deepEqual(types, ["pr_merged", "close_suggested", "item_transition"], "pr_merged first, the transition after the task-update");
  assert.equal(w.rows("close_suggested")[0]?.payload.task, "task_other", "a Task Orca already closed gets no suggestion");

  const again = await w.round();
  assert.deepEqual(again.written, [], "the next round writes nothing");
  assert.equal(w.calls.length, 1, "and closes nothing twice");
});

test("done_blockers refuse the close: a second PR of the same item still open keeps its Task open (decision 212 ④)", async () => {
  const w = world();
  w.link(7, "task_item", "blocked");
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#7", task: "task_item" } });
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#9", task: "task_item" } });
  w.routes[CLOSED] = ok([listed(7, { merged_at: "2026-11-10T11:00:00Z" })]);
  w.merged(7, SHA);
  const r = await w.round();
  assert.deepEqual(r.acts.map((a) => [a.ok, a.detail]), [[false, "done_blockers: open_pr: acme/api#9"]]);
  assert.deepEqual(w.calls, [], "no task-update");
  assert.equal(w.tasks.get("task_item")?.status, "blocked");
  assert.ok(!r.written.some((x) => x.type === "item_transition"));
});

test("a Task Orca reports cancelled is left as it is when its PR merges", async () => {
  const w = world();
  w.link(7, "task_item", "cancelled" as never);
  w.routes[CLOSED] = ok([listed(7, { merged_at: "2026-11-10T11:00:00Z" })]);
  w.merged(7, SHA);
  const r = await w.round();
  assert.deepEqual(r.acts.map((a) => [a.ok, a.detail]), [[true, "already cancelled"]]);
  assert.deepEqual(w.calls, []);
});

test("a released worker's Task is still found: the workspace's Dispatch comes from worker-list, and an owner's merge of it is linked", async () => {
  const w = world();
  w.link(7, "task_item", "blocked", "run_lead", true);
  w.routes[CLOSED] = ok([listed(7, { merged_at: "2026-11-10T11:00:00Z" })]);
  w.merged(7, SHA, "owner1");
  const r = await w.round();
  assert.deepEqual(r.written.map((x) => x.type), ["pr_opened", "pr_merged", "item_transition"]);
  assert.equal(w.rows("pr_opened")[0]?.payload.task, "task_item");
  assert.deepEqual(w.calls, ["task-update task_item completed run=run_lead"]);
});

test("no close without merge_confirm: GitHub's merge alone, the commit not on main, is no pr_merged and no Task write", async () => {
  const w = world();
  w.link(7, "task_item", "blocked");
  w.routes[CLOSED] = ok([listed(7, { merged_at: "2026-11-10T11:00:00Z" })]);
  w.merged(7, SHA, "alice", false);
  const r = await w.round();
  assert.deepEqual(r.planned.map((e) => e.type), ["pr_opened"]);
  assert.deepEqual(w.calls, []);
  assert.ok(r.unseen.some((u) => u.includes("is not on main")));
});

test("a dry run plans pr_merged and the close but writes neither events nor Orca", async () => {
  const w = world();
  w.link(7, "task_item", "blocked");
  w.routes[CLOSED] = ok([listed(7, { merged_at: "2026-11-10T11:00:00Z" })]);
  w.merged(7, SHA);
  const r = await w.round({}, ["append", "core"]);
  assert.deepEqual(r.planned.map((e) => e.type), ["pr_opened", "pr_merged"]);
  assert.deepEqual(r.acts, [{ what: "task-update task_item completed (acme/api#7 merged)", ok: null, detail: "not run" }]);
  assert.deepEqual(w.calls, []);
  assert.equal(w.store.events().length, 0);
});

test("owner_direct_merge and owner_act_unlinked_expires (GitHub side): one pr_merged by the owner, one unlinked row, never again", async () => {
  const w = world({ watch: { linkedOnly: false } });
  w.routes[CLOSED] = ok([listed(8, { merged_at: "2026-11-10T11:00:00Z" })]);
  w.merged(8, SHA, "Owner1");
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#8" } });
  const r = await w.round();
  assert.deepEqual(r.written.map((x) => x.type), ["pr_merged", "owner_act_unlinked"]);
  const merged = w.rows("pr_merged")[0];
  assert.equal(merged?.actor, "owner:owner1", "the observed merge carries who did it, for decision_answered{linked_by: observed}");
  assert.equal(w.rows("owner_act_unlinked")[0]?.dedupe_key, "owner_act_unlinked:acme%2Fapi%238:merged", "a PR-based key, apart from the hook's owner_act:<uuid>");
  assert.deepEqual((await w.round()).written, [], "one row per merge; the view expires it after show_hours");
});

test("a merge through land is not the owner's own act, even when the owner pressed the button", async () => {
  const w = world({ watch: { linkedOnly: false } });
  w.routes[CLOSED] = ok([listed(9, { merged_at: "2026-11-10T11:00:00Z" })]);
  w.merged(9, SHA, "owner1");
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#9" } });
  w.store.append({ type: "land_requested", source: "land", payload: { pr: "acme/api#9", head_sha: HEAD } });
  const r = await w.round();
  assert.deepEqual(r.written.map((x) => x.type), ["pr_merged"]);
  assert.equal(w.rows("pr_merged")[0]?.actor, "owner1");
});

test("retarget_approval (pr_base_changed side): a new base is one row against the base pr_opened recorded", async () => {
  const w = world();
  w.link(10, "task_a", "dispatched");
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#10", task: "task_a", base: "feature-a", head_sha: HEAD } });
  w.store.append({ type: "verify_tier_set", source: "pr-monitor", payload: { pr: "acme/api#10", head_sha: HEAD, computed: "V1", effective: "V1", actor: "pr-monitor", accepted: true, reason: "x" } });
  w.routes[OPEN] = ok([listed(10)]);
  const r = await w.round();
  assert.deepEqual(r.written.map((x) => x.type), ["pr_base_changed"]);
  assert.deepEqual(w.rows("pr_base_changed")[0]?.payload, { pr: "acme/api#10", from: "feature-a", to: "main" });
  assert.deepEqual((await w.round()).written, []);
});

test("pr_opened records the head branch only when the head lives in the PR's own repository (decision 212 ③)", async () => {
  const w = world();
  w.link(11, "task_a", "dispatched");
  w.link(12, "task_b", "dispatched");
  w.routes[OPEN] = ok([listed(11), listed(12, { head: { sha: HEAD, ref: "feature-12", repo: { full_name: "someone/api" } } })]);
  await w.round({ tier: () => null });
  const heads = w.rows("pr_opened").map((e) => [e.payload.pr, e.payload.head ?? null]);
  assert.deepEqual(heads, [["acme/api#11", "feature-11"], ["acme/api#12", null]]);
});

function mainRuns(w: ReturnType<typeof world>, sha: string, runs: Record<string, unknown>[], jobs = 3) {
  w.routes[`repos/${REPO}/actions/runs?head_sha=${sha}&event=push&per_page=100`] = ok({ workflow_runs: runs });
  for (const r of runs) w.routes[`repos/${REPO}/actions/runs/${r.id}/jobs?per_page=1`] = ok({ total_count: jobs });
}
const merge = (w: ReturnType<typeof world>, pr: number, sha: string) =>
  w.store.append({ type: "pr_merged", source: "pr-monitor", payload: { pr: `acme/api#${pr}`, merge_sha: sha } });
const runAt = (id: number, conclusion: string, attempt = 1) => ({ id, run_attempt: attempt, status: "completed", conclusion, updated_at: "2026-11-10T11:55:00Z" });

test("repo_level_main (main_* side): red after a failed rerun, then any later merge's green clears the repository", async () => {
  const w = world();
  merge(w, 1, SHA);
  mainRuns(w, SHA, [runAt(41, "failure")]);
  const first = await w.round();
  assert.deepEqual(first.written.map((x) => x.type), ["ci_failed"], "a first-attempt failure asks for the one rerun, not red");
  mainRuns(w, SHA, [runAt(41, "failure", 2)]);
  assert.deepEqual((await w.round()).written.map((x) => x.type), ["main_red"]);
  merge(w, 2, SHA2);
  mainRuns(w, SHA2, [runAt(42, "success")]);
  assert.deepEqual((await w.round()).written.map((x) => x.type), ["main_green"]);
  const last = w.store.events().filter((e) => (e.type === "main_red" || e.type === "main_green") && e.payload.repo === REPO).at(-1);
  assert.equal(last?.type, "main_green", "one main state per repo: land reads the latest");
  assert.deepEqual((await w.round()).written, [], "a settled sha is not read again");
});

test("watch.repos keeps its case for every GitHub call; rows and keys stay lowercase", async () => {
  // A fine-grained token answers 404 for a private repo named in another case.
  const given = "Acme/API";
  const w = world({ watch: { repos: [given] } });
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#7", task: "task_item" } });
  w.routes[CLOSED] = ok([listed(7, { merged_at: "2026-11-10T11:00:00Z" })]);
  w.merged(7, SHA);
  mainRuns(w, SHA, [runAt(41, "success")]);
  const paths: string[] = [];
  const cased = Object.fromEntries(Object.entries(w.routes).map(([k, v]) => [k.replace(`repos/${REPO}`, `repos/${given}`), v]));
  const gh: GhClient = {
    get: async <T>(path: string) => {
      paths.push(path);
      return (cased[path] ?? { kind: "error", status: 404, message: "Not Found" }) as GhResponse<T>;
    },
  };

  assert.deepEqual((await w.round({ gh })).written.map((x) => x.type), ["pr_merged"]);
  assert.equal(w.rows("pr_merged")[0]?.payload.pr, "acme/api#7");
  assert.deepEqual((await w.round({ gh })).written.map((x) => x.type), ["main_green"], "main CI reads the merge the round before wrote");
  assert.deepEqual(w.rows("main_green")[0]?.payload, { repo: "acme/api", sha: SHA, run_id: "41" }, "land compares main state lowercase");
  assert.ok(paths.length > 0 && paths.every((p) => p.startsWith(`repos/${given}`)), paths.join("\n"));
});

test("main CI judges only the repository's newest merge: an older sha's red never lands after a newer green", async () => {
  const w = world({ watch: { linkedOnly: false } });
  w.routes[CLOSED] = ok([listed(2, { merged_at: "2026-11-10T11:30:00Z" }), listed(1, { merged_at: "2026-11-10T09:00:00Z" })]);
  w.merged(1, SHA);
  w.merged(2, SHA2);
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#1" } });
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#2" } });
  mainRuns(w, SHA, [runAt(51, "failure", 2)]);
  mainRuns(w, SHA2, [runAt(52, "success")]);
  const first = await w.round();
  assert.deepEqual(w.rows("pr_merged").map((e) => e.payload.pr), ["acme/api#1", "acme/api#2"], "written in merge order");
  assert.deepEqual(first.written.filter((x) => x.type.startsWith("main_")), []);
  assert.deepEqual((await w.round()).written.map((x) => x.type), ["main_green"]);
  assert.deepEqual(w.rows("main_red"), []);
});

test("main CI's newest merge is GitHub's merge time: an older merge first seen in a later round does not override", async () => {
  const w = world();
  w.store.append({ type: "pr_merged", source: "pr-monitor", payload: { pr: "acme/api#2", merge_sha: SHA2, merged_at: "2026-11-10T10:05:00Z" } });
  mainRuns(w, SHA2, [runAt(62, "success")]);
  assert.deepEqual((await w.round()).written.map((x) => x.type), ["main_green"]);
  w.store.append({ type: "pr_merged", source: "pr-monitor", payload: { pr: "acme/api#1", merge_sha: SHA, merged_at: "2026-11-10T10:00:00Z" } });
  mainRuns(w, SHA, [runAt(61, "failure", 2)]);
  assert.deepEqual((await w.round()).written, [], "#1 merged before #2: main's state stays #2's green");
});

test("main CI: a red sha is read again, and a rerun that passes after the grace turns the repository green", async () => {
  const w = world();
  merge(w, 1, SHA);
  mainRuns(w, SHA, [runAt(71, "failure", 2)]);
  assert.deepEqual((await w.round()).written.map((x) => x.type), ["main_red"]);
  assert.deepEqual((await w.round()).written, [], "the same red is not written twice");
  mainRuns(w, SHA, [runAt(71, "success", 3)]);
  assert.deepEqual((await w.round()).written.map((x) => x.type), ["main_green"]);
});

test("main CI: a cancelled run is not red and a 0-job failure (GitHub outage) is unknown", async () => {
  const w = world();
  merge(w, 1, SHA);
  mainRuns(w, SHA, [runAt(43, "cancelled")]);
  assert.deepEqual((await w.round()).written, []);
  mainRuns(w, SHA, [runAt(44, "failure", 2)], 0);
  const r = await w.round();
  assert.deepEqual(r.written, []);
  assert.ok(r.unseen.some((u) => u.includes("0 jobs")));
});

test("verify_tier_set on a label and on a new push, the label's actor from the issue events", async () => {
  const w = world();
  w.link(11, "task_b", "dispatched");
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#11", task: "task_b", base: "main", head_sha: HEAD } });
  w.routes[OPEN] = ok([listed(11, { labels: [{ name: "verify-tier:1" }] })]);
  w.routes[`repos/${REPO}/pulls/11/files?per_page=100&page=1`] = ok([{ filename: "core/a.ts", patch: "@@ -1 +1 @@\n-a\n+b" }]);
  w.routes[`repos/${REPO}/issues/11/events?per_page=100&page=1`] = ok([{ event: "labeled", label: { name: "verify-tier:1" }, actor: { login: "alice" } }]);
  const r = await w.round();
  assert.deepEqual(r.written.map((x) => x.type), ["verify_tier_set"]);
  const row = w.rows("verify_tier_set")[0]?.payload;
  assert.equal(row?.computed, "V2");
  assert.equal(row?.requested, "V1");
  assert.equal(row?.actor, "alice");
  assert.equal(row?.accepted, false, "lowering needs an owner");
  assert.deepEqual((await w.round()).written, [], "same head, same label: nothing");
  w.routes[OPEN] = ok([listed(11, { labels: [{ name: "verify-tier:1" }], head: { sha: "b".repeat(40), ref: "feature-11" } })]);
  w.routes[`repos/${REPO}/pulls/11/files?per_page=100&page=1`] = ok([{ filename: "docs/a.md", patch: "@@ -1 +1 @@\n-a\n+b" }]);
  assert.deepEqual((await w.round()).written.map((x) => x.type), ["verify_tier_set"], "a new push is a new row");
});

test("pr_ready_to_merge: a merge_on_approval PR approved and green wakes its owning lead once", async () => {
  const w = world();
  w.link(12, "task_c", "blocked", "run_lead_c");
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#12", task: "task_c", base: "main", head_sha: HEAD } });
  w.store.append({ type: "verify_tier_set", source: "pr-monitor", payload: { pr: "acme/api#12", head_sha: HEAD, computed: "V1", effective: "V1", actor: "pr-monitor", accepted: true, reason: "x" } });
  w.store.append({ type: "land_requested", source: "land", payload: { pr: "acme/api#12", head_sha: HEAD, reason: "merge_on_approval" } });
  w.routes[OPEN] = ok([listed(12)]);
  w.routes[`repos/${REPO}/pulls/12`] = ok({ ...listed(12), state: "open", mergeable_state: "clean" });
  w.routes[`repos/${REPO}/pulls/12/reviews?per_page=100&page=1`] = ok([{ user: { login: "bob" }, state: "APPROVED", commit_id: HEAD, author_association: "MEMBER" }]);
  w.routes[`repos/${REPO}/commits/${HEAD}/check-runs?per_page=100`] = ok({ total_count: 1, check_runs: [{ status: "completed", conclusion: "success" }] });
  const r = await w.round();
  assert.deepEqual(r.written.map((x) => x.type), ["pr_ready_to_merge"]);
  assert.equal(w.rows("notified")[0]?.payload.to, "run:run_lead_c", "notify records its own row");
  assert.deepEqual(r.acts.map((a) => [a.ok, a.detail]), [[true, "sent"]]);
  assert.deepEqual(w.calls, ["send run:run_lead_c 🟢 머지 가능: acme/api#12"]);
  await w.round();
  assert.equal(w.calls.length, 1, "one wake per head");
});

/** PR 30 with one changes-requested review (2001), one review comment (3001) and the author's reply (3002). */
function reviewed(w: ReturnType<typeof world>) {
  w.routes[OPEN] = ok([listed(30)]);
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#30", task: "task_r", base: "main", head_sha: HEAD } });
  w.routes[`repos/${REPO}/pulls/30/reviews?per_page=100`] = ok([
    { id: 2001, state: "CHANGES_REQUESTED", user: { login: "bob" }, submitted_at: "2026-11-10T09:00:00Z", body: "secret review text" },
    { id: 2002, state: "APPROVED", user: { login: "carol" }, submitted_at: "2026-11-10T09:30:00Z" },
  ]);
  w.routes[`repos/${REPO}/pulls/30/comments?sort=created&direction=desc&per_page=100`] = ok([
    { id: 3002, user: { login: "alice" }, in_reply_to_id: 3001, created_at: "2026-11-10T11:00:00Z", body: "reply text" },
    { id: 3001, user: { login: "bob" }, in_reply_to_id: null, created_at: "2026-11-10T10:00:00Z", body: "secret comment text" },
  ]);
}

test("decision 201: a review that asks for action wakes the PR's live Dispatch once per GitHub id, ids only", async () => {
  const w = world();
  w.link(30, "task_r", "dispatched", "run_lead_r", false, "live");
  reviewed(w);
  const r = await w.round();
  assert.deepEqual(
    w.rows().filter((e) => ["pr_changes_requested", "review_commented", "review_replied"].includes(e.type)).map((e) => [e.type, e.payload.at]),
    [
      ["pr_changes_requested", "2026-11-10T09:00:00Z"],
      ["review_replied", "2026-11-10T11:00:00Z"],
      ["review_commented", "2026-11-10T10:00:00Z"],
    ],
    "GitHub's time rides on the row",
  );
  assert.deepEqual(w.messages, [
    {
      to: "dispatch:ctx_task_r",
      subject: "🔁 리뷰: acme/api#30",
      body: "acme/api#30 에 대응할 리뷰가 왔다: 변경 요청(review id) 2001 · 리뷰 코멘트(review comment id) 3001. GitHub 에서 읽고 대응한다.",
    },
  ]);
  assert.ok(r.acts.every((a) => a.ok), JSON.stringify(r.acts));

  await w.round();
  assert.equal(w.messages.length, 1, "the next round sends nothing again");

  // A new comment wakes once more, naming only the new id.
  w.routes[`repos/${REPO}/pulls/30/comments?sort=created&direction=desc&per_page=100`] = ok([
    { id: 3005, user: { login: "carol" }, in_reply_to_id: null, created_at: "2026-11-10T11:30:00Z" },
  ]);
  await w.round();
  await w.round();
  assert.deepEqual(w.messages.slice(1).map((m) => m.body), ["acme/api#30 에 대응할 리뷰가 왔다: 리뷰 코멘트(review comment id) 3005. GitHub 에서 읽고 대응한다."]);
});

test("decision 201: with no live Dispatch the review wake goes to the lead's Run", async () => {
  const w = world();
  w.link(30, "task_r", "dispatched", "run_lead_r", true, "exited");
  reviewed(w);
  await w.round();
  assert.deepEqual(w.messages.map((m) => m.to), ["run:run_lead_r"]);
});

test("decision 201: a review wake that could not go out (link unread) goes out on the next round, once", async () => {
  const w = world({ watch: { linkedOnly: false } });
  w.link(30, "task_r", "dispatched", "run_lead_r", false, "live");
  reviewed(w);
  const blind = await w.round({ orca: { ...w.deps.orca, referenceFind: async () => ({ ok: false, error: { code: "x", message: "" } }) } as typeof w.deps.orca });
  assert.deepEqual(w.messages, []);
  assert.ok(blind.unseen.includes("review wake of acme/api#30: no linked Task"), blind.unseen.join("; "));
  await w.round();
  assert.equal(w.messages.length, 1);
  await w.round();
  assert.equal(w.messages.length, 1);
});

test("scope: watch.authors and linked_only; a branch workspace Orca has not linked gets reference add", async () => {
  const w = world({ watch: { authors: ["alice"] } });
  w.routes[OPEN] = ok([listed(20, { user: { login: "mallory" } }), listed(21), listed(22)]);
  w.worktrees.push(
    { id: "repo1::/w/22", projectId: `github:${REPO}`, branch: "refs/heads/feature-22", isArchived: false, displayName: "card 22" },
    { id: "repo2::/w/22", projectId: "github:acme/web", branch: "refs/heads/feature-22", isArchived: false, displayName: "web 22" },
  );
  const r = await w.round({ tier: () => null });
  assert.deepEqual(r.planned.filter((e) => e.type === "pr_opened").map((e) => e.payload.pr), ["acme/api#22"], "#20 another author, #21 linked nowhere");
  assert.deepEqual(w.calls, [`reference add ${url(22)} id:repo1::/w/22`], "full ref matches the short head ref; another repo's same branch does not");
});

test("a fork's head, a deleted fork, a head named like the base, or a row without a GitHub project matches no workspace", async () => {
  const w = world();
  w.routes[OPEN] = ok([
    listed(23, { head: { sha: HEAD, ref: "feature-23", repo: { full_name: "someone/api" } } }),
    listed(24, { head: { sha: HEAD, ref: "main", repo: { full_name: REPO } } }),
    listed(25, { head: { sha: HEAD, ref: "feature-25", repo: null } }),
    listed(26),
  ]);
  w.worktrees.push(
    { id: "repo1::/w/23", projectId: `github:${REPO}`, branch: "refs/heads/feature-23", isArchived: false, displayName: "x" },
    { id: "repo1::/w/main", projectId: `github:${REPO}`, branch: "refs/heads/main", isArchived: false, displayName: "main" },
    { id: "repo1::/w/25", projectId: `github:${REPO}`, branch: "refs/heads/feature-25", isArchived: false, displayName: "y" },
    { id: "repo3::/w/26", projectId: "repo:local-only", branch: "refs/heads/feature-26", isArchived: false, displayName: "z" },
  );
  const r = await w.round({ tier: () => null });
  assert.deepEqual(r.planned, []);
  assert.deepEqual(w.calls, []);
});

test("the first recorded Task stays the item Task when another workspace becomes the only link", async () => {
  const w = world();
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#7", task: "task_item" } });
  w.link(7, "task_bystander", "dispatched");
  w.routes[CLOSED] = ok([listed(7, { merged_at: "2026-11-10T11:00:00Z" })]);
  w.merged(7, SHA);
  const r = await w.round();
  assert.deepEqual(w.calls, ["task-update task_item completed run=undefined"], "only the item Task is closed");
  assert.deepEqual(r.written.map((x) => x.type), ["pr_merged", "close_suggested"]);
});

test("an owner's merge whose link could not be read is not called unlinked", async () => {
  const w = world({ watch: { linkedOnly: false } });
  w.routes[CLOSED] = ok([listed(8, { merged_at: "2026-11-10T11:00:00Z" })]);
  w.merged(8, SHA, "owner1");
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#8" } });
  const r = await w.round({ orca: { ...w.deps.orca, referenceFind: async () => ({ ok: false, error: { code: "x", message: "" } }) } as typeof w.deps.orca });
  assert.deepEqual(r.written.map((x) => x.type), ["pr_merged"]);
  assert.ok(r.unseen.includes("reference find acme/api#8"));
});

test("gh_budget and rate_limited: an essential budget reads only merges and main, a limit stops the round with one row", async () => {
  const low = world({ budget: { resource: "core", limit: 5000, remaining: 100, resetAt: 1 } });
  low.routes[OPEN] = { kind: "error", status: 500, message: "must not be read" };
  const r = await low.round();
  assert.ok(!r.unseen.some((u) => u.includes("state=open")), "open PRs are not read under 10% budget");

  const w = world();
  w.routes[OPEN] = { kind: "rate_limited", resource: "core", resetAt: NOW / 1000 + 600 };
  const limited = await w.round();
  assert.deepEqual(limited.written.map((x) => x.type), ["rate_limited"]);
  assert.equal(w.rows("rate_limited")[0]?.payload.reset_at, "2026-11-10T12:10:00Z");
  assert.deepEqual((await w.round()).written.filter((x) => x.inserted), [], "the same reset is one row");
});

test("no watch setting or no gh client: the round reads nothing", async () => {
  const w = world();
  assert.deepEqual((await w.round({ watch: () => null })).unseen, ["watch.repos setting"]);
  assert.deepEqual((await w.round({}, ["gh"])).unseen, ["gh client"]);
});
