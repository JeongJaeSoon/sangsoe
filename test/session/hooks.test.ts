import assert from "node:assert/strict";
import { test } from "node:test";
import {
  answerNotifiedKey,
  DEFAULT_RESTART_RULES,
  handoffSave,
  mask,
  ownerMarks,
  recordHook,
  restart_due,
  reviewAskRecord,
  type SessionHook,
  type SessionHookInput,
  VERSION,
} from "../../core/index.ts";
import { bang, createSessionWorld, DISPATCH, type SessionWorld, TASK, TASK_RUN, transcript } from "./world.ts";

const hook = (w: SessionWorld, event: SessionHook, input: Partial<SessionHookInput> & { session_id: string }, pluginVersion?: string) =>
  recordHook(event, w, { cwd: w.dir, ...input }, { pluginVersion });
const types = (w: SessionWorld) => w.store.events().map((e) => e.type);

/** The decision rows U8's decision_answer leaves when d001, waited on by TASK, was answered. */
function answered(w: SessionWorld, answer = "Path versioning") {
  const a = w.store.appendOwnerAction({ type: "owner_action", source: "t", payload: { origin: "chat", summary: "s", hash: "h" } }, answer);
  w.store.append({ type: "decision_opened", source: "t", dedupe_key: "decision:k1", payload: { decision: "d001", decision_key: "k1", task: TASK, gate: "gate_1" } });
  w.store.append({ type: "decision_answered", source: "t", dedupe_key: "decision_answered:d001", payload: { decision: "d001", owner_action: a.seq, answer, linked_by: "button" } });
  w.store.append({ type: "decision_closed", source: "t", dedupe_key: "decision_closed:d001", payload: { decision: "d001", reason: "answered" } });
}

test("SessionStart injects role, Run, the last handoff once, a version line and late answers, in that order", async () => {
  const w = createSessionWorld({ spec: "sangsoe-role: lead\nrun the api program", heldRun: "run_lead" });
  w.mail.push({ id: "msg_1", type: "handoff", body: "old" }, { id: "msg_2", type: "status", body: "x" }, { id: "msg_3", type: "handoff", body: "## 다음에 할 일\nland U13" });
  answered(w);
  const lines = await hook(w, "session-start", { session_id: "s1", source: "startup" }, "0.0.1-other");
  assert.deepEqual(lines, [
    `sangsoe-role: lead · Task ${TASK} · Dispatch ${DISPATCH} · Run ${TASK_RUN}`,
    "Run run_lead 을 쥐고 있다(run-current).",
    "인계(handoff msg_3, 한 번만 싣는다):",
    "## 다음에 할 일\nland U13",
    `sangsoe 버전 어긋남: Claude Code plugin 0.0.1-other ≠ 코어 ${VERSION}. 오너에게 sangsoe install 을 알린다.`,
    "늦게 도착한 답(결정 91 ④): d001: Path versioning",
  ]);
  const started = w.store.events({ type: "session_started" })[0];
  assert.deepEqual(started?.payload, { session: "s1", role: "lead", model: "unknown" });
  assert.deepEqual([started?.entity_id, started?.subject, started?.target], [TASK, `run:${TASK_RUN}`, "run:run_lead"]);
  assert.ok(w.store.events({ type: "notified" }).some((e) => e.dedupe_key === answerNotifiedKey("d001", TASK).dedupe_key));
});

test("late_answer_reaches_next_worker: after /clear the new session gets neither the answer nor the handoff again", async () => {
  const w = createSessionWorld({ spec: "sangsoe-role: lead\nx", heldRun: "run_lead" });
  w.mail.push({ id: "msg_3", type: "handoff", body: "next" });
  answered(w);
  await hook(w, "session-start", { session_id: "s1", source: "startup" }, VERSION);
  const again = await hook(w, "session-start", { session_id: "s2", source: "clear", model: "claude-x" }, VERSION);
  assert.deepEqual(again, [`sangsoe-role: lead · Task ${TASK} · Dispatch ${DISPATCH} · Run ${TASK_RUN}`, "Run run_lead 을 쥐고 있다(run-current)."]);
  assert.equal(w.store.events({ type: "notified" }).length, 2, "one for the handoff, one for d001");
});

test("a lead whose Run binding is gone is told to run-use the Run its earlier session held", async () => {
  const w = createSessionWorld({ spec: "sangsoe-role: lead\nx", heldRun: "run_lead" });
  await hook(w, "session-start", { session_id: "s1", source: "startup" }, VERSION);
  w.heldRun = null;
  const lines = await hook(w, "session-start", { session_id: "s2", source: "clear" }, VERSION);
  assert.equal(lines[1], "run-current 가 비었다. 자기 Run 을 다시 쥔다: orca orchestration run-use run_lead");
});

/** The row item_create leaves for a Task sangsoe made (core/start/item.ts). */
function itemCreated(w: SessionWorld) {
  w.store.append({ type: "item_created", source: "core:item", entity: "task", entity_id: TASK, payload: { task: TASK, alias: "i001", who: "agent", done_when: "d", owner_action: 0 } });
}

test("a sangsoe session without a role line is worker_stuck{no_role_line}; a session the owner opened gets nothing", async () => {
  const w = createSessionWorld({ spec: "fix the login page" });
  itemCreated(w);
  const lines = await hook(w, "session-start", { session_id: "s1", source: "startup" });
  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? "", /no_role_line/);
  const stuck = w.store.events({ type: "worker_stuck" });
  assert.deepEqual(stuck.map((e) => [e.payload.reason, e.entity_id, e.dedupe_key]), [["no_role_line", TASK, `worker_stuck:${TASK}:no_role_line`]]);
  assert.equal(w.store.events({ type: "session_started" }).length, 0);

  const general = createSessionWorld({ dispatched: false });
  assert.deepEqual(await hook(general, "session-start", { session_id: "s9", source: "startup" }), []);
  assert.deepEqual(types(general), []);
  for (const e of ["user-prompt-submit", "stop", "notification", "post-tool-use", "post-compact", "session-end"] as const) {
    assert.deepEqual(await hook(general, e, { session_id: "s9", prompt: "d001 yes", message: "Claude needs your permission to use Bash", trigger: "auto" }), []);
  }
  assert.deepEqual(types(general), [], "no row for a session sangsoe did not start");
});

test("a Dispatch another tool started, with no item_created row and no role line, gets nothing (decision 46)", async () => {
  const w = createSessionWorld({ spec: "review the release" });
  assert.deepEqual(await hook(w, "session-start", { session_id: "f1", source: "startup" }), []);
  for (const e of ["user-prompt-submit", "stop", "notification", "post-tool-use", "post-compact", "session-end"] as const) {
    assert.deepEqual(await hook(w, e, { session_id: "f1", prompt: "d001 yes", message: "Claude needs your permission to use Bash", trigger: "auto" }), []);
  }
  assert.deepEqual(types(w), [], "no worker_stuck for a Task sangsoe does not own");
});

test("an orchestrator opened with --agent has no Task and still gets its role and Run", async () => {
  const w = createSessionWorld({ dispatched: false, heldRun: "run_orch" });
  const lines = await hook(w, "session-start", { session_id: "o1", source: "startup", agent_type: "sangsoe:orchestrator" }, VERSION);
  assert.deepEqual(lines, ["sangsoe-role: orchestrator", "Run run_orch 을 쥐고 있다(run-current)."]);
});

test("the owner's chat line is stored masked; one dNNN links through decision_answer, an iNNN alone links nothing", async () => {
  const w = createSessionWorld({ spec: "sangsoe-role: lead\nx", heldRun: TASK_RUN });
  await hook(w, "session-start", { session_id: "s1", source: "startup" }, VERSION);
  // Built at run time so no secret scanner sees a token-shaped literal.
  const secret = ["ghp", "Ab1".repeat(12)].join("_");
  await hook(w, "user-prompt-submit", { session_id: "s1", prompt_id: "p1", prompt: `i012 done, token ${secret}` });
  const a = w.store.events({ type: "owner_action" });
  assert.equal(a.length, 1);
  assert.equal(a[0]?.payload.origin, "chat");
  assert.ok(!JSON.stringify(a[0]?.payload).includes(secret));
  assert.ok(!(w.store.ownerText(a[0]?.seq ?? 0) ?? "").includes(secret));
  assert.equal(w.store.events({ type: "decision_answered" }).length, 0, "iNNN alone is not an explicit link");

  await hook(w, "user-prompt-submit", { session_id: "s1", prompt_id: "p3", prompt: "Please carry out this task from my Orca coordinator ..." });
  assert.equal(w.store.events({ type: "owner_action" }).length, 1, "Orca's own prompt is not the owner's");

  const o = createSessionWorld({ dispatched: false, heldRun: "run_orch" });
  await hook(o, "session-start", { session_id: "o1", source: "startup", agent_type: "sangsoe:orchestrator" }, VERSION);
  o.store.append({ type: "decision_opened", source: "t", dedupe_key: "decision:k1", payload: { decision: "d001", decision_key: "k1" } });
  await hook(o, "user-prompt-submit", { session_id: "o1", prompt_id: "p2", prompt: "d001: Path versioning" });
  await hook(o, "user-prompt-submit", { session_id: "o1", prompt_id: "p2", prompt: "d001: Path versioning" });
  const ans = o.store.events({ type: "decision_answered" });
  assert.deepEqual(ans.map((e) => [e.payload.decision, e.payload.linked_by]), [["d001", "hook"]]);
  assert.equal(o.store.events({ type: "owner_action" }).length, 1, "a repeated hook call writes nothing twice");
});

test("only an undispatched session's line that starts with the number answers a decision (M2)", async () => {
  const open = (w: SessionWorld) => {
    w.store.append({ type: "decision_opened", source: "t", dedupe_key: "decision:k1", payload: { decision: "d001", decision_key: "k1" } });
  };
  const answers = (w: SessionWorld) => w.store.events({ type: "decision_answered" }).length;

  const worker = createSessionWorld({ spec: "sangsoe-role: worker\nx", heldRun: TASK_RUN });
  await hook(worker, "session-start", { session_id: "s1", source: "startup" }, VERSION);
  open(worker);
  await hook(worker, "user-prompt-submit", { session_id: "s1", prompt_id: "p1", prompt: "d001: Path versioning" });
  assert.equal(answers(worker), 0, "a prompt in a dispatched session is not the owner's answer");

  // A lead whose Dispatch SessionStart could not find has no Task on its row; it is still not the owner.
  const lead = createSessionWorld({ dispatched: false, heldRun: "run_lead" });
  await hook(lead, "session-start", { session_id: "l1", source: "startup", agent_type: "sangsoe:lead" }, VERSION);
  open(lead);
  await hook(lead, "user-prompt-submit", { session_id: "l1", prompt_id: "p1", prompt: "d001: Path versioning" });
  assert.equal(answers(lead), 0, "only the orchestrator's session answers");

  const orch = createSessionWorld({ dispatched: false, heldRun: "run_orch" });
  await hook(orch, "session-start", { session_id: "o1", source: "startup", agent_type: "sangsoe:orchestrator" }, VERSION);
  open(orch);
  await hook(orch, "user-prompt-submit", { session_id: "o1", prompt_id: "p1", prompt: "status: the lead is still waiting on d001" });
  await hook(orch, "user-prompt-submit", { session_id: "o1", prompt_id: "p2", prompt: "d001 d002 both yes" });
  assert.equal(answers(orch), 0, "a line that only mentions the number, or names two, answers nothing");
  await hook(orch, "user-prompt-submit", { session_id: "o1", prompt_id: "p3", prompt: "  d001 Path versioning" });
  assert.equal(answers(orch), 1);

  // Decision 181 (Q1): a decision closes on the owner's answer that names it, and only that answer.
  const closed = (w: SessionWorld) => w.store.events({ type: "decision_closed" }).map((e) => [e.payload.decision, e.payload.reason]);
  assert.deepEqual(closed(worker), [], "a worker's line leaves the decision open");
  assert.deepEqual(closed(lead), [], "a lead's line leaves the decision open");
  assert.deepEqual(closed(orch), [["d001", "answered"]]);
});

test("waiting_human_released (hook side): the owner's words mark, the session moving releases, an end is moot", async () => {
  const w = createSessionWorld({ spec: "sangsoe-role: worker\nx" });
  await hook(w, "session-start", { session_id: "s1", source: "startup" }, VERSION);
  const ask = { session_id: "s1", notification_type: "permission_prompt", message: "Claude needs your permission to use Bash" };
  await hook(w, "notification", ask);
  await hook(w, "notification", ask);
  const waits = w.store.events({ type: "waiting_human" });
  assert.deepEqual(waits.map((e) => [e.payload.tool, e.entity_id]), [["Bash", TASK]], "a repeat for the same open wait writes nothing");
  assert.deepEqual(w.sends.map((s) => [s.to, s.type]), [[`run:${TASK_RUN}`, "escalation"]], "the owning lead is told first, once");

  await hook(w, "user-prompt-submit", { session_id: "s1", prompt_id: "p1", prompt: "yes go ahead" });
  await hook(w, "post-tool-use", { session_id: "s1", tool_name: "Read" });
  assert.equal(w.store.events({ type: "waiting_released" }).length, 0, "words and another tool release nothing");
  await hook(w, "post-tool-use", { session_id: "s1", tool_name: "Bash" });
  await hook(w, "stop", { session_id: "s1", prompt_id: "p1" });
  const rel = w.store.events({ type: "waiting_released" });
  assert.deepEqual(rel.map((e) => e.payload), [{ ref: String(waits[0]?.seq), outcome: "answered", by: "owner", evidence: "tool:Bash" }]);
  assert.deepEqual(rel.map((e) => e.entity_id), [TASK], "the release stays on the item's timeline");

  await hook(w, "notification", { session_id: "s1", notification_type: "idle_prompt", message: "Claude is waiting for your input" });
  await hook(w, "session-end", { session_id: "s1", reason: "clear" });
  const last = w.store.events({ type: "waiting_released" }).at(-1);
  assert.deepEqual([last?.payload.outcome, last?.payload.by, last?.payload.evidence], ["moot", "unknown", "session_ended"]);
  await hook(w, "notification", { session_id: "s1", notification_type: "auth_success", message: "ok" });
  assert.equal(w.store.events({ type: "waiting_human" }).length, 2, "a notification that is no wait writes nothing");
});

const ITEM = "task_000000000002";
const T0 = "2026-11-10T09:00:00.000Z";
const HINT = "gh workflow run promote-to-production.yml";

/** An orchestrator session and one open 🟢 owner item in its Run, made at T0, verified by a run in acme/api. */
async function ownerItemWorld(hint = HINT): Promise<SessionWorld> {
  const w = createSessionWorld({ dispatched: false, heldRun: "run_orch", clock: () => T0 });
  await hook(w, "session-start", { session_id: "o1", source: "startup", agent_type: "sangsoe:orchestrator" }, VERSION);
  w.runTasks.set("run_orch", [{ id: ITEM, status: "ready", title: "promote" }]);
  w.store.append({ type: "item_created", source: "t", payload: { task: ITEM, alias: "i001", who: "owner", done_when: "prod", owner_action: 0 }, entity: "task", entity_id: ITEM });
  w.store.append({ type: "item_extra_set", source: "t", payload: { task: ITEM, exec_by: "owner", cmd_hint: hint, verify: { kind: "run_ok", repo: "acme/api" } }, entity: "task", entity_id: ITEM });
  return w;
}

test("owner_ran_command_marks_verifying (input side): a `!` line marks one hinted item, never moves its state", async () => {
  const w = await ownerItemWorld(`${HINT} -R acme/api`);
  const t = transcript(w.dir, [
    ...bang("u1", "gh workflow run promote-to-production.yml -R acme/api --ref main", "https://github.com/acme/api/actions/runs/42"),
    ...bang("u2", "gh workflow run promote-to-production.yml -R acme/api", "", "HTTP 403: forbidden"),
    ...bang("u3", "gh workflow run other.yml -R acme/api", "https://github.com/acme/api/actions/runs/43"),
    ...bang("u4", "ls", "a b"),
    { type: "user", uuid: "u5", parentUuid: null, message: { content: "<bash-input>gh pr merge 3</bash-input>" } },
  ]);
  await hook(w, "stop", { session_id: "o1", prompt_id: "p1", transcript_path: t });
  await hook(w, "user-prompt-submit", { session_id: "o1", prompt_id: "p2", prompt: "ok", transcript_path: t });

  const shell = w.store.events({ type: "owner_action" }).filter((e) => e.payload.origin === "shell");
  assert.deepEqual(shell.map((e) => e.payload.cc_message), ["u1", "u2", "u3", "u4"], "each line once; an input without its output waits");
  const ev = w.store.events({ type: "evidence" });
  assert.deepEqual(ev.map((e) => [e.payload.kind, e.entity_id, e.payload.observed, e.dedupe_key]), [
    ["owner_act:seen", ITEM, "https://github.com/acme/api/actions/runs/42 gh workflow run promote-to-production.yml -R acme/api --ref main", "evidence:owner_act:u1"],
    ["owner_act:failed", ITEM, "exit ?: HTTP 403: forbidden", "evidence:owner_act:u2"],
  ]);
  assert.deepEqual(w.store.events({ type: "owner_act_unlinked" }).map((e) => [e.payload.act, e.dedupe_key]), [["gh workflow run other.yml -R acme/api", "owner_act_unlinked:owner_act:u3"]]);
  assert.equal(ownerMarks(view(w), { waitMinutes: 30 }).get(ITEM)?.mark, "verifying");
  assert.equal(w.store.events({ type: "item_transition" }).length, 0, "owner input alone never changes state");
});

const view = (w: SessionWorld) => ({ events: w.store.events(), orca: { tasks: [], gates: [] }, now: T0 });

test("the hook links by core/owner's rules: times not strings, the whole watch word, the item's repo, the expected URL, masked text", async () => {
  const w = await ownerItemWorld();
  // Built at run time so no secret scanner sees a token-shaped literal.
  const secret = ["ghp", "Zz9".repeat(12)].join("_");
  const t = transcript(w.dir, [
    // 08:30Z, before the item: string-greater than T0 but earlier in time (guard (가)).
    ...bang("a1", `${HINT} -R acme/api`, "https://github.com/acme/api/actions/runs/1", "", "2026-11-10T09:30:00+01:00"),
    ...bang("a2", "gh releases list", "v1.0.0"),
    ...bang("a3", `${HINT} -R acme/web`, "https://github.com/acme/web/actions/runs/2"),
    ...bang("a4", `${HINT} -R acme/api`, "see https://example.com/docs"),
    ...bang("a5", `${HINT} -R acme/api`, "", `HTTP 401: bad credentials ${secret}`),
    ...bang("a6", `gh pr merge 9 --body ${secret}`, ""),
  ]);
  await hook(w, "stop", { session_id: "o1", prompt_id: "p1", transcript_path: t });

  assert.ok(!w.store.events({ type: "owner_act_unlinked" }).some((e) => String(e.payload.act).startsWith("gh releases")), "`gh releases` is not the watched `gh release`");
  assert.deepEqual(
    w.store.events({ type: "evidence" }).map((e) => [e.dedupe_key, e.payload.kind]),
    [["evidence:owner_act:a5", "owner_act:failed"]],
    "a1 is older than the item, a3 is another repo, a4's URL is not the run the verify expects",
  );
  assert.deepEqual(
    w.store.events({ type: "owner_act_unlinked" }).map((e) => e.dedupe_key),
    ["owner_act_unlinked:owner_act:a1", "owner_act_unlinked:owner_act:a3", "owner_act_unlinked:owner_act:a6"],
  );
  assert.ok(!JSON.stringify(w.store.events()).includes(secret), "observed and act are stored masked");
});

test("rows the U13 hook wrote under the old keys are still read, and the same line is not linked twice", async () => {
  const w = await ownerItemWorld(`${HINT} -R acme/api`);
  const act = (uuid: string, command: string) =>
    w.store.appendOwnerAction(
      { type: "owner_action", source: "owner_input", entity: "task", entity_id: TASK, dedupe_key: `owner_action:o1:${uuid}`, payload: { origin: "shell", summary: command, hash: "h", cc_session: "o1", cc_message: uuid } },
      command,
    ).seq;
  const a = act("u1", `${HINT} -R acme/api`);
  w.store.append({ type: "evidence", source: "owner_input", entity: "task", entity_id: ITEM, subject: `owner_action:${a}`, dedupe_key: "evidence:u1:owner_act", payload: { kind: "owner_act:seen", observed: "https://github.com/acme/api/actions/runs/42" } });
  const b = act("u3", "gh workflow run other.yml -R acme/api");
  w.store.append({ type: "owner_act_unlinked", source: "owner_input", subject: `owner_action:${b}`, dedupe_key: "owner_act_unlinked:u3", payload: { act: "gh workflow run other.yml -R acme/api" } });

  const t = transcript(w.dir, [
    ...bang("u1", `${HINT} -R acme/api`, "https://github.com/acme/api/actions/runs/42"),
    ...bang("u3", "gh workflow run other.yml -R acme/api", ""),
  ]);
  await hook(w, "stop", { session_id: "o1", prompt_id: "p1", transcript_path: t });
  assert.deepEqual(w.store.events({ type: "evidence" }).map((e) => e.dedupe_key), ["evidence:u1:owner_act"]);
  assert.deepEqual(w.store.events({ type: "owner_act_unlinked" }).map((e) => e.dedupe_key), ["owner_act_unlinked:u3"]);
  const m = ownerMarks(view(w), { waitMinutes: 30 }).get(ITEM);
  assert.deepEqual([m?.mark, m?.run], ["verifying", "42"]);
});

test("Orca unreadable: the hook writes nothing for a new `!` line and reads it again next time", async () => {
  const w = await ownerItemWorld(`${HINT} -R acme/api`);
  const t = transcript(w.dir, bang("u1", `${HINT} -R acme/api`, "https://github.com/acme/api/actions/runs/42"));
  w.failTaskList = true;
  await hook(w, "stop", { session_id: "o1", prompt_id: "p1", transcript_path: t });
  assert.equal(w.store.events({ type: "owner_action" }).filter((e) => e.payload.origin === "shell").length, 0);
  w.failTaskList = false;
  w.failRunCurrent = true;
  await hook(w, "stop", { session_id: "o1", prompt_id: "p2", transcript_path: t });
  assert.equal(w.store.events({ type: "owner_action" }).filter((e) => e.payload.origin === "shell").length, 0, "run-current unanswered: the Run is unknown, so nothing yet");
  w.failRunCurrent = false;
  await hook(w, "stop", { session_id: "o1", prompt_id: "p3", transcript_path: t });
  assert.deepEqual(w.store.events({ type: "evidence" }).map((e) => e.payload.kind), ["owner_act:seen"]);
});

test("observed is masked before it is cut, so a token across the cut leaves no fragment", async () => {
  const w = await ownerItemWorld(`${HINT} -R acme/api`);
  const secret = ["ghp", "Qq7".repeat(12)].join("_");
  // observed is "<run URL> <command>"; this pad starts the token at character 490 of it.
  const pad = `--note ${"x".repeat(384)}`;
  const t = transcript(w.dir, bang("u1", `${HINT} -R acme/api ${pad} ${secret}`, "https://github.com/acme/api/actions/runs/42"));
  await hook(w, "stop", { session_id: "o1", prompt_id: "p1", transcript_path: t });
  const ev = w.store.events({ type: "evidence" });
  assert.equal(ev.length, 1);
  assert.ok(!String(ev[0]?.payload.observed).includes("ghp_"), "no token fragment survives the cut");
});

test("PostCompact writes compacted with the transcript's preTokens, and restart_due reads the four rules", async () => {
  const w = createSessionWorld({ spec: "sangsoe-role: lead\nx" });
  await hook(w, "session-start", { session_id: "s1", source: "startup" }, VERSION);
  const t = transcript(w.dir, [
    { type: "assistant", message: { usage: { input_tokens: 2, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 0 } } },
    { type: "system", subtype: "compact_boundary", compactMetadata: { trigger: "auto", preTokens: 120_000 } },
  ]);
  for (const p of ["c1", "c2", "c3"]) await hook(w, "post-compact", { session_id: "s1", prompt_id: p, trigger: "auto", transcript_path: t });
  await hook(w, "post-compact", { session_id: "s1", prompt_id: "c1", trigger: "auto", transcript_path: t });
  await hook(w, "post-compact", { session_id: "s1", prompt_id: "c9", trigger: "weird", transcript_path: t });
  const c = w.store.events({ type: "compacted" });
  assert.deepEqual(c.map((e) => e.payload.pre_tokens), [120_000, 120_000, 120_000]);
  await hook(w, "stop", { session_id: "s1", prompt_id: "p1", transcript_path: t });
  assert.equal(w.store.events({ type: "turn_ended" })[0]?.payload.context_tokens, 100_002);
  const due = restart_due({ orca: { tasks: [], gates: [] }, events: w.store.events(), now: "2026-11-10T00:00:00Z" }, DEFAULT_RESTART_RULES);
  assert.deepEqual(due.map((r) => r.rule).sort(), ["compaction_interval", "compactions", "first_call_half"]);
  const ceiling = restart_due({ orca: { tasks: [], gates: [] }, events: w.store.events(), now: "2026-11-10T00:00:00Z" }, { ...DEFAULT_RESTART_RULES, tokenCeiling: 100_000, maxAutoCompactions: 9, minIntervalMinutes: 0, firstCallShare: 2 });
  assert.deepEqual(ceiling, [{ session: "s1", rule: "token_ceiling" }]);
});

test("handoff_save checks the four fields, sends one handoff to the caller's own Run, and writes no row", async () => {
  const w = createSessionWorld({ heldRun: "run_lead" });
  const full = { next: "land U13", waiting: "없음", open_questions: "없음", reply_to: "run:run_orch" };
  const bad = await handoffSave(w, { ...full, waiting: " " });
  assert.equal(!bad.ok && bad.refusal.code, "bad_input");
  const extra = await handoffSave(w, { ...full, title: "x" });
  assert.equal(!extra.ok && extra.refusal.code, "bad_input");
  const r = await handoffSave(w, full);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(w.sends.map((s) => [s.to, s.type]), [["run:run_lead", "handoff"]]);
  assert.match(w.sends[0]?.body ?? "", /## 다음에 할 일\nland U13[\s\S]*## 오너 요청의 회신 경로\nrun:run_orch/);
  assert.deepEqual(types(w), []);
  w.heldRun = null;
  const none = await handoffSave(w, full);
  assert.equal(!none.ok && none.refusal.code, "no_run");
});

test("review_ask_record writes review_ask_sent and raises an unmapped reviewer once", () => {
  const w = createSessionWorld();
  assert.equal((reviewAskRecord(w.store, { pr: "acme/api#3", reviewer: "kim" }, new Set(["kim"])) as { ok: boolean }).ok, true);
  reviewAskRecord(w.store, { pr: "Acme/API#3", reviewer: "lee", reminder: true }, new Set(["kim"]));
  reviewAskRecord(w.store, { pr: "acme/api#4", reviewer: "lee" }, new Set(["kim"]));
  assert.deepEqual(w.store.events({ type: "review_ask_sent" }).map((e) => e.payload), [
    { pr: "acme/api#3", reviewer: "kim" },
    { pr: "acme/api#3", reviewer: "lee", reminder: true },
    { pr: "acme/api#4", reviewer: "lee" },
  ]);
  assert.equal(w.store.events({ type: "unmapped_reviewer" }).length, 1);
  const bad = reviewAskRecord(w.store, { pr: "not a pr", reviewer: "kim" }, new Set());
  assert.equal(!bad.ok && bad.refusal.code, "bad_input");
});

test("mask hides credentials and keeps a pasted git sha", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const out = mask(`password=hunter2 Authorization: Bearer abc.def sk-ABCDEFGHIJKLMNOPQRSTUVWX ${sha}`);
  assert.ok(!/hunter2|abc\.def|sk-ABC/.test(out), out);
  assert.ok(out.includes(sha));
  const env = mask(["DB", "PASSWORD=hunter3 APP", "SECRET: s3cr"].join("_"));
  assert.ok(!/hunter3|s3cr/.test(env), env);
});
