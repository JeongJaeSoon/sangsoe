import assert from "node:assert/strict";
import { test } from "node:test";
import { handle as itemCreate } from "../../claude-plugin/mcp/tools/item_create.ts";
import { handle as itemRetire } from "../../claude-plugin/mcp/tools/item_retire.ts";
import { itemRetireCommand } from "../../cli/commands/item-retire.ts";
import {
  briefRuns,
  buildBrief,
  buildGroup,
  criticalPath,
  group_brief,
  item_timeline,
  itemFacts,
  panelView,
  readSnapshot,
  type ViewInput,
  why,
} from "../../core/index.ts";
import { createWorld, type World } from "../decision/world.ts";

// Decision 223 on the S6 leftovers' shape: two leads' items whose Tasks completed (worker_done) and
// whose PRs closed without a merge read 🚧 pr_closed forever. Retiring them is one store row.

const RUN_A = "run_00000000s6ra";
const RUN_B = "run_00000000s6rb";
const LEAD_A = "lead:s6r";
const LEAD_B = "lead:s6r2";
const NOW = "2026-11-12T03:00:00.000Z";
/** The owner's terminal: bound to no Run, so Orca refuses it any write to a lead's Run. */
const OWNER_SHELL = { run: null, terminal: true } as const;

type Made = { task: string; alias: string };

async function make(w: World, run: string, lead: string, spec: string): Promise<Made> {
  const r = await itemCreate({ runId: run, spec, who: lead, doneWhen: "PR merged", lead }, { orca: w.orca, store: w.store });
  assert.ok(r.ok, JSON.stringify(r));
  return r.value as Made;
}

function prFor(w: World, item: Made, pr: string, closed: boolean): void {
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr, task: item.task } });
  if (closed) w.store.append({ type: "pr_closed", source: "pr-monitor", payload: { pr } });
}

async function view(w: World): Promise<ViewInput> {
  const snap = await readSnapshot(w.orca, briefRuns(w.store.events(), null));
  assert.ok(snap.ok, JSON.stringify(snap));
  return { events: w.store.events(), orca: { tasks: snap.value.tasks, gates: snap.value.gates }, now: NOW };
}

/** lead:s6r's two items and lead:s6r2's one, each completed by its worker_done with its PR closed unmerged. */
async function s6Leftovers() {
  const w = createWorld([]);
  const a1 = await make(w, RUN_A, LEAD_A, "s6 b");
  const a2 = await make(w, RUN_A, LEAD_A, "s6 c");
  const b1 = await make(w, RUN_B, LEAD_B, "s6 d");
  for (const [item, pr] of [
    [a1, "acme/api#9"],
    [a2, "acme/api#10"],
    [b1, "acme/api#13"],
  ] as const) {
    (w.tasks.get(item.task) as { status: string }).status = "completed";
    prFor(w, item, pr, true);
  }
  w.strict();
  w.as(OWNER_SHELL);
  return { w, a1, a2, b1 };
}

const ports = (w: World) => ({ orca: w.orca, store: w.store });
const retired = (w: World) => w.store.events({ type: "item_retired" });

test("S6 leftovers: completed Tasks with PRs closed unmerged read 🚧 until retired, then leave every count", async () => {
  const { w, a1, a2, b1 } = await s6Leftovers();
  const before = await view(w);
  assert.deepEqual(itemFacts(before).map((f) => f.state), ["pr_closed", "pr_closed", "pr_closed"]);
  assert.equal(buildBrief(before).summary.blocked, 3);
  assert.equal(buildBrief(before).groups, 2);
  assert.ok(panelView(before, {}).ok);

  const callsBefore = w.calls().length;
  const r1 = await itemRetire({ item: a1.alias, reason: "S6 fixture PR closed by design", by: "owner" }, ports(w));
  assert.deepEqual(r1, { ok: true, value: { status: "retired", task: a1.task, alias: a1.alias } });
  const r2 = await itemRetireCommand({ reason: "S6 fixture PR closed by design", by: LEAD_A }, [a2.alias], ports(w));
  assert.deepEqual(r2, { ok: true, value: { status: "retired", task: a2.task, alias: a2.alias } });
  const r3 = await itemRetire({ item: b1.alias, reason: "S6 re-run fixture", by: LEAD_B }, ports(w));
  assert.ok(r3.ok, JSON.stringify(r3));
  // No Orca write: the strict caller (no Run) would be refused one, and the Tasks stay completed.
  assert.deepEqual(
    w.calls().slice(callsBefore).filter((c) => c[1] !== "task-list"),
    [],
  );
  assert.deepEqual([...w.tasks.values()].map((t) => t.status), ["completed", "completed", "completed"]);

  const after = await view(w);
  assert.deepEqual(itemFacts(after).map((f) => f.state), ["cancelled", "cancelled", "cancelled"]);
  const brief = buildBrief(after);
  assert.equal(brief.summary.blocked, 0);
  assert.equal(brief.groups, 0, "a group whose items are all retired is closed");
  assert.deepEqual(group_brief(after), []);
  assert.equal(buildGroup(after, LEAD_A), null);
  const panel = panelView(after, {});
  assert.ok(panel.ok);
  assert.match(panel.value.status.text, /🚧 0 \|/);
  assert.equal(why(after, a1.task).readiness, "not_waiting");
  assert.deepEqual(why(after, a1.task).rows, []);
  assert.deepEqual(criticalPath(after, LEAD_A).path, []);

  const audit = item_timeline(after, a2.task).filter((e) => e.type === "item_retired");
  assert.deepEqual(audit.map((e) => e.payload), [{ task: a2.task, by: LEAD_A, reason: "S6 fixture PR closed by design" }]);
});

test("a group with one retired item and one merged item is closed; one still open keeps it", async () => {
  const w = createWorld([]);
  const a = await make(w, RUN_A, LEAD_A, "a");
  const b = await make(w, RUN_A, LEAD_A, "b");
  for (const t of [a, b]) (w.tasks.get(t.task) as { status: string }).status = "completed";
  prFor(w, a, "acme/api#1", true);
  prFor(w, b, "acme/api#2", false);
  assert.ok((await itemRetire({ item: a.alias, reason: "superseded", by: "owner" }, ports(w))).ok);
  assert.equal(buildBrief(await view(w)).groups, 1, "b's PR is still open");
  w.store.append({ type: "pr_merged", source: "pr-monitor", payload: { pr: "acme/api#2", merge_sha: "b".repeat(40) } });
  assert.equal(buildBrief(await view(w)).groups, 0);
});

test("retire refuses an item that is not done with its PR closed unmerged, and writes nothing", async () => {
  const w = createWorld([]);
  const open = await make(w, RUN_A, LEAD_A, "open pr");
  const merged = await make(w, RUN_A, LEAD_A, "merged pr");
  const working = await make(w, RUN_A, LEAD_A, "in progress");
  const noPr = await make(w, RUN_A, LEAD_A, "no pr");
  for (const t of [open, merged, noPr]) (w.tasks.get(t.task) as { status: string }).status = "completed";
  (w.tasks.get(working.task) as { status: string }).status = "dispatched";
  prFor(w, open, "acme/api#3", false);
  prFor(w, merged, "acme/api#4", false);
  w.store.append({ type: "pr_merged", source: "pr-monitor", payload: { pr: "acme/api#4", merge_sha: "c".repeat(40) } });
  prFor(w, working, "acme/api#5", true);
  w.strict();
  w.as(OWNER_SHELL);

  for (const t of [open, merged, working, noPr]) {
    const tool = await itemRetire({ item: t.alias, reason: "r", by: "owner" }, ports(w));
    const cli = await itemRetireCommand({ reason: "r", by: "owner" }, [t.alias], ports(w));
    assert.deepEqual(cli, tool);
    assert.ok(!tool.ok && tool.refusal.code === "not_retirable", JSON.stringify(tool));
  }
  const unknown = await itemRetire({ item: "i999", reason: "r", by: "owner" }, ports(w));
  assert.ok(!unknown.ok && unknown.refusal.code === "not_found", JSON.stringify(unknown));
  for (const bad of [
    { item: open.alias, reason: " ", by: "owner" },
    { item: open.alias, reason: "r", by: "" },
  ]) {
    const r = await itemRetire(bad, ports(w));
    assert.ok(!r.ok && r.refusal.code === "invalid_input", JSON.stringify(r));
  }
  assert.equal(retired(w).length, 0);
});

test("a second retire is a no-op that reads nothing from Orca", async () => {
  const { w, a1 } = await s6Leftovers();
  assert.ok((await itemRetire({ item: a1.alias, reason: "first", by: "owner" }, ports(w))).ok);
  const calls = w.calls().length;
  const again = await itemRetireCommand({ reason: "second", by: LEAD_A }, [a1.task], ports(w));
  assert.deepEqual(again, { ok: true, value: { status: "already", task: a1.task, alias: a1.alias } });
  assert.equal(w.calls().length, calls);
  assert.deepEqual(retired(w).map((e) => e.payload.reason), ["first"]);
});

test("a retired item with a merged PR beside its closed one stays retired, and a second retire is already", async () => {
  const { w, a1 } = await s6Leftovers();
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#20", task: a1.task } });
  w.store.append({ type: "pr_merged", source: "pr-monitor", payload: { pr: "acme/api#20", merge_sha: "d".repeat(40) } });
  assert.ok((await itemRetire({ item: a1.alias, reason: "first", by: "owner" }, ports(w))).ok);
  assert.equal(itemFacts(await view(w)).find((x) => x.task === a1.task)?.state, "cancelled");
  const again = await itemRetire({ item: a1.alias, reason: "second", by: "owner" }, ports(w));
  assert.deepEqual(again, { ok: true, value: { status: "already", task: a1.task, alias: a1.alias } });
});

test("a retired item whose PR reopens reads 🚧 again: the retire stands only while the PR is closed unmerged", async () => {
  const { w, a1 } = await s6Leftovers();
  assert.ok((await itemRetire({ item: a1.alias, reason: "closed", by: "owner" }, ports(w))).ok);
  w.store.append({ type: "pr_reopened", source: "pr-monitor", payload: { pr: "acme/api#9" } });
  const f = itemFacts(await view(w)).find((x) => x.task === a1.task);
  assert.equal(f?.state, "blocked");
  const again = await itemRetire({ item: a1.alias, reason: "again", by: "owner" }, ports(w));
  assert.ok(!again.ok && again.refusal.code === "not_retirable", "a retire that is not in effect is not reported as done");
});
