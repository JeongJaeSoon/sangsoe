import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBrief, group_brief, owner_todo } from "../../core/index.ts";
import { later, ownerWorld, type OwnerWorld, T0 } from "./world.ts";

// Decision 342: an owner `!` line that merged or closed a PR leaves "오너 직접 · 연결?" once the PR's
// own merged/closed row is in the store; a probe item is not ready work and not the owner's to-do.

const SHA = "0123456789abcdef0123456789abcdef01234567";
const acts = (w: OwnerWorld) => buildBrief(w.input()).inProgress.rows.filter((r) => r.id.startsWith("act:"));
const line = (w: OwnerWorld, act: string, at = T0) => {
  w.at(at);
  return w.store.append({ type: "owner_act_unlinked", source: "hook:owner_input", payload: { act } });
};
// pr-monitor writes actor owner:<login> on a merge it ties to the owner (watch.owners, not a land).
const OWNER = "owner:acme-owner";
const merged = (w: OwnerWorld, pr: string, at = later(T0, 5), actor = OWNER) => {
  w.at(at);
  w.store.append({ type: "pr_merged", source: "monitor:pr", payload: { pr, merge_sha: SHA, merged_at: at }, ...(actor ? { actor } : {}) });
};
const closed = (w: OwnerWorld, pr: string, at = later(T0, 5)) => {
  w.at(at);
  w.store.append({ type: "pr_closed", source: "monitor:pr", payload: { pr } });
};

test("a `gh pr merge` line whose repo is named leaves the panel once that PR's pr_merged is recorded", () => {
  const w = ownerWorld();
  line(w, "gh pr merge 12 -R acme/app");
  line(w, "gh pr merge https://github.com/acme/app/pull/13 --squash");
  line(w, "gh pr merge --repo=acme/app --squash 14");
  w.at(later(T0, 10));
  assert.equal(acts(w).length, 3, "no merged fact yet: the rows stay");
  merged(w, "acme/app#12");
  merged(w, "acme/app#13");
  merged(w, "acme/app#14");
  w.at(later(T0, 10));
  assert.deepEqual(acts(w), []);
});

test("a bare PR number links when exactly one settled PR carries it near the line; two repos leave the row", () => {
  const w = ownerWorld();
  line(w, "gh pr merge 21 --squash --delete-branch");
  line(w, "gh pr merge 22");
  merged(w, "acme/app#21");
  merged(w, "acme/app#22");
  merged(w, "acme/api#22");
  w.at(later(T0, 10));
  assert.deepEqual(
    acts(w).map((r) => r.cells[1]?.text),
    ["└ gh pr merge 22"],
    "22 is merged in two repos: the line names neither, so it stays",
  );
});

test("a bare number is not joined to a merge nobody tied to the owner: another repo's PR with the same number", () => {
  const w = ownerWorld();
  line(w, "gh pr merge 200");
  merged(w, "acme/tool#200", later(T0, 5), "some-bot");
  merged(w, "acme/lib#200", later(T0, 5), "");
  w.at(later(T0, 10));
  assert.equal(acts(w).length, 1);
  merged(w, "acme/app#200");
  w.at(later(T0, 10));
  assert.equal(acts(w).length, 0, "one merge by the owner: that is the line's PR");
});

test("a bare number also joins a merge whose plain actor is a login pr-monitor has tied to the owner elsewhere", () => {
  const w = ownerWorld();
  line(w, "gh pr merge 192");
  merged(w, "acme/app#192", later(T0, 5), "acme-owner");
  w.at(later(T0, 10));
  assert.equal(acts(w).length, 1, "no owner: row anywhere yet: the login is not known as the owner's");
  merged(w, "acme/app#300");
  w.at(later(T0, 10));
  assert.equal(acts(w).length, 0);
});

test("the same line typed three times leaves together, and `gh pr close` reads pr_closed, not pr_merged", () => {
  const w = ownerWorld();
  for (const m of [0, 1, 2]) line(w, "gh pr merge 31", later(T0, m));
  line(w, "gh pr close 32 -R acme/app");
  line(w, "gh pr merge 33 -R acme/app");
  merged(w, "acme/app#31");
  closed(w, "acme/app#32");
  closed(w, "acme/app#33");
  w.at(later(T0, 10));
  assert.deepEqual(
    acts(w).map((r) => r.cells[1]?.text),
    ["└ gh pr merge 33 -R acme/app"],
    "a merge line is not answered by a PR that closed unmerged",
  );
});

test("a fact far from the line, a line with no PR number and a non-gh line all stay", () => {
  const w = ownerWorld();
  line(w, "gh pr merge 41 -R acme/app", later(T0, 60 * 20));
  line(w, "gh pr merge --squash", later(T0, 60 * 20));
  line(w, "gh release create v1 -R acme/app", later(T0, 60 * 20));
  merged(w, "acme/app#41", later(T0, -60 * 5));
  w.at(later(T0, 60 * 21));
  assert.equal(acts(w).length, 3);
});

test("a compound line, a quoted flag value and a `#N` comment are not read: the row stays", () => {
  const w = ownerWorld();
  line(w, "gh pr merge 61 -R acme/app && gh pr merge 62 -R acme/app");
  line(w, 'gh pr merge -t "fix #63 stuff" 64 -R acme/app');
  line(w, "gh pr merge #65 -R acme/app");
  for (const n of [61, 63, 65]) merged(w, `acme/app#${n}`);
  w.at(later(T0, 10));
  assert.equal(acts(w).length, 3);
});

test("pr-monitor's own `merged <PR>` row is the merge fact itself and stays for the orchestrator to link", () => {
  const w = ownerWorld();
  line(w, "merged acme/app#51");
  merged(w, "acme/app#51");
  w.at(later(T0, 10));
  assert.equal(acts(w).length, 1);
});

test("a probe item is neither ready work nor the owner's to-do, and the counts agree", () => {
  const w = ownerWorld();
  const probe = "task_0000000000p1";
  const real = "task_0000000000a1";
  w.item(probe, { who: "orchestrator" });
  w.item(real, { who: "owner" });
  w.store.append({ type: "item_extra_set", source: "mcp:item_create", payload: { task: probe, probe: true }, entity: "task", entity_id: probe });
  w.store.append({ type: "item_extra_set", source: "mcp:item_create", payload: { task: real, exec_by: "owner" }, entity: "task", entity_id: real });
  const b = buildBrief(w.input());
  assert.deepEqual(b.inProgress.rows.filter((r) => !r.id.startsWith("lead:")).map((r) => r.id), [], "the owner item is in the to-do, the probe item nowhere");
  assert.deepEqual(b.summary, { done: 0, doing: 0, left: 0, blocked: 1 });
  assert.deepEqual(owner_todo(w.input()).map((r) => r.ref), ["i002"]);
  assert.equal(b.todo.total, 1);
  assert.equal(group_brief(w.input()).reduce((n, g) => n + g.items, 0), 1);
});

test("a probe item that is an owner item and ready is hidden too; one that already runs is not", () => {
  const w = ownerWorld();
  const a = "task_0000000000p2";
  const b = "task_0000000000p3";
  w.item(a, { who: "owner" });
  w.item(b, { who: "orchestrator", status: "dispatched" });
  for (const task of [a, b]) w.store.append({ type: "item_extra_set", source: "mcp:item_create", payload: { task, probe: true }, entity: "task", entity_id: task });
  assert.deepEqual(owner_todo(w.input()), []);
  assert.deepEqual(
    buildBrief(w.input()).inProgress.rows.filter((r) => !r.id.startsWith("lead:")).map((r) => r.id),
    ["i002"],
  );
});
