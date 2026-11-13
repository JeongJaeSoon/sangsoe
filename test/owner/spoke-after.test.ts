// An owner_action that names no session (a panel button, a shell command) is not the owner answering
// a wait that names no session either (a Dispatch's wait from Orca's mail): undefined is not a match.
import assert from "node:assert/strict";
import { test } from "node:test";
import { awaitingResume } from "../../core/index.ts";
import { ownerWorld } from "./world.ts";

test("an owner_action without cc_session does not mark a Dispatch's wait 입력 확인됨", () => {
  const w = ownerWorld();
  const dispatchWait = w.store.append({
    type: "waiting_human",
    source: "orca-monitor",
    entity: "task",
    entity_id: "task_a",
    payload: { dispatch: "ctx_a" },
  });
  const sessionWait = w.store.append({ type: "waiting_human", source: "Notification", payload: { session: "s1" } });
  w.store.appendOwnerAction({ type: "owner_action", source: "plugin:panel", payload: { origin: "button", summary: "d001 yes", hash: "h1" } }, "d001 yes");
  assert.deepEqual(awaitingResume(w.input()), [], "neither wait was answered");

  w.store.appendOwnerAction({ type: "owner_action", source: "UserPromptSubmit", payload: { origin: "chat", summary: "go", hash: "h2", cc_session: "s1" } }, "go");
  assert.deepEqual(awaitingResume(w.input()), [sessionWait.seq], "the owner's words on s1 answer s1's wait only");
  assert.notEqual(dispatchWait.seq, sessionWait.seq);
});
