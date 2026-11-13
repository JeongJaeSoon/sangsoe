// Decision 234: the panel's 정리 runs one round over the cards the owner confirmed. The confirmation
// stands in for the two sightings and the grace, for "finished" on a card no PR or Dispatch speaks
// for, and for the git checks on a checkout already gone; every other gate still blocks.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import type { WorktreeRow } from "../../core/index.ts";
import { assertNeverForbidden, card as anyCard, dropScratch, finishedCard as anyFinished, makeRepo, scratch, startedBySangsoe, world } from "./harness.ts";

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

test("a registration whose path is gone loses its Orca entry without a git check", async () => {
  const w = world();
  const repo = makeRepo("gone-base");
  const gone = card("gone", { path: join(scratch(), "no-such-dir"), head: repo.head });
  w.orca.cards.push(gone);
  startedBySangsoe(w, gone);
  const r = await w.round({ confirmed: [gone.instanceId] });
  assert.deepEqual(r.reaped, [`worktree:${gone.instanceId}`]);
  assert.deepEqual(rms(w), [`worktreeRm id:${gone.id}`]);
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
