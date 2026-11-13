import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { recordHook, type SessionHook, type SessionHookInput, VERSION } from "../../core/index.ts";
import { createSessionWorld, type SessionWorld } from "./world.ts";

// Decision 232: the Notification hook names the Orca worktree a session's wait was raised in, by
// Orca's path-free instance id, only when Orca shows a live terminal there; the orca-monitor reads
// that worktree's terminals later. Nothing else about the terminal is stored.

const hook = (w: SessionWorld, event: SessionHook, input: Partial<SessionHookInput> & { session_id: string }) =>
  recordHook(event, w, { cwd: w.dir, ...input }, { pluginVersion: VERSION });
const idle = { session_id: "s1", notification_type: "idle_prompt", message: "Claude is waiting for your input" };

const psRow = (path: string, instance: string, live: number) => ({
  worktreeId: `repo_1::${path}`,
  worktreeInstanceId: instance,
  hostId: "local",
  repo: "api",
  path,
  branch: "b",
  isMainWorktree: false,
  isArchived: false,
  liveTerminalCount: live,
  unverifiableTerminalCount: 0,
  status: "idle",
  agents: [],
});

async function orchestrator() {
  const w = createSessionWorld({ dispatched: false, heldRun: "run_orch" });
  await hook(w, "session-start", { session_id: "s1", source: "startup", agent_type: "sangsoe:orchestrator" });
  return w;
}

test("232: the wait names the innermost Orca worktree holding cwd that has a live terminal", async () => {
  const w = await orchestrator();
  w.psRows = [psRow("/", "inst_root", 1), psRow(w.dir, "inst_card", 1)];
  await hook(w, "notification", { ...idle, cwd: join(w.dir, "sub") });
  assert.deepEqual(
    w.store.events({ type: "waiting_human" }).map((e) => e.payload),
    [{ session: "s1", worktree: "inst_card", excerpt: "Claude is waiting for your input" }],
  );
});

test("232: no live terminal there, or ps unread: the wait names no worktree and only the age rule closes it", async () => {
  const w = await orchestrator();
  w.psRows = [psRow(w.dir, "inst_card", 0)];
  await hook(w, "notification", idle);
  await hook(w, "stop", { session_id: "s1", prompt_id: "p1" });
  w.psRows = null;
  await hook(w, "notification", idle);
  assert.deepEqual(
    w.store.events({ type: "waiting_human" }).map((e) => e.payload.worktree),
    [undefined, undefined],
  );
});

test("232: a truncated ps names no worktree: the page may hold an enclosing worktree and miss the session's own", async () => {
  const w = await orchestrator();
  w.psTruncated = true;
  w.psRows = [psRow("/", "inst_root", 1)];
  await hook(w, "notification", idle);
  assert.equal(w.store.events({ type: "waiting_human" })[0]?.payload.worktree, undefined);
});
