// Decision 234, blast radius of the confirmed 정리: one run over a fixture where every gate is armed at
// once. Only the clean listed card leaves Orca, only old per-call folders reach the trash command, and
// nothing else on the fixture changes.
import assert from "node:assert/strict";
import { existsSync, lutimesSync, mkdirSync, readdirSync, renameSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { type Exec, ownerReap, TMP_MIN_AGE_MS, type WorktreeRow } from "../../core/index.ts";
import { scratchDir } from "../scratch.ts";
import { assertNeverForbidden, CONFIG, card, dropScratch, finishedCard, makeRepo, startedBySangsoe, worker, world } from "./harness.ts";

after(dropScratch);

test("정리 over every armed gate removes only the clean listed card and trashes only old per-call folders", async () => {
  const w = world();
  const id = (c: WorktreeRow) => c.instanceId ?? "";
  const clean = finishedCard(w, "clean");
  const unlisted = finishedCard(w, "unlisted");
  const dirty = finishedCard(w, "dirty");
  writeFileSync(join(dirty.path, "b.txt"), "unsaved\n");
  const local = card("unpushed", makeRepo("unpushed"));
  w.orca.cards.push(local);
  startedBySangsoe(w, local);
  const open = finishedCard(w, "open-pr");
  w.gh.prs.push({ number: 99, state: "open", merged_at: null, head: { sha: "f".repeat(40), ref: "open-pr" } });
  const live = finishedCard(w, "live");
  w.orca.ps.push({ worktreeId: live.id, liveTerminalCount: 1, unverifiableTerminalCount: 0 } as never);
  const kept = finishedCard(w, "protected");
  w.config = { ...CONFIG, protect: [kept.path] };
  const listening = finishedCard(w, "listening");
  w.orca.listeners.set(listening.id, [{ id: "127.0.0.1:3000:1", port: 3000, pid: 1, owner: { worktreeId: listening.id, path: listening.path, confidence: "cwd" } }]);
  const stacked = finishedCard(w, "stacked");
  w.docker.stacks = [{ Name: "stacked", Status: "running(1)", ConfigFiles: join(stacked.path, "compose.yaml") }];
  const tasked = finishedCard(w, "open-task");
  w.orca.workers.push(worker(tasked.id, { dispatchId: "ctx_task" }));
  w.orca.taskStatus.set("task_1", "dispatched");
  const named = [clean, dirty, local, open, live, kept, listening, stacked, tasked];

  const now = Date.now();
  const root = scratchDir("blast-tmp-");
  const outside = scratchDir("blast-outside-");
  writeFileSync(join(outside, "keep.txt"), "x");
  const aged = (name: string, ms: number) => {
    const p = join(root, name);
    mkdirSync(p);
    utimesSync(p, (now - ms) / 1000, (now - ms) / 1000);
    return p;
  };
  const old = aged("sangsoe-hook-abc123", 2 * TMP_MIN_AGE_MS);
  const young = aged("sangsoe-session-young1", TMP_MIN_AGE_MS - 60_000);
  const other = aged("sangsoe-review-record-abc123", 2 * TMP_MIN_AGE_MS);
  // Old link to an old folder: only lstat and the directory check keep it out of the trash.
  const link = join(root, "sangsoe-pre-link01");
  symlinkSync(outside, link);
  const then = (now - 2 * TMP_MIN_AGE_MS) / 1000;
  utimesSync(outside, then, then);
  lutimesSync(link, then, then);
  const trash = scratchDir("blast-trash-");
  const calls: string[][] = [];
  const exec: Exec = async (file, args) => {
    calls.push([file, ...args]);
    for (const p of args) renameSync(p, join(trash, p.split("/").at(-1) ?? ""));
    return { code: 0, stdout: "", stderr: "" };
  };

  const out = await ownerReap(
    { run: (o) => w.round(o), exec, now: () => now, tmpRoot: root, uid: process.getuid?.() ?? -1, trashBin: "/fake/trash" },
    { worktrees: named.map(id), tmp: true },
  );

  assert.deepEqual(w.orca.calls.filter((c) => c.startsWith("worktreeRm")), [`worktreeRm id:${clean.id}`]);
  assert.deepEqual(out.reaped, [`worktree:${id(clean)}`]);
  const blocked = Object.fromEntries(out.blocked.map((b) => [b.ref, b.reason]));
  assert.deepEqual(blocked, { [id(dirty)]: "uncommitted", [id(local)]: "unpushed", [id(listening)]: "listener", [id(stacked)]: "compose_running" });
  for (const c of [open, live, kept, tasked]) assert.ok(out.skipped.includes(`not a candidate now: ${id(c)}`), `${id(c)}: ${out.skipped.join("; ")}`);
  assert.ok(!w.orca.calls.some((c) => c.includes(unlisted.id) && c.startsWith("worktreeRm")), "a card not listed stays");
  for (const c of [unlisted, dirty, local, open, live, kept, listening, stacked, tasked]) assert.ok(existsSync(c.path), c.path);
  assert.ok(!w.docker.calls.some((x) => / (rm|down|stop|kill|prune) /.test(` ${x} `)), w.docker.calls.join("\n"));
  assertNeverForbidden(w);

  assert.deepEqual(calls, [["/fake/trash", old]], "the trash command is the only file act, on the old per-call folder alone");
  assert.deepEqual(out.tmp, { moved: 1, left: 0 });
  for (const p of [young, other, link, join(outside, "keep.txt")]) assert.ok(existsSync(p), p);
  assert.deepEqual(readdirSync(trash), ["sangsoe-hook-abc123"]);
});
