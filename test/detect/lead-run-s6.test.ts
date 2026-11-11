import assert from "node:assert/strict";
import { test } from "node:test";
import { handle as itemCreate } from "../../claude-plugin/mcp/tools/item_create.ts";
import { graphSyncCommand } from "../../cli/commands/graph-sync.ts";
import {
  briefRuns,
  buildBrief,
  buildGroup,
  criticalPath,
  DEFAULT_MONITOR_CONFIG,
  graphRead,
  type MonitorDeps,
  nullChatProvider,
  readSnapshot,
  runMonitor,
  VERSION,
  type ViewInput,
} from "../../core/index.ts";
import { createWorld } from "../decision/world.ts";

// S6 NOW-3: a lead makes its items in its own Run. The plugin timer's rounds and the brief run with
// no current Run (or the orchestrator's), so they read only the Runs events name; the items must name theirs.

const LEAD_RUN = "run_00000000000l";
const LEAD = "lead:s6";
const PR = "acme/api#4";
const NOW = Date.parse("2026-11-11T03:00:00Z");

async function leadWorld() {
  const w = createWorld([]);
  const made = await itemCreate({ runId: LEAD_RUN, spec: "B", who: "worker", doneWhen: "PR merged", lead: LEAD }, { orca: w.orca, store: w.store });
  assert.ok(made.ok, JSON.stringify(made));
  const task = String((made.value as { task: string }).task);
  const monitor: MonitorDeps = {
    orca: w.orca,
    exec: async () => ({ code: 1, stdout: "", stderr: "" }),
    events: (f) => w.store.events(f),
    append: (e) => w.store.append(e),
    now: () => NOW,
    config: DEFAULT_MONITOR_CONFIG,
    chat: nullChatProvider,
    sample: () => ({ cpus: 8 }),
    core: { store: w.store, orca: w.orca },
    coreVersion: VERSION,
  };
  const view = async (): Promise<ViewInput> => {
    const snap = await readSnapshot(w.orca, briefRuns(w.store.events(), null));
    assert.ok(snap.ok);
    return { events: w.store.events(), orca: { tasks: snap.value.tasks, gates: snap.value.gates }, now: new Date(NOW).toISOString() };
  };
  return { w, task, monitor, view };
}

test("S6 NOW-3: an item made in a lead's Run names that Run, so a read with no current Run sees it", async () => {
  const x = await leadWorld();
  assert.deepEqual(briefRuns(x.w.store.events(), null), [LEAD_RUN]);
  const input = await x.view();
  assert.deepEqual(input.orca.tasks.map((t) => t.id), [x.task]);
  assert.equal(buildBrief(input).groups, 1, "the brief without --run shows the lead's group");
  assert.notEqual(buildGroup(input, LEAD), null, "item_create's lead groups the item");
  assert.deepEqual(criticalPath(input, LEAD).path.map((n) => n.task), [x.task], "graph critical --lead finds it");
});

test("S6 NOW-3: the plugin timer's queue round makes the re-review item for a lead Run's PR", async () => {
  const x = await leadWorld();
  const t = x.w.tasks.get(x.task);
  assert.ok(t);
  t.status = "completed";
  x.w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: PR, task: x.task, base: "s6/a", head_sha: "a".repeat(40), head: "s6/b" } });
  x.w.store.append({ type: "pr_base_changed", source: "pr-monitor", payload: { pr: PR, from: "s6/a", to: "main" } });

  await runMonitor("queue", x.monitor);
  const made = x.w.store.events({ type: "item_created" }).filter((e) => e.payload.task !== x.task);
  assert.equal(made.length, 1, "none refused as outside the Runs read this round");
  assert.equal(made[0]?.payload.run, LEAD_RUN, "the re-review item names its Run too");
  assert.deepEqual(graphRead.why(await x.view(), x.task).map((r) => r.kind), ["blocks"]);
});

test("S6 re-run NOW-A: a round fenced out of the lead's Run wakes that Run once, and the lead's graph sync makes the item", async () => {
  const x = await leadWorld();
  const t = x.w.tasks.get(x.task);
  assert.ok(t);
  t.status = "completed";
  x.w.fence();
  x.w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: PR, task: x.task, base: "s6/a", head_sha: "a".repeat(40), head: "s6/b" } });
  x.w.store.append({ type: "pr_base_changed", source: "pr-monitor", payload: { pr: PR, from: "s6/a", to: "main" } });
  const others = () => x.w.store.events({ type: "item_created" }).filter((e) => e.payload.task !== x.task);
  const wakes = () => x.w.sends.filter((s) => s.to === `run:${LEAD_RUN}` && s.subject.startsWith("🔁 rereview_item"));

  await runMonitor("queue", x.monitor);
  assert.equal(others().length, 0, "Orca fences the timer out of the lead's Run");
  assert.equal(wakes().length, 1, "the Run's bound session is woken instead");
  assert.equal(wakes()[0]?.type, "status", "the timer holds no Dispatch");
  assert.ok(wakes()[0]?.body.includes(`sangsoe graph sync --run ${LEAD_RUN}`), wakes()[0]?.body);

  await runMonitor("queue", x.monitor);
  assert.equal(wakes().length, 1, "one wake per base change, not one per round");

  // The lead's session is bound to its Run, so its task-create passes.
  x.w.useRun(LEAD_RUN);
  const out = await graphSyncCommand({ run: [LEAD_RUN] }, { orca: x.w.orca, store: x.w.store });
  assert.ok(out.ok, JSON.stringify(out));
  assert.equal(others().length, 1);
  assert.equal(others()[0]?.payload.run, LEAD_RUN);
  assert.deepEqual(graphRead.why(await x.view(), x.task).map((r) => r.kind), ["blocks"]);

  // The next base change of the same PR needs its own item, so it wakes the Run again.
  x.w.useRun("run_000000000orc");
  x.w.store.append({ type: "pr_base_changed", source: "pr-monitor", payload: { pr: PR, from: "main", to: "release" } });
  await runMonitor("queue", x.monitor);
  assert.equal(wakes().length, 2);
});
