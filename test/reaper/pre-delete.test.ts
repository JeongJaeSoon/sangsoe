// Decision 194: the pre-delete checks the design lists before `worktree rm` (open Task, live
// session, evidence still in the card, a listener, a running compose stack) and the open-Task root.
// A hit skips the removal and writes reap_blocked; a read that fails is unknown; nothing is stopped.
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import type { WorktreeRow } from "../../core/index.ts";
import { assertNeverForbidden, finishedCard, rounds, scratch, dropScratch, worker, type World, world } from "./harness.ts";

after(dropScratch);

const rms = (w: World) => w.orca.calls.filter((c) => c.startsWith("worktreeRm"));
const HEAD = "a".repeat(40);

/** A finished card with one settled Dispatch in it (Task task_1, run_1). */
function withDispatch(w: World, name: string): WorktreeRow {
  const c = finishedCard(w, name);
  w.orca.workers.push(worker(c.id, { dispatchId: `ctx_${name}`, liveness: "exited" }));
  return c;
}

/** Changes the world at the second call of a read in the next round: the fresh read before the removal. */
function atSecondCall(w: World, method: "workerShow" | "taskList", change: () => void): void {
  const orca = w.orca as unknown as Record<string, (a: unknown) => Promise<unknown>>;
  const real = orca[method]?.bind(w.orca);
  if (!real) throw new Error(method);
  let n = 0;
  orca[method] = async (a) => {
    if (++n === 2) change();
    return real(a);
  };
}

function evidence(w: World, subject: string, path: string, kind = "test"): void {
  w.store.append({
    type: "evidence",
    source: "evidence record",
    subject,
    actor: "reviewer",
    payload: { kind, head_sha: HEAD, exit_code: 0, not_verified: ["prod"], path, sha256: "0".repeat(64) },
  });
}

/** An ignored file in the card: git status stays clean, so only the evidence check can hold it. */
function ignoredFile(c: WorktreeRow, rel: string): string {
  appendFileSync(join(c.path, ".git", "info", "exclude"), "out/\n");
  const at = join(c.path, rel);
  mkdirSync(join(at, ".."), { recursive: true });
  writeFileSync(at, "log\n");
  return at;
}

test("open-Task root (decision 177): an open Task keeps its card marked, never a candidate", async () => {
  const w = world();
  withDispatch(w, "open-root");
  w.orca.taskStatus.set("task_1", "dispatched");
  const last = await rounds(w, 3, 30);
  assert.equal(last.roots_ok, true, last.unseen.join("; "));
  assert.deepEqual(last.marked, ["inst-open-root"]);
  assert.deepEqual(w.types("reap_candidate"), []);
  assert.deepEqual(rms(w), []);
  assert.ok(w.orca.calls.includes("taskList run_1"));
});

test("open-Task root: a Task list that cannot be read is unknown, not a candidate", async () => {
  const w = world();
  withDispatch(w, "open-unread");
  w.orca.failing.add("taskList");
  const last = await rounds(w, 3, 30);
  assert.deepEqual(last.unknown, ["worktree:inst-open-unread"]);
  assert.deepEqual(w.types("reap_candidate"), []);
  assert.deepEqual(rms(w), []);
});

test("task_open: a Task reopened after the root read blocks the removal", async () => {
  const w = world();
  withDispatch(w, "reopened");
  await w.round();
  w.clock.now += 30 * 60_000;
  atSecondCall(w, "taskList", () => w.orca.taskStatus.set("task_1", "dispatched"));
  await w.round();
  assert.deepEqual(rms(w), []);
  assert.deepEqual(w.types("reap_blocked"), [{ kind: "worktree", ref: "inst-reopened", reason: "task_open" }]);
  assertNeverForbidden(w);
});

test("session_alive: a session Orca calls live at the removal blocks it", async () => {
  const w = world();
  withDispatch(w, "alive");
  await w.round();
  w.clock.now += 30 * 60_000;
  atSecondCall(w, "workerShow", () => w.orca.showLiveness.set("ctx_alive", "live"));
  await w.round();
  assert.deepEqual(rms(w), []);
  assert.deepEqual(w.types("reap_blocked"), [{ kind: "worktree", ref: "inst-alive", reason: "session_alive" }]);
  assert.ok(!w.orca.calls.some((c) => /release|terminal|stop/i.test(c)), "the session is not stopped");
});

test("session_alive at the root: a settled Dispatch whose session is live keeps the card", async () => {
  const w = world();
  withDispatch(w, "alive-root");
  w.orca.showLiveness.set("ctx_alive-root", "live");
  const last = await rounds(w, 3, 30);
  assert.deepEqual(last.marked, ["inst-alive-root"]);
  assert.deepEqual(rms(w), []);
});

test("evidence_in_worktree: the PR's evidence file still in the card blocks, by relative or absolute path", async () => {
  for (const form of ["relative", "absolute"] as const) {
    const w = world();
    const c = finishedCard(w, `ev-${form}`);
    const at = ignoredFile(c, "out/test.log");
    evidence(w, "acme/api#1", form === "relative" ? "out/test.log" : at);
    await rounds(w, 3, 30);
    assert.deepEqual(rms(w), [], form);
    assert.deepEqual(w.types("reap_blocked"), [{ kind: "worktree", ref: `inst-ev-${form}`, reason: "evidence_in_worktree" }], form);
  }
});

test("evidence_in_worktree: a newer row outside the card, a missing file, a sibling path or another PR's relative path does not block", async () => {
  const w = world();
  const c = finishedCard(w, "ev-clear");
  ignoredFile(c, "out/test.log");
  mkdirSync(`${c.path}-other/out`, { recursive: true });
  writeFileSync(`${c.path}-other/out/test.log`, "log\n");
  evidence(w, "acme/api#1", "out/test.log");
  evidence(w, "acme/api#1", join(scratch(), "kept", "test.log"));
  evidence(w, "acme/api#1", join(c.path, "out", "gone.log"), "run");
  evidence(w, "acme/api#1", `${c.path}-other/out/test.log`, "ui");
  evidence(w, "acme/api#99", "out/test.log");
  await rounds(w, 3, 30);
  assert.deepEqual(w.types("reap_blocked"), []);
  assert.deepEqual(rms(w), [`worktreeRm id:${c.id}`]);
});

test("listener: a port Orca ties to the card blocks; nothing is killed", async () => {
  const w = world();
  const c = finishedCard(w, "listening");
  w.orca.listeners.set(c.id, [{ id: "127.0.0.1:3000:4242", port: 3000, pid: 4242, owner: { worktreeId: c.id, path: c.path, confidence: "cwd" } }]);
  await rounds(w, 3, 30);
  assert.ok(w.orca.calls.includes(`ports id:${c.id}`));
  assert.deepEqual(rms(w), []);
  assert.deepEqual(w.types("reap_blocked"), [{ kind: "worktree", ref: "inst-listening", reason: "listener" }]);
  assertNeverForbidden(w);
});

test("listener: a ports read that fails is unknown and removes nothing", async () => {
  const w = world();
  finishedCard(w, "ports-down");
  w.orca.failing.add("ports");
  const last = await rounds(w, 3, 30);
  assert.deepEqual(rms(w), []);
  assert.deepEqual(w.types("reap_blocked"), []);
  assert.deepEqual(last.unknown, ["worktree:inst-ports-down: ports: non_local_host"]);
});

test("compose_running: a running stack whose config file is in the card blocks; no down", async () => {
  const w = world();
  const c = finishedCard(w, "stacked");
  w.docker.stacks = [
    { Name: "other", Status: "running(2)", ConfigFiles: "/elsewhere/compose.yaml" },
    { Name: "stacked", Status: "running(1), exited(1)", ConfigFiles: `/elsewhere/base.yaml,${join(c.path, "compose.yaml")}` },
  ];
  await rounds(w, 3, 30);
  assert.deepEqual(rms(w), []);
  assert.deepEqual(w.types("reap_blocked"), [{ kind: "worktree", ref: "inst-stacked", reason: "compose_running" }]);
  assert.ok(!w.docker.calls.some((x) => / (down|stop|rm) /.test(` ${x} `)), w.docker.calls.join("\n"));
});

test("compose_running: an exited stack or a sibling path does not block, and a daemon that is down skips the check", async () => {
  const w = world();
  const c = finishedCard(w, "stack-free");
  w.docker.stacks = [
    { Name: "done", Status: "exited(1)", ConfigFiles: join(c.path, "compose.yaml") },
    { Name: "sibling", Status: "running(1)", ConfigFiles: `${c.path}-2/compose.yaml` },
  ];
  await rounds(w, 3, 30);
  assert.deepEqual(rms(w), [`worktreeRm id:${c.id}`]);

  const off = world();
  const d = finishedCard(off, "no-daemon");
  off.docker.daemon = false;
  await rounds(off, 3, 30);
  assert.deepEqual(rms(off), [`worktreeRm id:${d.id}`]);
  assert.deepEqual(
    off.types("reap_round").map((x) => x.docker_skipped),
    [false, true, false],
    "the removal round skipped the compose read",
  );
  assert.deepEqual(off.docker.calls, ["version --format {{.Server.Version}}"]);
});

test("compose_running: a compose list that cannot be read is unknown and removes nothing", async () => {
  const w = world();
  finishedCard(w, "compose-unread");
  w.docker.composeError = true;
  const last = await rounds(w, 3, 30);
  assert.deepEqual(rms(w), []);
  assert.deepEqual(last.unknown, ["worktree:inst-compose-unread: docker compose ls failed"]);
});
