import assert from "node:assert/strict";
import { test } from "node:test";
import { recordHook, type SessionHook, type SessionHookInput, VERSION } from "../../core/index.ts";
import { createSessionWorld, type SessionWorld } from "./world.ts";

// Decision 237: Claude Code's StopFailure hook says a turn ended on a lost login. A session holding
// no Dispatch (an orchestrator, a Run's lead) is seen nowhere else, so the hook writes its wait; a
// dispatched session is left to Orca's stop mail, which already carries the same stop.

const hook = (w: SessionWorld, event: SessionHook, input: Partial<SessionHookInput> & { session_id: string }) =>
  recordHook(event, w, { cwd: w.dir, ...input } as SessionHookInput, { pluginVersion: VERSION });
const lost = { session_id: "s1", error: "authentication_failed", last_assistant_message: "Please run /login · API Error: 403 Forbidden" };
const waits = (w: SessionWorld) => w.store.events({ type: "waiting_human" }).map((e) => e.payload);

async function orchestrator() {
  const w = createSessionWorld({ dispatched: false, heldRun: "run_orch" });
  await hook(w, "session-start", { session_id: "s1", source: "startup", agent_type: "sangsoe:orchestrator" });
  return w;
}

test("237: a lost login on a session holding no Dispatch is one waiting_human{cause auth}", async () => {
  const w = await orchestrator();
  await hook(w, "stop-failure", lost);
  assert.deepEqual(waits(w), [{ session: "s1", cause: "auth", excerpt: "Please run /login · API Error: 403 Forbidden" }]);
  await hook(w, "stop-failure", lost);
  await hook(w, "notification", { session_id: "s1", notification_type: "idle_prompt", message: "Claude is waiting for your input" });
  assert.equal(waits(w).length, 1, "the same stop is one wait: a repeat failure and the idle notice add nothing");
});

test("237: the session's next finished turn releases it", async () => {
  const w = await orchestrator();
  await hook(w, "stop-failure", lost);
  await hook(w, "stop", { session_id: "s1", prompt_id: "p1" });
  assert.deepEqual(
    w.store.events({ type: "waiting_released" }).map((e) => [e.payload.outcome, e.payload.evidence]),
    [["answered", "turn_ended"]],
  );
});

test("237: other API errors, a dispatched session and a session sangsoe does not know write nothing", async () => {
  const w = await orchestrator();
  for (const error of ["rate_limit", "server_error", "overloaded", "unknown"]) await hook(w, "stop-failure", { ...lost, error });
  assert.deepEqual(waits(w), []);

  const worker = createSessionWorld({ spec: "sangsoe-role: worker\nx", heldRun: null });
  await hook(worker, "session-start", { session_id: "s2", source: "startup" });
  await hook(worker, "stop-failure", { ...lost, session_id: "s2" });
  assert.deepEqual(waits(worker), [], "Orca's needs-input or errored mail carries a Dispatch's stop");

  const other = createSessionWorld({ dispatched: false });
  await hook(other, "stop-failure", lost);
  assert.deepEqual(waits(other), []);
});

test("237: oauth_org_not_allowed is a sign-in problem too", async () => {
  const w = await orchestrator();
  await hook(w, "stop-failure", { ...lost, error: "oauth_org_not_allowed", last_assistant_message: "" });
  assert.deepEqual(waits(w), [{ session: "s1", cause: "auth" }]);
});
