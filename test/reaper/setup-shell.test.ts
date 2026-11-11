// Decision 202: the plain shell `worktree create` opens outlives worker-release. REAPER closes that
// one recorded handle after release, so the card can be reaped; nothing else is ever closed.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { WorktreeRow } from "../../core/index.ts";
import { assertNeverForbidden, CONFIG, dropScratch, finishedCard, rounds, worker, world } from "./harness.ts";

after(dropScratch);

const SHELL = "term_shell";
const OWNER = "term_owner";

function unit(w: ReturnType<typeof world>, name: string, o: { setup?: "none" | "script" | "unknown"; shell?: string; released?: boolean; extra?: { handle: string; agentIdentity?: string }[] } = {}) {
  const c: WorktreeRow = finishedCard(w, name);
  const shell = o.shell ?? SHELL;
  w.store.append({
    type: "unit_started",
    source: "mcp:start_unit",
    entity: "task",
    entity_id: `task_${name}`,
    payload: { kind: "worker", picked_by: "role", model: "m", effort: "medium", route: "worktree_file", budget: 3, budget_per: "unit", used: 0, worktree: c.id, shell, setup: o.setup ?? "none" },
  });
  w.orca.workers.push(worker(c.id, { terminalState: o.released === false ? "retained" : "released" }));
  const terms = [{ handle: shell }, ...(o.extra ?? [])];
  w.orca.terminals.set(c.id, terms);
  w.orca.ps.push({ worktreeId: c.id, hostId: "local", repo: "api", path: c.path, branch: c.branch, isMainWorktree: false, isArchived: false, liveTerminalCount: terms.length, unverifiableTerminalCount: 0, status: "active", agents: [] } as never);
  return c;
}

const closes = (w: ReturnType<typeof world>) => w.orca.calls.filter((c) => c.startsWith("terminalClose"));
const rms = (w: ReturnType<typeof world>) => w.orca.calls.filter((c) => c.startsWith("worktreeRm"));

test("decision 202: a released unit's recorded setup shell is closed, and the card is then reaped", async () => {
  const w = world();
  unit(w, "freed");
  const first = await w.round();
  assert.deepEqual(first.shells_closed, [SHELL]);
  assert.deepEqual(closes(w), [`terminalClose ${SHELL}`]);
  await rounds(w, 3, 30);
  assert.equal(rms(w).length, 1, "with no live terminal left the card goes the usual way");
  assert.equal(closes(w).length, 1, "closed once");
  assertNeverForbidden(w);
});

test("decision 202: nothing is closed before release, with a setup script, beside another terminal's handle, or on a dry run", async () => {
  const cases: [string, Parameters<typeof unit>[2]][] = [
    ["retained", { released: false }],
    ["script", { setup: "script" }],
    ["unknown", { setup: "unknown" }],
  ];
  for (const [name, o] of cases) {
    const w = world();
    unit(w, name, o);
    await rounds(w, 3, 30);
    assert.deepEqual(closes(w), [], name);
    assert.deepEqual(rms(w), [], `${name}: a live shell keeps the card`);
    assertNeverForbidden(w);
  }
  // The owner's own terminal in that worktree stays, and so does the card; only the shell goes.
  const owner = world();
  unit(owner, "owner", { extra: [{ handle: OWNER }] });
  await rounds(owner, 3, 30);
  assert.deepEqual(closes(owner), [`terminalClose ${SHELL}`]);
  assert.deepEqual(rms(owner), []);
  assertNeverForbidden(owner);
  // The recorded handle now holds an agent (Orca reused it): not a shell any more.
  const reused = world();
  const c = unit(reused, "reused");
  reused.orca.terminals.set(c.id, [{ handle: SHELL, agentIdentity: "claude" }]);
  await reused.round();
  assert.deepEqual(closes(reused), []);
  const dry = world();
  dry.dryRun = true;
  unit(dry, "dry");
  await dry.round();
  assert.deepEqual(closes(dry), [], "a dry run acts on nothing");
  // A card on the protect list is the owner's, shell included.
  const kept = world();
  const k = unit(kept, "kept");
  kept.config = { ...CONFIG, protect: [k.path] };
  await kept.round();
  assert.deepEqual(closes(kept), []);
});

test("decision 202: a mark-only round, and one with no reaper config, still closes the shell but removes no card", async () => {
  const marking = world();
  unit(marking, "marking");
  assert.deepEqual((await marking.round({ markOnly: true })).shells_closed, [SHELL]);
  const unset = world();
  unset.config = null;
  unit(unset, "unset");
  await rounds(unset, 3, 30);
  assert.deepEqual(closes(unset), [`terminalClose ${SHELL}`]);
  assert.deepEqual(rms(unset), []);
  assertNeverForbidden(unset);
});

test("decision 201: a reaper config that cannot be parsed blocks the round: no shell closed, no card removed, a reap_blocked row", async () => {
  const w = world();
  w.config = { unreadable: "the file is not valid JSON" };
  // The protect list the file would have named is unknown, so even this card's shell stays.
  unit(w, "maybe-protected");
  finishedCard(w, "plain");
  const last = await rounds(w, 3, 30);
  assert.deepEqual(closes(w), []);
  assert.deepEqual(rms(w), []);
  assert.equal(last.roots_ok, false);
  assert.equal(last.mark_only, false, "not the no-config case");
  assert.ok(last.unseen.some((u) => u.includes("reaper config: the file is not valid JSON")), last.unseen.join("; "));
  assert.deepEqual(last.blocked, [{ kind: "config", ref: "reaper", reason: "config_unreadable" }]);
  assert.deepEqual(w.types("reap_blocked"), [{ kind: "config", ref: "reaper", reason: "config_unreadable" }]);
  assert.deepEqual(w.types("reap_candidate"), []);
  assertNeverForbidden(w);
  // Once the file reads again, the next rounds close the shell and sweep as usual.
  w.config = CONFIG;
  await rounds(w, 3, 30);
  assert.deepEqual(closes(w), [`terminalClose ${SHELL}`]);
});
