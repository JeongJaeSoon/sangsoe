// Decision 306: a card sangsoe started stays sangsoe's after its repository is registered again in Orca
// under a new repo id. `unit_started.worktree` keeps the old `<repoId>::<path>`; the path still names
// the card, so the owner's list, the 정리 candidates and decision 207's fail-closed read find it.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { type ReapOptions, type ReapReport, type ResourceDeps, readResourcePart, Store, sangsoeWorktrees, type WorktreeRow } from "../../core/index.ts";
import { scratchDir } from "../scratch.ts";
import { card, dropScratch, makeRepo, rounds, worker, world } from "./harness.ts";

after(dropScratch);

const started = (store: Store, worktree: string) =>
  store.append({
    type: "unit_started",
    source: "start_unit",
    entity: "task",
    entity_id: `task_${worktree.replace(/\W/g, "")}`,
    payload: { kind: "default", picked_by: "role", model: "row", effort: "medium", route: "none", budget: 0, budget_per: "unit", used: 0, worktree },
  });

const row = (repoId: string, path: string, instanceId: string, o: Partial<WorktreeRow> = {}): WorktreeRow =>
  ({ id: `${repoId}::${path}`, instanceId, repoId, path, branch: `refs/heads/${instanceId}`, isMainWorktree: false, hostId: "local", ...o }) as WorktreeRow;

const listing = (cards: WorktreeRow[]) => ({
  worktreeList: async () => ({ ok: true as const, value: { rows: cards, nonLocal: { rows: 0, hostIds: [], ids: [] }, omittedHostIds: [], truncated: false } }),
});

function resourceDeps(store: Store, cards: WorktreeRow[], seen: { only?: ReadonlySet<string> }): ResourceDeps {
  return {
    orca: listing(cards) as unknown as ResourceDeps["orca"],
    exec: async (file, args) => {
      if (file === "du") return { code: 0, stdout: args.slice(1).map((p) => `8\t${p}`).join("\n"), stderr: "" };
      throw new Error(`unexpected ${file}`);
    },
    events: (f) => store.events(f),
    now: () => Date.parse("2026-11-16T12:00:00Z"),
    sample: () => ({}),
    plan: async (o: ReapOptions) => {
      if (o.only) seen.only = o.only;
      return {
        roots_ok: true,
        mark_only: false,
        unseen: [],
        judged: cards.map((c) => ({ ref: c.instanceId ?? c.id, name: c.instanceId ?? "", path: c.path, gone: true, state: "finished" as const, why: "PR #1" })),
      } as unknown as ReapReport;
    },
    tmpRoot: scratchDir("res306-tmp-"),
    uid: process.getuid?.() ?? 0,
    trashBin: null,
  };
}

test("(1) the owner's list keeps a card started under the old repo id once its repo is registered again", async () => {
  const store = Store.open({ path: ":memory:" });
  started(store, "repo-old::/w/task_a");
  assert.deepEqual([...((await sangsoeWorktrees((f) => store.events(f), listing([row("repo-new", "/w/task_a", "inst-a")]))) ?? [])], ["inst-a"]);
});

test("(2) the 정리 candidates offer that card: the plan's `only` holds it and the row comes back", async () => {
  const store = Store.open({ path: ":memory:" });
  started(store, "repo-old::/w/task_a");
  const seen: { only?: ReadonlySet<string> } = {};
  const p = await readResourcePart(resourceDeps(store, [row("repo-new", "/w/task_a", "inst-a")], seen), "candidates");
  assert.deepEqual([...(seen.only ?? [])], ["inst-a"]);
  assert.ok(p.part === "candidates" && p.worktrees.ok);
  assert.deepEqual(
    p.worktrees.value.rows.map((r) => r.ref),
    ["inst-a"],
  );
});

test("(3) decision 207: the re-registered card's repository is still sangsoe's, so an unreadable PR list fails the round closed", async () => {
  const w = world();
  const repo = makeRepo("rereg-one");
  w.orca.cards.push(card("rereg-one", repo, { id: `repo-new::${repo.path}`, repoId: "repo-new", projectId: "github:other/tools" }));
  started(w.store, `repo-old::${repo.path}`);
  const last = await rounds(w, 3, 30);
  assert.equal(last.roots_ok, false);
  assert.deepEqual(last.unseen, ["open PRs of other/tools"]);
  assert.deepEqual(w.types("reap_blocked"), [], "not another owner's repo_unreadable");
  assert.deepEqual(w.orca.calls.filter((c) => c.startsWith("worktreeRm")), []);
});

test("(3b) the checks before a removal still hold for a re-registered card the owner confirms", async () => {
  const w = world();
  const c = reregisteredFinished(w, "rereg-dirty");
  writeFileSync(join(c.path, "b.txt"), "unsaved\n");
  const r = await w.round({ confirmed: [c.instanceId] });
  assert.deepEqual(w.orca.calls.filter((x) => x.startsWith("worktreeRm")), []);
  assert.deepEqual(r.blocked, [{ kind: "worktree", ref: c.instanceId, reason: "uncommitted" }]);
});

function reregisteredFinished(w: ReturnType<typeof world>, name: string): WorktreeRow & { instanceId: string } {
  const repo = makeRepo(name);
  const c = card(name, repo, { id: `repo-new::${repo.path}`, repoId: "repo-new" }) as WorktreeRow & { instanceId: string };
  w.orca.cards.push(c);
  started(w.store, `repo-old::${repo.path}`);
  w.gh.prs.push({ number: w.gh.prs.length + 1, state: "closed", merged_at: "2026-11-09T00:00:00Z", head: { sha: repo.head, ref: name } });
  w.gh.known.add(repo.head);
  return c;
}

test("(3c) a Dispatch Orca still lists under the old id keeps the re-registered card: an open Task, an unsettled worker", async () => {
  const w = world();
  const open = reregisteredFinished(w, "rereg-open-task");
  w.orca.workers.push(worker(`repo-old::${open.path}`, { dispatchId: "ctx_open", taskId: "task_open", liveness: "exited" }));
  w.orca.taskStatus.set("task_open", "dispatched");
  const r = await w.round({ confirmed: [open.instanceId] });
  assert.deepEqual(w.orca.calls.filter((x) => x.startsWith("worktreeRm")), [], "the owner's confirmation does not take a card whose Task is open");
  assert.ok(r.marked.includes(open.instanceId));

  const t = world();
  const busy = reregisteredFinished(t, "rereg-busy");
  t.orca.workers.push(worker(`repo-old::${busy.path}`, { dispatchId: "ctx_busy", state: "dispatched", liveness: "live" }));
  const last = await rounds(t, 3, 30);
  assert.ok(last.marked.includes(busy.instanceId), "an unsettled Dispatch marks the card in the timer round");
  assert.deepEqual(t.orca.calls.filter((x) => x.startsWith("worktreeRm")), []);
});

test("(3d) with no PR, the last Dispatch under the old id judges the card: a failed one keeps it even when the owner confirms", async () => {
  const w = world();
  const repo = makeRepo("rereg-failed");
  const c = card("rereg-failed", repo, { id: `repo-new::${repo.path}`, repoId: "repo-new" }) as WorktreeRow & { instanceId: string };
  w.orca.cards.push(c);
  started(w.store, `repo-old::${repo.path}`);
  w.gh.known.add(repo.head);
  w.orca.workers.push(worker(`repo-old::${repo.path}`, { dispatchId: "ctx_failed", state: "failed", outcome: "failed", liveness: "exited" }));
  const r = await w.round({ confirmed: [c.instanceId] });
  assert.deepEqual(w.orca.calls.filter((x) => x.startsWith("worktreeRm")), [], "not read as no trace and taken on the owner's word");
  assert.deepEqual(r.reaped, []);
});

// Decision 313: a path-only Dispatch match may keep a card but finishes only a card sangsoe started.
function pathOnlyDispatch(w: ReturnType<typeof world>, name: string, o: { started: boolean; state: string }) {
  const repo = makeRepo(name);
  const c = card(name, repo, { id: `repo-new::${repo.path}`, repoId: "repo-new" }) as WorktreeRow & { instanceId: string };
  w.orca.cards.push(c);
  if (o.started) started(w.store, `repo-old::${repo.path}`);
  w.gh.known.add(repo.head);
  w.orca.workers.push(worker(`repo-old::${repo.path}`, { dispatchId: `ctx_${name}`, state: o.state, outcome: o.state, liveness: "exited" }));
  return c;
}

test("(6) the timer round does not take a card sangsoe did not start on a succeeded Dispatch that names only its path", async () => {
  const w = world();
  const c = pathOnlyDispatch(w, "foreign-path", { started: false, state: "succeeded" });
  const last = await rounds(w, 3, 30);
  assert.deepEqual(last.targets, []);
  assert.deepEqual(w.orca.calls.filter((x) => x.startsWith("worktreeRm")), []);
  assert.ok(last.unseen.includes(`finished? ${c.instanceId}: no PR and no Dispatch`));
});

test("(6b) the same card sangsoe started under the old id is finished by that Dispatch and goes, as decision 306 has it", async () => {
  const w = world();
  const c = pathOnlyDispatch(w, "started-path", { started: true, state: "succeeded" });
  const last = await rounds(w, 2, 30);
  assert.deepEqual(last.targets, [c.instanceId]);
  assert.deepEqual(w.orca.calls.filter((x) => x.startsWith("worktreeRm")), [`worktreeRm id:${c.id}`]);
});

test("(6c) a failed Dispatch that names only the path still keeps a card sangsoe did not start, even when the owner confirms", async () => {
  const w = world();
  const c = pathOnlyDispatch(w, "foreign-failed", { started: false, state: "failed" });
  const r = await w.round({ confirmed: [c.instanceId] });
  assert.deepEqual(w.orca.calls.filter((x) => x.startsWith("worktreeRm")), []);
  assert.ok(r.unseen.includes(`not finished: ${c.instanceId}: last Dispatch ended failed`));
});

test("(6d) for a card sangsoe did not start, the Dispatches under its exact id decide: an older failed one outweighs a newer path-only success", async () => {
  const w = world();
  const c = pathOnlyDispatch(w, "foreign-mixed", { started: false, state: "succeeded" });
  w.orca.workers.push(worker(c.id, { dispatchId: "ctx_exact_failed", state: "failed", outcome: "failed", liveness: "exited" }));
  await rounds(w, 3, 30);
  assert.deepEqual(w.orca.calls.filter((x) => x.startsWith("worktreeRm")), []);
  const r = await w.round({ confirmed: [c.instanceId] });
  assert.ok(r.unseen.includes(`not finished: ${c.instanceId}: last Dispatch ended failed`));
  assert.deepEqual(w.orca.calls.filter((x) => x.startsWith("worktreeRm")), []);

  const t = world();
  const ok = pathOnlyDispatch(t, "foreign-exact", { started: false, state: "succeeded" });
  t.orca.workers.splice(0, 1, worker(ok.id, { dispatchId: "ctx_exact_ok", state: "succeeded", liveness: "exited" }));
  const last = await rounds(t, 2, 30);
  assert.deepEqual(last.targets, [ok.instanceId], "an exact-id success finishes it, as before decision 306");
  assert.deepEqual(t.orca.calls.filter((x) => x.startsWith("worktreeRm")), [`worktreeRm id:${ok.id}`]);
});

test("(4) a card sangsoe did not start stays out: another path, a path that only shares a prefix, the main worktree", async () => {
  const store = Store.open({ path: ":memory:" });
  started(store, "repo-old::/w/task_a");
  const cards = [
    row("repo-new", "/w/task_c", "inst-c"),
    row("repo-new", "/w/task_ab", "inst-ab"),
    row("repo-new", "/x/w/task_a", "inst-x"),
    row("repo-new", "/w/task_a", "inst-main", { isMainWorktree: true }),
    row("repo-new", "", "inst-empty"),
  ];
  assert.deepEqual([...((await sangsoeWorktrees((f) => store.events(f), listing(cards))) ?? [])], []);
  const seen: { only?: ReadonlySet<string> } = {};
  await readResourcePart(resourceDeps(store, cards, seen), "candidates");
  assert.deepEqual([...(seen.only ?? [])], []);
});

test("(5) an exact id still matches, as before", async () => {
  const store = Store.open({ path: ":memory:" });
  started(store, "repo-1::/w/task_a");
  const cards = [row("repo-1", "/w/task_a", "inst-a"), row("repo-1", "/w/task_b", "inst-b")];
  assert.deepEqual([...((await sangsoeWorktrees((f) => store.events(f), listing(cards))) ?? [])], ["inst-a"]);
});
