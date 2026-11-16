// Decision 310: start_unit added a Read rule for the child worktree to its parent's local settings;
// REAPER takes exactly that rule back when it removes the child, and only then.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { LOCAL_SETTINGS } from "../../core/index.ts";
import { assertNeverForbidden, dropScratch, finishedCard, rounds, scratch, world } from "./harness.ts";

after(dropScratch);

function parentWith(name: string, allow: string[]): string {
  const parent = join(scratch(), `${name}-parent`);
  mkdirSync(join(parent, ".claude"), { recursive: true });
  writeFileSync(join(parent, LOCAL_SETTINGS), JSON.stringify({ advisorModel: "fable", permissions: { allow } }));
  return parent;
}

const allowIn = (parent: string) => JSON.parse(readFileSync(join(parent, LOCAL_SETTINGS), "utf8")).permissions.allow;

test("decision 310: removing the child worktree takes its Read rule out of the parent's file, keeping the rest", async () => {
  const w = world();
  const c = finishedCard(w, "child");
  const rule = `Read(/${c.path}/**)`;
  const other = "Read(//elsewhere/sibling/**)";
  const parent = parentWith("child", ["Bash(npm test)", rule, other]);
  w.store.append({
    type: "unit_started",
    source: "mcp:start_unit",
    entity: "task",
    entity_id: "task_child",
    payload: { kind: "worker", picked_by: "role", model: "m", effort: "medium", route: "none", budget: 0, budget_per: "unit", used: 0, worktree: c.id, parent, read_rules: [rule] },
  });
  await rounds(w, 3, 30);
  assert.equal(w.orca.calls.filter((x) => x.startsWith("worktreeRm")).length, 1);
  assert.deepEqual(allowIn(parent), ["Bash(npm test)", other]);
  assert.equal(JSON.parse(readFileSync(join(parent, LOCAL_SETTINGS), "utf8")).advisorModel, "fable");
  assertNeverForbidden(w);
});

test("decision 310: a card whose repository was re-registered is matched by path, as decision 306 names it", async () => {
  const w = world();
  const c = finishedCard(w, "moved");
  const rule = `Read(/${c.path}/**)`;
  const parent = parentWith("moved", [rule]);
  w.store.append({
    type: "unit_started",
    source: "mcp:start_unit",
    entity: "task",
    entity_id: "task_moved",
    payload: { kind: "worker", picked_by: "role", model: "m", effort: "medium", route: "none", budget: 0, budget_per: "unit", used: 0, worktree: `repo-old::${c.path}`, parent, read_rules: [rule] },
  });
  await rounds(w, 3, 30);
  assert.equal(w.orca.calls.filter((x) => x.startsWith("worktreeRm")).length, 1);
  assert.deepEqual(allowIn(parent), []);
});

test("decision 310: a card that stays keeps its parent's rule, and a dry run changes nothing", async () => {
  for (const dry of [false, true]) {
    const w = world();
    w.dryRun = dry;
    const c = finishedCard(w, `kept-${dry}`);
    const rule = `Read(/${c.path}/**)`;
    const parent = parentWith(`kept-${dry}`, [rule]);
    w.store.append({
      type: "unit_started",
      source: "mcp:start_unit",
      entity: "task",
      entity_id: `task_kept_${dry}`,
      payload: { kind: "worker", picked_by: "role", model: "m", effort: "medium", route: "none", budget: 0, budget_per: "unit", used: 0, worktree: c.id, parent, read_rules: [rule] },
    });
    // One round only: a card is removed after two sightings and the grace.
    await rounds(w, dry ? 3 : 1, 30);
    assert.deepEqual(allowIn(parent), [rule], dry ? "dry run" : "not removed yet");
  }
});

test("decision 310: a parent file that is gone does not fail the round", async () => {
  const w = world();
  const c = finishedCard(w, "orphan");
  w.store.append({
    type: "unit_started",
    source: "mcp:start_unit",
    entity: "task",
    entity_id: "task_orphan",
    payload: { kind: "worker", picked_by: "role", model: "m", effort: "medium", route: "none", budget: 0, budget_per: "unit", used: 0, worktree: c.id, parent: join(scratch(), "no-such-parent"), read_rules: [`Read(/${c.path}/**)`] },
  });
  await rounds(w, 3, 30);
  assert.equal(w.orca.calls.filter((x) => x.startsWith("worktreeRm")).length, 1);
  assert.equal(w.types("reap_done").length, 1, "the removal is recorded as usual");
});
