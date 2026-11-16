import assert from "node:assert/strict";
import { test } from "node:test";
import { recordHook, type SessionHook, type SessionHookInput, VERSION } from "../../core/index.ts";
import { createSessionWorld, type SessionWorld } from "./world.ts";

// Decision 333: a session's role and Run follow the Orca terminal and worktree it runs in, not the
// Claude Code session id or profile. /clear, an account-switch relaunch (`--resume <id>` without
// `--agent`, in a new terminal) and a resume under a new id keep the role, the Run and the owner's text.

const T1 = "term_00000000-0000-4000-8000-000000000001";
const T2 = "term_00000000-0000-4000-8000-000000000002";
const T3 = "term_00000000-0000-4000-8000-000000000003";
const BODY = "# 오케스트레이터\n\n너는 sangsoe 의 오케스트레이터다.";
const definition = (role: string) => (role === "orchestrator" ? BODY : undefined);

const hook = (w: SessionWorld, event: SessionHook, input: Partial<SessionHookInput> & { session_id: string }, terminal?: string) =>
  recordHook(event, w, { cwd: w.dir, ...input }, { pluginVersion: VERSION, agentDefinition: definition, ...(terminal ? { terminal } : {}) });

const psRow = (path: string, instance: string) => ({
  worktreeId: `repo_1::${path}`,
  worktreeInstanceId: instance,
  hostId: "local",
  repo: "api",
  path,
  branch: "b",
  isMainWorktree: false,
  isArchived: false,
  liveTerminalCount: 1,
  unverifiableTerminalCount: 0,
  status: "idle",
  agents: [],
});

/** An orchestrator the owner started with --agent in terminal T1, holding run_orch, in Orca worktree inst_a. */
async function started(): Promise<SessionWorld> {
  const w = createSessionWorld({ dispatched: false, heldRun: "run_orch" });
  w.psRows = [psRow(w.dir, "inst_a")];
  await hook(w, "session-start", { session_id: "o1", source: "startup", agent_type: "sangsoe:orchestrator" }, T1);
  w.heldRun = null;
  return w;
}

const said = (w: SessionWorld, session: string) =>
  w.store.events({ type: "owner_action" }).filter((e) => e.source === "UserPromptSubmit" && e.payload.cc_session === session).length;
const continued = (w: SessionWorld) => w.store.events({ type: "session_continued" }).map((e) => [e.payload.from, e.payload.to, e.payload.by]);
const REHOLD = "run-current 가 비었다. 자기 Run 을 다시 쥔다: orca orchestration run-use --id run_orch";

test("333: /clear without --agent in the same terminal keeps the role, the Run and the owner's text", async () => {
  const w = await started();
  const lines = await hook(w, "session-start", { session_id: "o2", source: "clear" }, T1);
  assert.equal(lines[0], "sangsoe-role: orchestrator");
  assert.ok(lines.includes(REHOLD), lines.join("\n"));
  assert.ok(lines.includes(BODY), "the role's definition rides along: no --agent gave it");
  assert.deepEqual(continued(w), [["o1", "o2", "terminal"]]);
  await hook(w, "user-prompt-submit", { session_id: "o2", prompt_id: "p1", prompt: "계속해" }, T1);
  assert.equal(said(w, "o2"), 1);
});

test("333: an account-switch relaunch (--resume <same id>, no --agent, a new terminal) keeps role, Run and the owner's text", async () => {
  const w = await started();
  const lines = await hook(w, "session-start", { session_id: "o1", source: "resume" }, T2);
  assert.equal(lines[0], "sangsoe-role: orchestrator");
  assert.ok(lines.includes(REHOLD), lines.join("\n"));
  assert.deepEqual(continued(w), [], "the same session id continues nothing");
  const last = w.store.events({ type: "session_started" }).at(-1);
  assert.equal(last?.payload.terminal, T2, "the row names the terminal it runs in now");
  await hook(w, "user-prompt-submit", { session_id: "o1", prompt_id: "p9", prompt: "d001: 첫째" }, T2);
  assert.equal(said(w, "o1"), 1);
});

test("333: a resume under a new session id in the same Orca worktree and a new terminal keeps role, Run and the owner's text", async () => {
  const w = await started();
  const lines = await hook(w, "session-start", { session_id: "o3", source: "resume" }, T3);
  assert.equal(lines[0], "sangsoe-role: orchestrator");
  assert.ok(lines.includes(REHOLD), lines.join("\n"));
  assert.deepEqual(continued(w), [["o1", "o3", "worktree"]]);
  await hook(w, "user-prompt-submit", { session_id: "o3", prompt_id: "p1", prompt: "좋아" }, T3);
  assert.equal(said(w, "o3"), 1);
});

test("333: a relaunch of every session at once keeps each one's own role by its terminal", async () => {
  const w = await started();
  await hook(w, "session-start", { session_id: "l1", source: "startup", agent_type: "sangsoe:lead" }, T2);
  // Orca closes both terminals and opens new ones; each resumes its own id.
  const o = await hook(w, "session-start", { session_id: "o1", source: "resume" }, T3);
  const l = await hook(w, "session-start", { session_id: "l1", source: "resume" }, "term_00000000-0000-4000-8000-000000000004");
  assert.equal(o[0], "sangsoe-role: orchestrator");
  assert.equal(l[0], "sangsoe-role: lead");
});

test("333: a fresh start without --agent is not taken for the role that ran there before (decision 192 stands for startup)", async () => {
  const w = await started();
  assert.deepEqual(await hook(w, "session-start", { session_id: "x1", source: "startup" }, T1), [], "same terminal");
  assert.deepEqual(await hook(w, "session-start", { session_id: "x2", source: "startup" }, T3), [], "same worktree");
  await hook(w, "user-prompt-submit", { session_id: "x1", prompt_id: "p1", prompt: "hello" }, T1);
  assert.equal(said(w, "x1"), 0);
});

test("333: a resume under a new id in another worktree and another terminal is no sangsoe session", async () => {
  const w = await started();
  w.psRows = [psRow(w.dir, "inst_b")];
  assert.deepEqual(await hook(w, "session-start", { session_id: "o4", source: "resume" }, T3), []);
  assert.deepEqual(continued(w), []);
});

test("333: a session that names its role with --agent keeps it; nothing is continued and no definition is added", async () => {
  const w = await started();
  const lines = await hook(w, "session-start", { session_id: "o5", source: "clear", agent_type: "sangsoe:orchestrator" }, T1);
  assert.equal(lines[0], "sangsoe-role: orchestrator");
  assert.equal(lines.includes(BODY), false);
  assert.ok(lines.includes(REHOLD), "its Run comes from the session it continues in this terminal");
});

test("333: an answer or approval line in a session sangsoe does not know says why it was not recorded", async () => {
  const w = createSessionWorld({ dispatched: false, heldRun: null });
  for (const prompt of ["d001: 첫째", `승인 acme/api#12 ${"a".repeat(40)}`]) {
    const out = await hook(w, "user-prompt-submit", { session_id: "u1", prompt_id: "p1", prompt }, T1);
    assert.equal(out.length, 1, prompt);
    assert.match(out[0] ?? "", /owner_action 으로 남기지 않았다/);
  }
  assert.deepEqual(await hook(w, "user-prompt-submit", { session_id: "u1", prompt_id: "p2", prompt: "그냥 말" }, T1), [], "ordinary words in someone else's session: silent");
  assert.equal(w.store.events().length, 0, "and nothing is written for it");
});

test("333: a session whose SessionStart was never recorded (sangsoe enabled mid-session) is registered by its first prompt when agent_type names the role", async () => {
  const w = createSessionWorld({ dispatched: false, heldRun: "run_orch" });
  const out = await hook(w, "user-prompt-submit", { session_id: "r1", agent_type: "sangsoe:orchestrator", prompt_id: "p1", prompt: "계속해" }, T1);
  assert.equal(out[0], "sangsoe-role: orchestrator", out.join("\n"));
  const rows = w.store.events({ type: "session_started" }).filter((e) => e.payload.session === "r1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.payload.role, "orchestrator");
  assert.equal(said(w, "r1"), 1);
  await hook(w, "user-prompt-submit", { session_id: "r1", agent_type: "sangsoe:orchestrator", prompt_id: "p2", prompt: "다음" }, T1);
  assert.equal(said(w, "r1"), 2);
  assert.equal(w.store.events({ type: "session_started" }).filter((e) => e.payload.session === "r1").length, 1, "registered once");
});

test("333: a Stop in a session never recorded registers it too when agent_type names the role", async () => {
  const w = createSessionWorld({ dispatched: false, heldRun: null });
  await hook(w, "stop", { session_id: "r2", agent_type: "sangsoe:lead" }, T1);
  assert.equal(w.store.events({ type: "session_started" }).filter((e) => e.payload.session === "r2").length, 1);
  assert.equal(w.store.events({ type: "turn_ended" }).filter((e) => e.payload.session === "r2").length, 1);
});

test("333: a resume in a worktree where sessions of two roles ran takes neither role and says why", async () => {
  const w = await started();
  await hook(w, "session-start", { session_id: "l1", source: "startup", agent_type: "sangsoe:lead" }, T2);
  const lines = await hook(w, "session-start", { session_id: "o9", source: "resume" }, T3);
  assert.equal(lines.length, 1, lines.join("\n"));
  assert.match(lines[0] ?? "", /역할을 잇지 않았다/);
  assert.equal(w.store.events({ type: "session_started" }).filter((e) => e.payload.session === "o9").length, 0);
  assert.deepEqual(continued(w), []);
});

test("333: an approval line the orchestrator's hook cannot take as an approval says why", async () => {
  const w = await started();
  const line = `승인 acme/api#12 ${"b".repeat(40)}`;
  const out = await hook(w, "user-prompt-submit", { session_id: "o1", prompt_id: "p1", prompt: line });
  assert.equal(said(w, "o1"), 1, "the words are still the owner's");
  assert.equal(w.store.events({ type: "owner_approval" }).length, 0);
  assert.ok(out.some((l) => /승인으로 남기지 않았다/.test(l) && /터미널/.test(l)), out.join("\n"));
});
