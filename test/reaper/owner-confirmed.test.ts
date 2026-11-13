// Decision 234: the panel's 정리 runs one round over the cards the owner confirmed. The confirmation
// stands in for the two sightings and the grace, for "finished" on a card no PR or Dispatch speaks
// for, and for the git checks on a checkout already gone; every other gate still blocks.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { recordResource, type WorktreeRow } from "../../core/index.ts";
import { assertNeverForbidden, card as anyCard, dropScratch, finishedCard as anyFinished, makeRepo, rounds, scratch, startedBySangsoe, worker, world } from "./harness.ts";

after(dropScratch);

type Card = WorktreeRow & { instanceId: string };
const card = (...a: Parameters<typeof anyCard>) => anyCard(...a) as Card;
const finishedCard = (...a: Parameters<typeof anyFinished>) => anyFinished(...a) as Card;
const rms = (w: ReturnType<typeof world>) => w.orca.calls.filter((c) => c.startsWith("worktreeRm"));

test("a confirmed finished card goes in the first round, with no second sighting or grace", async () => {
  const w = world();
  const c = finishedCard(w, "confirmed-now");
  const other = finishedCard(w, "not-confirmed");
  const r = await w.round({ trigger: "hint", confirmed: [c.instanceId] });
  assert.deepEqual(rms(w), [`worktreeRm id:${c.id}`]);
  assert.deepEqual(r.reaped, [`worktree:${c.instanceId}`]);
  assert.ok(!rms(w).some((x) => x.includes(other.id)), "a card the owner did not confirm stays");
  assertNeverForbidden(w);
});

test("confirmation does not override an uncommitted change, an open PR or a live session", async () => {
  const w = world();
  const dirty = finishedCard(w, "dirty");
  writeFileSync(join(dirty.path, "b.txt"), "unsaved\n");
  const open = finishedCard(w, "open-pr");
  w.gh.prs.push({ number: 99, state: "open", merged_at: null, head: { sha: "f".repeat(40), ref: "open-pr" } });
  const live = finishedCard(w, "live");
  w.orca.ps.push({ worktreeId: live.id, liveTerminalCount: 1, unverifiableTerminalCount: 0 } as never);
  const r = await w.round({ confirmed: [dirty.instanceId, open.instanceId, live.instanceId] });
  assert.deepEqual(rms(w), []);
  assert.deepEqual(r.blocked, [{ kind: "worktree", ref: dirty.instanceId, reason: "uncommitted" }]);
  assert.ok(r.marked.includes(open.instanceId) && r.marked.includes(live.instanceId));
  assert.ok(r.unseen.includes(`not a candidate now: ${open.instanceId}`));
});

test("a card with no PR and no Dispatch goes only when confirmed and pushed", async () => {
  const w = world();
  const pushed = card("smoke-pushed", makeRepo("smoke-pushed"));
  const local = card("smoke-local", makeRepo("smoke-local"));
  w.orca.cards.push(pushed, local);
  startedBySangsoe(w, pushed);
  w.gh.known.add(pushed.head ?? "");
  const unconfirmed = await w.round({});
  assert.deepEqual(unconfirmed.reaped, []);
  const r = await w.round({ confirmed: [pushed.instanceId, local.instanceId] });
  assert.deepEqual(r.reaped, [`worktree:${pushed.instanceId}`]);
  assert.deepEqual(r.blocked, [{ kind: "worktree", ref: local.instanceId, reason: "unpushed" }]);
});

test("a registration whose path is gone loses its Orca entry without git status, but an unpushed HEAD still blocks", async () => {
  const w = world();
  const repo = makeRepo("gone-base");
  const gone = card("gone", { path: join(scratch(), "no-such-dir"), head: repo.head });
  const local = card("gone-local", { path: join(scratch(), "no-such-dir-2"), head: makeRepo("gone-local").head });
  const headless = card("gone-headless", { path: join(scratch(), "no-such-dir-3"), head: "" });
  w.orca.cards.push(gone, local, headless);
  for (const c of [gone, local, headless]) startedBySangsoe(w, c);
  w.gh.known.add(repo.head ?? "");
  const r = await w.round({ confirmed: [gone.instanceId, local.instanceId, headless.instanceId] });
  assert.deepEqual(r.reaped.sort(), [`worktree:${gone.instanceId}`, `worktree:${headless.instanceId}`].sort());
  assert.deepEqual(r.blocked, [{ kind: "worktree", ref: local.instanceId, reason: "unpushed" }]);
  assert.ok(!rms(w).some((x) => x.includes(local.id)));
});

test("a confirmed round sweeps the Docker ids of the cards it removed, never one an earlier round left held", async () => {
  const w = world();
  finishedCard(w, "earlier");
  recordResource(w.store, { kind: "volume", ref: "earlier_data", owner: "inst-earlier" });
  w.docker.objects.set("earlier_data", { kind: "volume" });
  w.docker.state = "absent";
  await rounds(w, 3, 30);
  assert.ok(!w.types("reap_done").some((p) => p.ref === "earlier_data"));
  w.docker.state = "up";
  const c = finishedCard(w, "confirmed-only");
  // Held under the Task the card's work ran under: only this round can still map it to the card.
  w.orca.workers.push(worker(c.id, { taskId: "task_confirmed", dispatchId: "ctx_confirmed" }));
  recordResource(w.store, { kind: "container", ref: "c0nf1rm", owner: "task_confirmed" });
  w.docker.objects.set("c0nf1rm", { kind: "container", running: false });
  const r = await w.round({ confirmed: [c.instanceId] });
  assert.deepEqual(r.reaped, [`worktree:${c.instanceId}`, "container:c0nf1rm"]);
  assert.ok(!w.docker.objects.has("c0nf1rm"), "the confirmed card's own container goes with it");
  assert.ok(w.docker.objects.has("earlier_data"), "the owner confirmed one worktree, not a volume they never saw");
});

test("a confirmed round closes no released setup shell, which a timer round would (decision 202)", async () => {
  const w = world();
  const freed = finishedCard(w, "freed");
  const shell = "term_setup";
  w.store.append({
    type: "unit_started",
    source: "mcp:start_unit",
    entity: "task",
    entity_id: "task_freed",
    payload: { kind: "worker", picked_by: "role", model: "m", effort: "medium", route: "worktree_file", budget: 3, budget_per: "unit", used: 0, worktree: freed.id, shell, setup: "none" },
  });
  w.orca.workers.push(worker(freed.id, { terminalState: "released" }));
  w.orca.terminals.set(freed.id, [{ handle: shell }] as never);
  const named = finishedCard(w, "named");
  const r = await w.round({ confirmed: [named.instanceId] });
  assert.deepEqual(r.reaped, [`worktree:${named.instanceId}`]);
  assert.ok(!w.orca.calls.some((x) => x.startsWith("terminalClose")), w.orca.calls.join("\n"));
  const timer = await w.round();
  assert.deepEqual(timer.shells_closed, [shell], "the same shell is the timer round's to close");
});

test("no reaper config: a confirmed card is still not removed", async () => {
  const w = world();
  w.config = null;
  const c = finishedCard(w, "no-config");
  const r = await w.round({ confirmed: [c.instanceId] });
  assert.equal(r.mark_only, true);
  assert.deepEqual(rms(w), []);
});

test("explain on a dry run says why each candidate is one and writes nothing", async () => {
  const w = world();
  w.dryRun = true;
  const done = finishedCard(w, "explained");
  const before = w.store.events().length;
  const smoke = card("smoke", makeRepo("smoke"));
  w.orca.cards.push(smoke);
  const gone = card("gone2", { path: join(scratch(), "missing"), head: "e".repeat(40) });
  w.orca.cards.push(gone);
  const r = await w.round({ explain: true });
  const by = new Map(r.judged.map((j) => [j.ref, j]));
  assert.equal(by.get(done.instanceId)?.state, "finished");
  assert.equal(by.get(done.instanceId)?.why, "PR #1");
  assert.equal(by.get(smoke.instanceId)?.state, "no_trace");
  assert.equal(by.get(gone.instanceId)?.gone, true);
  assert.equal(w.store.events().length, before, "a dry run writes no row");
  assert.deepEqual(rms(w), []);
});
