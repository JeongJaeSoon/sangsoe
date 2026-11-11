import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate, type Host, hostFacts, ownerDone, Store } from "../../core/index.ts";
import { ownerWorld, RUN } from "../owner/world.ts";

// G23 (decision 212 ④): done_blockers refuse a close at the panel's 완료 and at a role session's own
// `task-update --status completed` (pr-monitor's close is in core/detect/pr/round.test.ts).

const T = "task_000000000001";

test("완료 on an owner item whose PR is still open is refused with the blocker; the press itself is the owner gate's ground", async () => {
  const w = ownerWorld();
  w.item(T, { who: "owner" });
  w.store.append({ type: "item_extra_set", source: "test", payload: { task: T, exec_by: "owner" }, entity: "task", entity_id: T });
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#8", task: T } });
  const r = await ownerDone({ orca: w.orca, store: w.store }, w.input(), w.facts(), { task: T });
  assert.ok(!r.ok);
  assert.equal(r.refusal.code, "done_blocked");
  assert.match(r.refusal.reason, /open_pr: acme\/api#8/);
  assert.doesNotMatch(r.refusal.reason, /owner_gate/, "the button's owner_action satisfies the owner gate");
  assert.equal(w.tasks.get(T)?.status, "ready", "no task-update");

  w.store.append({ type: "pr_merged", source: "pr-monitor", payload: { pr: "acme/api#8", merge_sha: "abc1234" } });
  const again = await ownerDone({ orca: w.orca, store: w.store }, w.input(), w.facts(), { task: T });
  assert.ok(again.ok, JSON.stringify(again));
  assert.equal(w.tasks.get(T)?.status, "completed");
});

test("a PR closed unmerged and replaced by a merged PR of the same task does not block the close", async () => {
  const w = ownerWorld();
  w.item(T, { who: "owner" });
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#5", task: T } });
  w.store.append({ type: "pr_closed", source: "pr-monitor", payload: { pr: "acme/api#5" } });
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#7", task: T } });
  w.store.append({ type: "pr_merged", source: "pr-monitor", payload: { pr: "acme/api#7", merge_sha: "abc1234" } });
  const r = await ownerDone({ orca: w.orca, store: w.store }, w.input(), w.facts(), { task: T });
  assert.ok(r.ok, JSON.stringify(r));
});

/** A host whose `orca … task-list` answers with these Tasks; nothing else runs. */
function host(tasks: unknown[] | null): Host & { ran: string[][] } {
  const ran: string[][] = [];
  return {
    ran,
    run: (cmd, args) => {
      ran.push([cmd, ...args]);
      if (cmd === "orca" && args[0] === "orchestration" && args[1] === "task-list" && tasks) {
        return { code: 0, stdout: JSON.stringify({ ok: true, result: { tasks, runId: RUN } }), stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "no" };
    },
    exists: () => false,
    readText: () => "",
    env: {},
    nodeVersion: process.versions.node,
  };
}

const close = (task: string) => ({ tool: "Bash", input: { command: `orca orchestration task-update --id ${task} --status completed` }, cwd: "/work/acme", subagent: false });
const lead = { tool_name: "Bash", tool_input: {}, cwd: "/work/acme", agent_type: "sangsoe:lead" };

test("a lead's own task-update close is refused while a flow child is open, and passes once it is done", () => {
  const store = Store.open({ path: ":memory:" });
  try {
    store.append({ type: "item_created", source: "core:item", entity: "task", entity_id: "task_root", payload: { task: "task_root", alias: "i001", who: "lead:api", done_when: "d", owner_action: 0 } });
    store.append({ type: "item_extra_set", source: "lead:api", payload: { task: "task_child", flow: "task_root", step: "impl" } as never });
    const open = host([
      { id: "task_root", status: "dispatched" },
      { id: "task_child", status: "dispatched" },
    ]);
    const m = evaluate(close("task_root"), hostFacts(lead, open, () => store));
    assert.equal(m.decision, "deny");
    assert.match(m.verdicts[0]?.reason ?? "", /^\[gate:done-blockers\].*open_child: task_child \(impl\)/);
    assert.ok(open.ran.some((a) => a.includes("--full")), "the adapter's own args: --full and --json");

    const done = host([
      { id: "task_root", status: "dispatched" },
      { id: "task_child", status: "completed" },
    ]);
    assert.equal(evaluate(close("task_root"), hostFacts(lead, done, () => store)).decision, "none");

    const unread = evaluate(close("task_root"), hostFacts(lead, host(null), () => store));
    assert.equal(unread.decision, "deny", "an unread task list is not 'no blockers'");
  } finally {
    store.close();
  }
});
