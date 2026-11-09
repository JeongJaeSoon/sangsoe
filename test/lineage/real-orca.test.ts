import assert from "node:assert/strict";
import { test } from "node:test";
import { checkLineage, createOrcaAdapter, nodeExec, Store, startUnit } from "../../core/index.ts";

// Real Orca, opt-in only (CI never sets these). unit_lineage_complete reads the units already
// started on a Run; the throwaway start opens one worker through startUnit and is released by hand.
//   SANGSOE_REAL_RUN=<run id> SANGSOE_REAL_PARENT=<worktree id the Run's workers hang under>
//   SANGSOE_REAL_START=1 SANGSOE_REAL_WORKTREE=<requester's worktree> and either SANGSOE_REAL_TASK=<the
//   requester's own Task, a lead's> or SANGSOE_REAL_ROLE=orchestrator (a session holding the Run with no Dispatch)
const env = process.env;
const run = env.SANGSOE_REAL_RUN;
const parent = env.SANGSOE_REAL_PARENT;

test("unit_lineage_complete on real Orca", { skip: !run || !parent }, async () => {
  const orca = createOrcaAdapter(nodeExec());
  const tasks = await orca.taskList({ run: run ?? "" });
  assert.ok(tasks.ok, JSON.stringify(tasks));
  const started = tasks.value.filter((t) => t.status === "dispatched" || t.status === "completed");
  assert.ok(started.length > 0, "no started units on this Run");
  const r = await checkLineage(orca, started.map((t) => ({ taskId: t.id, runId: run ?? "", parentWorktreeId: parent ?? "" })));
  console.log(JSON.stringify(r, null, 1));
  // A completed unit's worktree is removed once it lands; only that one problem is tolerated, only then.
  const done = new Set(started.filter((t) => t.status === "completed").map((t) => t.id));
  const removed = (u: (typeof r.units)[number]) =>
    done.has(u.taskId) && u.dispatchId && u.runId && u.problems.join() === "새 worktree 가 로컬 목록에 없다";
  const broken = r.units.filter((u) => u.problems.length > 0 && !removed(u));
  console.log(`units ${r.units.length} · complete ${r.units.filter((u) => u.problems.length === 0).length} · removed after completion ${r.units.filter(removed).length} · broken ${broken.length}`);
  assert.deepEqual(broken, []);
});

test("throwaway start through startUnit on real Orca", { skip: env.SANGSOE_REAL_START !== "1" }, async () => {
  const orca = createOrcaAdapter(nodeExec(180_000));
  const store = Store.open({ path: ":memory:" });
  const spec = [
    "/goal U10 throwaway: check that /goal as the first prompt line takes effect, then finish at once",
    "This is a throwaway Task. Do no work. Send worker_done right away with --outcome succeeded and a one-line body saying whether a /goal was set for this session.",
  ].join("\n");
  const out = await startUnit(
    { orca, store, slots: () => 1, source: "test:real-orca" },
    {
      requester: {
        role: env.SANGSOE_REAL_ROLE === "orchestrator" ? "orchestrator" : "lead",
        worktreeId: env.SANGSOE_REAL_WORKTREE ?? "",
        runId: run ?? "",
        ...(env.SANGSOE_REAL_TASK ? { taskId: env.SANGSOE_REAL_TASK } : {}),
      },
      childRole: "worker",
      task: { spec, title: "U10 throwaway: /goal first prompt" },
      agent: "claude",
    },
  );
  console.log(JSON.stringify({ out, events: store.events() }, null, 1));
  assert.equal(out.kind, "started");
});
