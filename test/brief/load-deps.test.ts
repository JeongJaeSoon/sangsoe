import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBriefInput, type OrcaAdapter, readSnapshot, ready, Store } from "../../core/index.ts";

// Decision 178: the brief and the `ready` resource read the same Orca deps start_unit reads, so a
// dependent of a completed Task with its PR open is not listed as ready.

const fake = (rows: unknown[]) =>
  ({
    taskList: async () => ({ ok: true, value: rows }),
    gateList: async () => ({ ok: true, value: [] }),
  }) as unknown as OrcaAdapter;

test("the brief's snapshot keeps Orca deps: the dependent waits while its predecessor's PR is open", async () => {
  const snap = await readSnapshot(
    fake([
      { id: "task_a", status: "completed", title: "a", deps: "[]" },
      { id: "task_b", status: "ready", title: "b", deps: JSON.stringify(["task_a"]) },
    ]),
    ["run_x"],
  );
  assert.ok(snap.ok);
  assert.deepEqual(snap.value.tasks.find((t) => t.id === "task_b")?.deps, ["task_a"]);
  const store = Store.open({ path: ":memory:", clock: () => "2026-11-10T09:00:00.000Z" });
  store.append({ type: "pr_opened", source: "test", payload: { pr: "acme/api#31", task: "task_a" } });
  const input = { events: store.events(), orca: snap.value, now: "2026-11-10T12:00:00.000Z" };
  assert.deepEqual(
    ready(input).map((r) => r.task),
    [],
  );
});

/** An adapter whose every call takes a few ms, counting how many are in flight at once. */
function slowOrca(current: string) {
  let now = 0;
  let peak = 0;
  const calls: string[] = [];
  const call = async <T>(name: string, value: T) => {
    calls.push(name);
    peak = Math.max(peak, ++now);
    await new Promise((r) => setTimeout(r, 5));
    now -= 1;
    return { ok: true, value };
  };
  const orca = {
    runCurrent: () => call("run-current", { runId: current }),
    taskList: (a: { run: string }) => call(`task-list ${a.run}`, [{ id: `task_${a.run}`, status: "ready", title: a.run, deps: "[]" }]),
    gateList: (a: { run: string }) => call(`gate-list ${a.run}`, []),
  } as unknown as OrcaAdapter;
  return { orca, peak: () => peak, calls };
}

test("U86 audit: the brief's Orca reads run side by side, run-current among them, in the Runs' order", async () => {
  const o = slowOrca("run_a");
  const snap = await readSnapshot(o.orca, ["run_a", "run_b", "run_c"]);
  assert.ok(snap.ok);
  assert.equal(o.peak(), 6, "task-list and gate-list of three Runs at once");
  assert.deepEqual(snap.value.tasks.map((t) => t.runId), ["run_a", "run_b", "run_c"]);

  const dir = mkdtempSync(join(tmpdir(), "sangsoe-load-"));
  try {
    const file = join(dir, "events.jsonl");
    writeFileSync(file, "");
    const p = slowOrca("run_a");
    const input = await loadBriefInput({ now: "2026-11-10T12:00:00.000Z", eventsFile: file, orca: p.orca, runs: ["run_b", "run_c"] });
    assert.ok(input.ok, JSON.stringify(input));
    assert.equal(p.peak(), 5, "run-current waits for nothing: the named Runs' reads start with it");
    assert.deepEqual(input.value.orca.tasks.map((t) => t.runId), ["run_a", "run_b", "run_c"], "the current Run first, as before");
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("an unreadable deps value does not fail the brief; that Task reads as having none", async () => {
  const snap = await readSnapshot(fake([{ id: "task_c", status: "ready", title: "c", deps: "not json" }]), ["run_x"]);
  assert.ok(snap.ok);
  assert.deepEqual(snap.value.tasks[0]?.deps, []);
});
