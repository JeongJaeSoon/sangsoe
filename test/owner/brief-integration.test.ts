import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBrief, linkShell, owner_todo, ownerDone, recordShellLink } from "../../core/index.ts";
import { later, ownerWorld, T0 } from "./world.ts";

// The brief (U9) reads owner_todo's one body (core/owner), so the counts below are the brief's own.

const T = "task_000000000001";

test("owner_act_unlinked_expires: one PR row, gone once linked or after show_hours, buckets never move", () => {
  const w = ownerWorld();
  w.item("task_000000000002", { who: "lead:api", status: "dispatched" });
  const brief = () => buildBrief(w.input());
  const before = brief().summary;
  const act = w.store.append({ type: "owner_act_unlinked", source: "monitor:pr", payload: { act: "gh pr merge acme/api#40" } });
  const rows = () => brief().inProgress.rows.filter((r) => r.id.startsWith("act:"));
  assert.equal(rows().length, 1);
  assert.deepEqual(brief().summary, before);

  w.at(later(T0, 25 * 60));
  assert.equal(rows().length, 0, "past show_hours");
  w.at(T0);
  w.store.append({
    type: "decision_answered",
    source: "mcp:orchestrator",
    payload: { decision: "d001", owner_action: 0, answer: "merged it", linked_by: "orchestrator" },
    subject: `act:${act.seq}`,
  });
  assert.equal(rows().length, 0, "linked by the orchestrator: gone at once");
  assert.deepEqual(brief().summary, before);
  assert.equal(w.store.events().filter((e) => e.type === "owner_act_unlinked").length, 1, "the event stays in the record");
});

test("a probe-verified owner item leaves owner_todo and the brief's to-do; the numbers agree", () => {
  const w = ownerWorld();
  w.item(T, { verify: { kind: "pr_merged", pr: "acme/api#40" } });
  assert.equal(owner_todo(w.input()).length, 1);
  assert.equal(buildBrief(w.input()).todo.total, 1);
  w.store.append({ type: "evidence", source: "monitor:queue", payload: { kind: "probe:pr_merged", observed: "acme/api#40 merged" }, entity: "task", entity_id: T });
  assert.equal(owner_todo(w.input()).length, 0);
  assert.equal(buildBrief(w.input()).todo.total, 0);
  assert.ok(buildBrief(w.input()).inProgress.rows.some((r) => r.id === "i001"), "now a 🟢 row in 진행 중");
});

test("an owner `!` line does not verify an item the button pressed: it stays ⏳ 검증 대기", async () => {
  const w = ownerWorld();
  w.item(T, { verify: { kind: "run_ok", repo: "acme/api" }, cmdHint: "gh workflow run promote.yml" });
  const line = { uuid: "u1", command: "gh workflow run promote.yml -R acme/api", exitCode: 0, stdout: "https://github.com/acme/api/actions/runs/9", stderr: "", repo: "acme/api", ts: T0 };
  recordShellLink(w.store, line, linkShell(w.input(), w.facts(), line));
  const r = await ownerDone({ orca: w.orca, store: w.store }, w.input(), w.facts(), { task: T });
  assert.ok(r.ok);
  w.at(later(T0, 1));
  const b = buildBrief(w.input());
  assert.equal(w.state(T), "pending_verify");
  assert.deepEqual([b.summary.done, b.evidenceShort], [0, 0], "not ✅ 🔍: not done at all");
  assert.ok(b.inProgress.rows.some((r) => r.id === "i001" && r.cells[0]?.text === "⏳"));
});
