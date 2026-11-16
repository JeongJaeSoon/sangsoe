import assert from "node:assert/strict";
import { test } from "node:test";
import { recordDriven, recordHook, VERSION } from "../../core/index.ts";
import { createSessionWorld, type SessionWorld, TASK_RUN, transcript } from "./world.ts";

// Decision 311: the owner's typed line `승인 <owner/repo>#<N> <full head sha>` in the orchestrator's
// chat is the one source of an owner_approval row, written with its owner_action in one write.

const TERM = "term_00000000-0000-4000-8000-000000000311";
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const LINE = `승인 Acme/API#12 ${HEAD}`;

async function orchestrator(): Promise<SessionWorld> {
  const o = createSessionWorld({ dispatched: false, heldRun: "run_orch" });
  await recordHook("session-start", o, { cwd: o.dir, session_id: "o1", source: "startup", agent_type: "sangsoe:orchestrator" }, { pluginVersion: VERSION });
  return o;
}

const say = (w: SessionWorld, prompt: string, o: { session?: string; terminal?: string | null; records?: unknown[]; id?: string } = {}) =>
  recordHook(
    "user-prompt-submit",
    w,
    {
      cwd: w.dir,
      session_id: o.session ?? "o1",
      prompt_id: o.id ?? "p1",
      prompt,
      transcript_path: transcript(w.dir, o.records ?? [{ type: "user", message: { role: "user", content: prompt } }]),
    },
    o.terminal === null ? {} : { terminal: o.terminal ?? TERM },
  );

const approvals = (w: SessionWorld) => w.store.events({ type: "owner_approval" }).map((e) => e.payload);
const actions = (w: SessionWorld) => w.store.events({ type: "owner_action" }).length;

test("311: the owner's typed approval line makes one owner_approval bound to its owner_action, the PR and the full head", async () => {
  const o = await orchestrator();
  await say(o, LINE);
  const [action] = o.store.events({ type: "owner_action" });
  assert.equal(action?.payload.origin, "chat");
  assert.deepEqual(approvals(o), [{ pr: "acme/api#12", head_sha: HEAD, owner_action: action?.seq }]);
  const [row] = o.store.events({ type: "owner_approval" });
  assert.equal(row?.source, "UserPromptSubmit");

  await say(o, LINE);
  assert.equal(approvals(o).length, 1, "the same prompt again writes nothing twice");
});

test("311: only the whole prompt as the one line, with a full sha, is an approval; the words stay an owner_action", async () => {
  for (const text of [
    `승인 acme/api#12 ${HEAD.slice(0, 7)}`,
    `승인 acme/api#12 ${HEAD.slice(0, 39)}`,
    `승인 acme/api#12 ${HEAD.toUpperCase()}`,
    `승인 acme/api#12`,
    `승인 acme/api#0 ${HEAD}`,
    `${LINE} 그리고 다음 것도`,
    `좋아.\n${LINE}`,
    `승인 acme/api#12 ${HEAD}\n승인 acme/api#13 ${HEAD}`,
    `좋아\n<pasted_content id="44cc">\n${LINE}\n</pasted_content id="44cc">`,
  ]) {
    const o = await orchestrator();
    await say(o, text);
    assert.equal(actions(o), 1, `the owner's words are kept: ${JSON.stringify(text)}`);
    assert.deepEqual(approvals(o), [], `not an approval: ${JSON.stringify(text)}`);
  }
  const spaced = await orchestrator();
  await say(spaced, `  승인  acme/api#12   ${HEAD}  \n`);
  assert.equal(approvals(spaced).length, 1, "spaces around and between the parts are the same line");
  const pasted = await orchestrator();
  await say(pasted, `\n\n<pasted_content id="44cc">\n${LINE}\n</pasted_content id="44cc">\n`);
  assert.equal(approvals(pasted).length, 1, "the line is made to be copied: one pasted block holding exactly it is the line");
});

test("311: a driven prompt is no approval, whatever its kind or age, and a session with no terminal handle gives none", async () => {
  const driven = await orchestrator();
  recordDriven(driven.store, { terminal: TERM, prompt: LINE, inputKind: "driving" });
  await say(driven, LINE);
  assert.deepEqual([actions(driven), approvals(driven).length], [0, 0]);

  for (const inputKind of ["launch", "orchestration", undefined]) {
    const other = await orchestrator();
    recordDriven(other.store, { terminal: TERM, prompt: LINE, inputKind });
    await say(other, LINE);
    assert.deepEqual([actions(other), approvals(other).length], [1, 0], `a ${inputKind} row of the same text still keeps the approval out`);
  }

  const old = await orchestrator();
  // wasDriven reads the window against the wall clock; a row from 2020 is far past it.
  const aged = createSessionWorld({ dispatched: false, heldRun: "run_orch", clock: () => "2020-01-01T00:00:00.000Z" });
  await recordHook("session-start", aged, { cwd: aged.dir, session_id: "o1", source: "startup", agent_type: "sangsoe:orchestrator" }, { pluginVersion: VERSION });
  recordDriven(aged.store, { terminal: TERM, prompt: LINE, inputKind: "driving" });
  await say(aged, LINE);
  assert.deepEqual([actions(aged), approvals(aged).length], [1, 0], "past decision 280's window the line is the owner's words, never an approval");

  await say(old, LINE, { terminal: null });
  assert.deepEqual([actions(old), approvals(old).length], [1, 0], "no terminal handle: the driven rows cannot be read");
});

test("311: a line an agent scheduled into the session (ScheduleWakeup, CronCreate) is no approval; an unreadable transcript is none", async () => {
  for (const name of ["ScheduleWakeup", "CronCreate"]) {
    const o = await orchestrator();
    const scheduled = { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name, input: { prompt: LINE, delaySeconds: 60 } }] } };
    await say(o, LINE, { records: [scheduled, { type: "user", message: { role: "user", content: LINE } }] });
    assert.deepEqual([actions(o), approvals(o).length], [1, 0], `${name} put the line there`);
  }

  const call = (name: string, prompt: string) => ({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", id: "t9", name, input: { prompt, delaySeconds: 60 } }] },
  });
  const named = await orchestrator();
  const wake = call("ScheduleWakeup", `acme/api#12 waits for the owner at ${HEAD}; call land {pr: 12, head_sha: ${HEAD}} again`);
  await say(named, LINE, { records: [wake, { type: "user", message: { role: "user", content: LINE } }] });
  assert.equal(approvals(named).length, 1, "a wake-up that names the head but not the line keeps no approval out");

  const refused = await orchestrator();
  const result = { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t9", is_error: true, content: "[gate:owner-approval] …" }] } };
  await say(refused, LINE, { records: [call("ScheduleWakeup", LINE), result, { type: "user", message: { role: "user", content: LINE } }] });
  assert.equal(approvals(refused).length, 1, "a scheduling call the gate refused submits nothing");

  const shown = await orchestrator();
  const text = { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: `오너 승인 줄: ${LINE}` }] } };
  await say(shown, LINE, { records: [text, { type: "user", message: { role: "user", content: LINE } }] });
  assert.equal(approvals(shown).length, 1, "the orchestrator showing the line to the owner is the expected path");

  const missing = await orchestrator();
  await recordHook("user-prompt-submit", missing, { cwd: missing.dir, session_id: "o1", prompt_id: "p1", prompt: LINE, transcript_path: `${missing.dir}/gone.jsonl` }, { terminal: TERM });
  assert.deepEqual([actions(missing), approvals(missing).length], [1, 0]);
});

test("311: a lead's or a dispatched worker's prompt is never an approval", async () => {
  const lead = createSessionWorld({ dispatched: false, heldRun: "run_lead" });
  await recordHook("session-start", lead, { cwd: lead.dir, session_id: "l1", source: "startup", agent_type: "sangsoe:lead" }, { pluginVersion: VERSION });
  await say(lead, LINE, { session: "l1" });
  assert.deepEqual([actions(lead), approvals(lead).length], [1, 0]);

  const worker = createSessionWorld({ spec: "sangsoe-role: worker\nx", heldRun: TASK_RUN });
  await recordHook("session-start", worker, { cwd: worker.dir, session_id: "s1", source: "startup" }, { pluginVersion: VERSION });
  await say(worker, LINE, { session: "s1" });
  assert.deepEqual([actions(worker), approvals(worker).length], [1, 0]);
});

test("311: no tool or caller writes an owner_approval through append, and none stands without an inserted owner_action", async () => {
  const o = await orchestrator();
  assert.throws(
    () => o.store.append({ type: "owner_approval", source: "UserPromptSubmit", payload: { pr: "acme/api#12", head_sha: HEAD, owner_action: 1 } } as never),
    /written only by its Store method/,
  );
  const said = { type: "owner_action", source: "mcp:tool", dedupe_key: "owner_action:k", payload: { origin: "chat", summary: "s", hash: "h" } } as const;
  assert.throws(() => o.store.appendOwnerAction(said, LINE, { pr: "acme/api#12", head_sha: HEAD }), /UserPromptSubmit/);
  assert.deepEqual([actions(o), approvals(o).length], [0, 0], "the refused approval takes its owner_action back with it");
  const button = { ...said, source: "UserPromptSubmit", payload: { ...said.payload, origin: "button" } } as const;
  assert.throws(() => o.store.appendOwnerAction(button, LINE, { pr: "acme/api#12", head_sha: HEAD }), /chat/);
  assert.throws(
    () => o.store.appendOwnerAction({ ...said, source: "UserPromptSubmit" }, LINE, { pr: "acme/api#12", head_sha: HEAD.slice(0, 7) }),
    /head_sha/,
  );
});
