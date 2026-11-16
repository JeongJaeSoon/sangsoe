import { dedupeKey, EVENTS, type StoredEvent } from "../contract/index.ts";
import { decisionAnswer } from "../decision/answer.ts";
import { syncOwnRun } from "../graph/own-run.ts";
import { advisorCalls } from "../models/spend.ts";
import { readDecision } from "../decision/waiters.ts";
import type { CoreDeps } from "../notify/result.ts";
import { deliverOwnRun } from "../detect/queue/own-run.ts";
import { carriesApproval, type OwnerApprovalLine, parseApprovalLine } from "../owner/approval.ts";
import { mayBeDriven, wasDriven } from "../owner/driven.ts";
import { classifyPrompt, unwrapPaste } from "../owner/prompt.ts";
import { openWaits, RELEASE_READS, type ReleaseSignal, recordReleases } from "../owner/release.ts";
import type { Store } from "../store/store.ts";
import { agentRole, liveWorktree } from "./locate.ts";
import { hashOf, mask, summarize } from "./mask.ts";
import { type SessionHookInput, type SessionRow, sessionOf } from "./session.ts";
import { sessionStart, type SessionStartOptions } from "./session-start.ts";
import { recordShellInputs } from "./shell.ts";
import { lastContextTokens, lastPreTokens, marked, scheduledWith, tail } from "./transcript.ts";

export const SESSION_HOOKS = [
  "session-start",
  "user-prompt-submit",
  "stop",
  "stop-failure",
  "notification",
  "post-tool-use",
  "post-compact",
  "session-end",
] as const;
export type SessionHook = (typeof SESSION_HOOKS)[number];

const HOOK_NAMES: Record<SessionHook, string> = {
  "session-start": "SessionStart",
  "user-prompt-submit": "UserPromptSubmit",
  stop: "Stop",
  "stop-failure": "StopFailure",
  notification: "Notification",
  "post-tool-use": "PostToolUse",
  "post-compact": "PostCompact",
  "session-end": "SessionEnd",
};

/**
 * One recording hook call. Returns the lines to print: SessionStart and UserPromptSubmit print (their
 * stdout is injected context; UserPromptSubmit at most the Run's one count line, decision 274); every
 * other hook prints nothing. A session with no session_started row is not sangsoe's and gets no write
 * and no Orca call.
 */
export async function recordHook(event: SessionHook, deps: CoreDeps, input: SessionHookInput, opts: SessionStartOptions = {}): Promise<string[]> {
  if (event === "session-start") return sessionStart(deps, input, opts);
  let row = sessionOf(deps.store, input.session_id);
  const registered: string[] = [];
  // Decision 333: a session whose SessionStart was never recorded (sangsoe enabled mid-session, a start
  // that failed) is registered by its first later hook that names the role the way SessionStart would.
  // Not from a subagent's hook, whose agent_type is the subagent's, nor from PostToolUse, which subagents share.
  if (!row && event !== "post-tool-use" && !input.agent_id && agentRole(input.agent_type)) {
    const lines = await sessionStart(deps, { ...input, source: "late" }, { ...opts, deliver: event === "user-prompt-submit", writer: HOOK_NAMES[event] });
    if (event === "user-prompt-submit") registered.push(...lines);
    row = sessionOf(deps.store, input.session_id);
  }
  if (!row) return event === "user-prompt-submit" ? notRecorded(deps.store, input.prompt ?? "") : [];
  switch (event) {
    case "user-prompt-submit": {
      await recordShellInputs(deps, row, input.session_id, input.transcript_path);
      const why = await ownerSaid(deps, row, input, opts.terminal);
      // Decision 274: this prompt's context gets the Run's one count line; Claude Code injects the stdout.
      return [...registered, ...why, ...(await ownRun(deps, row, input))];
    }
    case "stop": {
      await recordShellInputs(deps, row, input.session_id, input.transcript_path);
      advisorUsed(deps.store, row, input);
      turnEnded(deps.store, row, input);
      released(deps.store, { kind: "turn_ended", session: input.session_id }, "Stop");
      await workerIdle(deps, row, input);
      // Stop makes only the re-review items (no Orca call unless one is pending); the Run's deliveries
      // ride the next prompt, which is how every Orca wake arrives (decision 274).
      await syncOwnRun(deps, row.role, new Date().toISOString());
      break;
    }
    case "stop-failure":
      await lostLogin(deps, row, input);
      break;
    case "notification":
      await waitingHuman(deps, row, input);
      break;
    case "post-tool-use":
      if (input.tool_name) released(deps.store, { kind: "tool", session: input.session_id, tool: input.tool_name }, "PostToolUse");
      break;
    case "post-compact":
      compacted(deps.store, row, input);
      break;
    case "session-end":
      await recordShellInputs(deps, row, input.session_id, input.transcript_path);
      advisorUsed(deps.store, row, input);
      released(deps.store, { kind: "session_ended", session: input.session_id, evidence: "session_ended" }, "SessionEnd");
      break;
  }
  return [];
}

/**
 * What a Run's own session does for its Run on each prompt (decisions 219, 274): the re-review items
 * and the deliveries the plugin cannot make. A worker holds no Run and makes no Orca call; anyone
 * else reads run-current once, then its Run's Tasks and gates.
 */
async function ownRun(deps: CoreDeps, row: SessionRow, input: SessionHookInput): Promise<string[]> {
  if (row.role === "worker") return [];
  const now = new Date().toISOString();
  const current = await deps.orca.runCurrent();
  const run = current.ok && typeof current.value.runId === "string" && current.value.runId !== "" ? current.value.runId : null;
  await syncOwnRun(deps, row.role, now, run);
  if (!run) return [];
  await holds(deps, row, input, run);
  const own = await deliverOwnRun(deps, run, now);
  return "lines" in own ? [...own.lines] : [];
}

/**
 * Decision 273: a session takes its Run after it starts (run-create, run-use), so the row SessionStart
 * wrote names none. The first prompt that finds a Run held, or another Run than the row names, writes
 * the session's row again with that Run, so the next start in this place can be told to take it back.
 * A session with no Task also gets the worktree it runs in, read now: a row from before this decision
 * has none, and a copy of it would never match. One worktree-ps read, only while something is missing.
 */
async function holds(deps: CoreDeps, row: SessionRow, input: SessionHookInput, run: string): Promise<void> {
  const placed = row.task !== undefined || row.worktree !== undefined;
  if (run === row.heldRun && placed) return;
  const worktree = placed ? row.worktree : await liveWorktree(deps.orca, input.cwd);
  if (run === row.heldRun && !worktree) return;
  const last = deps.store.events({ type: "session_started" }).findLast((e) => e.payload.session === input.session_id);
  if (!last) return;
  deps.store.append({
    type: "session_started",
    source: "UserPromptSubmit",
    ...(last.entity && last.entity_id ? { entity: last.entity, entity_id: last.entity_id } : {}),
    ...(last.subject ? { subject: last.subject } : {}),
    target: `run:${run}`,
    dedupe_key: dedupeKey(EVENTS.session_started, input.session_id, "held", String(last.seq)),
    payload: {
      session: input.session_id,
      role: row.role,
      model: String(last.payload.model ?? "unknown"),
      ...(typeof last.payload.tier === "string" ? { tier: last.payload.tier } : {}),
      ...(typeof last.payload.effort === "string" ? { effort: last.payload.effort } : {}),
      ...(worktree ? { worktree } : {}),
    },
  });
}

/** Decision 91①: the session moving again, or ending, releases its waits; core/owner decides which. */
const released = (store: Store, signal: ReleaseSignal, source: string) => {
  // Every tool call lands here: read only the rows a release looks at, in log order.
  const events = RELEASE_READS.flatMap((type) => store.events({ type })).sort((a, b) => a.seq - b.seq);
  return recordReleases(store, { events }, signal, source);
};

const DECISION_NO = /\bd\d{3,}\b/g;
const ANSWER_SHAPE = /^\s*(d\d{3,})\b/;

/**
 * The owner's chat line: owner_action with the masked text in owner_text. Decision 173: only the
 * orchestrator's session, holding no Dispatch, answers, and only with a line that starts with the dNNN and names no other
 * decision; it links through U8's decision_answer (linked_by=hook). A dispatched session's prompt can
 * be another session's message, so it never answers.
 */
async function ownerSaid(deps: CoreDeps, row: SessionRow, input: SessionHookInput, terminal: string | undefined): Promise<string[]> {
  const text = input.prompt ?? "";
  if (classifyPrompt(text) !== "owner") return [];
  // Decision 280: text Orca reported as driven into this terminal was typed by no person. No row: it
  // answers no decision, marks no wait as the owner's, and is no owner_action a tool could cite.
  const driven = deps.store.events({ type: "prompt_driven" });
  if (wasDriven(driven, terminal, text, Date.now())) {
    return weighty(deps.store, text) ? [`sangsoe: Orca 가 이 터미널에 밀어 넣은 글(prompt_driven)이라 ${NOT_RECORDED}`] : [];
  }
  const checked = ownerApproval(row, input, terminal, driven);
  const approval = checked && "pr" in checked ? checked : null;
  const why = checked && "reason" in checked ? [`sangsoe: 이 줄을 승인으로 남기지 않았다(owner_action 으로는 남겼다): ${checked.reason}.`] : [];
  const masked = mask(text);
  const key = dedupeKey(EVENTS.owner_action, input.session_id, input.prompt_id ?? hashOf(`${masked}\n${tail(input.transcript_path).length}`));
  const action = deps.store.appendOwnerAction(
    {
      type: "owner_action",
      source: "UserPromptSubmit",
      ...(row.task ? { entity: "task", entity_id: row.task } : {}),
      dedupe_key: key,
      payload: {
        origin: "chat",
        summary: summarize(masked),
        hash: hashOf(masked),
        cc_session: input.session_id,
        ...(input.prompt_id ? { cc_message: input.prompt_id } : {}),
      },
    },
    masked,
    approval ?? undefined,
  );
  if (!action.inserted) return [];
  // The orchestrator is the owner's session; a lead or worker whose Dispatch locate() missed is not.
  if (row.task || row.role !== "orchestrator") return why;
  const named = [...new Set(text.match(DECISION_NO) ?? [])];
  const d = named.length === 1 ? ANSWER_SHAPE.exec(text)?.[1] : undefined;
  if (!d || !readDecision(deps.store, d)) return why;
  const current = await deps.orca.runCurrent();
  const callerRun = current.ok && typeof current.value.runId === "string" ? current.value.runId : "";
  // A refusal (an owner_action already used, a moot close) is the record's answer; the hook stays silent.
  await decisionAnswer(deps, { decision: d, answer: masked, ownerAction: action.seq, linkedBy: "hook", callerRun });
  return why;
}

const NOT_RECORDED = "이 결정 답·승인 줄을 owner_action 으로 남기지 않았다";

/**
 * An approval line, or a line that starts with a decision the store has: the prompts whose loss blocks
 * something, so their loss is said (decision 333). Any other session's words that happen to start
 * with a dNNN stay silent.
 */
function weighty(store: Store, text: string): boolean {
  if (parseApprovalLine(text) !== null) return true;
  const d = ANSWER_SHAPE.exec(unwrapPaste(text))?.[1];
  return d !== undefined && readDecision(store, d) !== undefined;
}

/**
 * Decision 333: a prompt in a session with no session_started row writes nothing (decision 192). An
 * answer or an approval line there says so, since the owner typed it to be recorded; other words stay silent.
 */
function notRecorded(store: Store, text: string): string[] {
  if (classifyPrompt(text) !== "owner" || !weighty(store, text)) return [];
  return [
    `sangsoe: 이 세션은 sangsoe 의 기록(session_started)이 없어 ${NOT_RECORDED}. 오너에게 알린다: 오케스트레이터를 claude --agent sangsoe:orchestrator 로 다시 띄운 뒤(같은 대화는 --resume <id>) 그 줄을 다시 친다.`,
  ];
}

/**
 * Decision 311: the approval line in the orchestrator's own session, holding no Dispatch, that no one
 * but the owner can have put there. Each test fails closed: a terminal Orca may have driven it into,
 * a scheduling tool that carried its head, a transcript that cannot be read. An approval line that
 * fails one gets the reason (decision 333); any other prompt gets null.
 */
function ownerApproval(
  row: SessionRow,
  input: SessionHookInput,
  terminal: string | undefined,
  driven: readonly StoredEvent[],
): OwnerApprovalLine | { reason: string } | null {
  const line = parseApprovalLine(input.prompt ?? "");
  if (!line) return null;
  if (row.task || row.role !== "orchestrator") return { reason: `오케스트레이터 세션이 아니다(${row.role}${row.task ? `, Task ${row.task}` : ""})` };
  if (!terminal) return { reason: "이 세션의 Orca 터미널 handle(ORCA_TERMINAL_HANDLE)이 없다" };
  if (mayBeDriven(driven, terminal, input.prompt ?? "")) return { reason: "이 터미널에 같은 글을 Orca 가 밀어 넣은 기록(prompt_driven)이 있다" };
  const scheduled = scheduledWith(input.transcript_path, line.head_sha, (s) => carriesApproval(s, line.head_sha));
  if (scheduled === null) return { reason: "transcript 를 읽지 못했다" };
  if (scheduled) return { reason: "이 세션이 이 head 를 실은 ScheduleWakeup·CronCreate 를 불렀다" };
  return line;
}

/**
 * Decision 200: each advisor call in the whole transcript, once. Every Stop reads the calls again,
 * so the call's own key is the dedupe key, without the session: a resumed session under a new id
 * carries the same records. Subagents' own transcripts are not read (undercount).
 */
function advisorUsed(store: Store, row: SessionRow, input: SessionHookInput): void {
  for (const c of advisorCalls(marked(input.transcript_path, "advisor_message"))) {
    store.append({
      type: "advisor_used",
      source: "Stop",
      ...(row.task ? { entity: "task", entity_id: row.task } : {}),
      dedupe_key: dedupeKey(EVENTS.advisor_used, c.key),
      payload: { session: input.session_id, msg: c.key, model: c.model, input_tokens: c.input, output_tokens: c.output },
    });
  }
}

function turnEnded(store: Store, row: SessionRow, input: SessionHookInput): void {
  const tokens = lastContextTokens(tail(input.transcript_path));
  store.append({
    type: "turn_ended",
    source: "Stop",
    ...(row.task ? { entity: "task", entity_id: row.task } : {}),
    dedupe_key: dedupeKey(EVENTS.turn_ended, input.session_id, input.prompt_id ?? String(store.events({ type: "turn_ended" }).length)),
    payload: { session: input.session_id, ...(tokens ? { context_tokens: tokens } : {}) },
  });
}

/**
 * Decision 196: a dispatched session whose turn ended while its Dispatch is still open in Orca (no
 * worker_done sent) is idle. Orca's dispatch state is the fact; a failed read writes nothing.
 */
async function workerIdle(deps: CoreDeps, row: SessionRow, input: SessionHookInput): Promise<void> {
  if (!row.task) return;
  const d = await deps.orca.dispatchShow({ task: row.task });
  if (!d.ok || d.value.completed_at !== null || d.value.status !== "dispatched") return;
  deps.store.append({
    type: "worker_idle",
    source: "Stop",
    entity: "task",
    entity_id: row.task,
    dedupe_key: dedupeKey(EVENTS.worker_idle, input.session_id, input.prompt_id ?? String(deps.store.events({ type: "worker_idle" }).length)),
    payload: { session: input.session_id },
  });
}

function compacted(store: Store, row: SessionRow, input: SessionHookInput): void {
  const trigger = input.trigger === "auto" || input.trigger === "manual" ? input.trigger : undefined;
  if (!trigger) return;
  const pre = lastPreTokens(tail(input.transcript_path));
  store.append({
    type: "compacted",
    source: "PostCompact",
    ...(row.task ? { entity: "task", entity_id: row.task } : {}),
    dedupe_key: dedupeKey(EVENTS.compacted, input.session_id, input.prompt_id ?? String(store.events({ type: "compacted" }).length)),
    payload: { session: input.session_id, trigger, ...(pre ? { pre_tokens: pre } : {}) },
  });
}

const PERMISSION = /permission to use ([A-Za-z_][\w:.-]*)/i;
// Decision 293: `idle_prompt` is not a wait. It comes about a minute after any turn ends, so a
// session that has simply finished would read as waiting on a person.
const WAITS = new Set(["permission_prompt", "elicitation_dialog"]);

const SIGN_IN = new Set(["authentication_failed", "oauth_org_not_allowed"]);

/**
 * Decision 237: StopFailure on a lost login → waiting_human{cause auth} for a session holding no
 * Dispatch, the sessions nothing else sees stopping. A dispatched one is left to Orca's stop mail.
 * The wait is open until the session's next finished turn, so one stop is one wait.
 */
async function lostLogin(deps: CoreDeps, row: SessionRow, input: SessionHookInput): Promise<void> {
  if (row.task || !SIGN_IN.has(input.error ?? "")) return;
  const worktree = await liveWorktree(deps.orca, input.cwd);
  if (openWaits(deps.store.events()).some((e) => e.payload.session === input.session_id && e.payload.cause === "auth")) return;
  const n = deps.store.events({ type: "waiting_human" }).filter((e) => e.payload.session === input.session_id).length + 1;
  const text = input.last_assistant_message;
  deps.store.append({
    type: "waiting_human",
    source: "StopFailure",
    dedupe_key: dedupeKey(EVENTS.waiting_human, input.session_id, String(n)),
    payload: { session: input.session_id, cause: "auth", ...(text ? { excerpt: summarize(mask(text)) } : {}), ...(worktree ? { worktree } : {}) },
  });
}

/**
 * Notification → waiting_human for a session holding no Dispatch (the owner reaches it through
 * queue-monitor's escalation, decision 91①): a permission prompt or an elicitation dialog, not the
 * idle notice. The tool is read from the text or left out; a repeat notification for a wait still
 * open writes nothing.
 */
async function waitingHuman(deps: CoreDeps, row: SessionRow, input: SessionHookInput): Promise<void> {
  // A session holding a Dispatch is seen through Orca's needs-input mail alone (decision 196), which
  // Orca already delivers to the lead: one source per wait, and it holds with the plugin off.
  if (row.task) return;
  const message = input.message ?? "";
  const kind = input.notification_type;
  // With no type sent, only the permission wording is a wait: the idle notice says "waiting for your input".
  if (kind ? !WAITS.has(kind) : !/permission/i.test(message)) return;
  const tool = PERMISSION.exec(message)?.[1];
  // Read Orca before the store, so no await sits between counting this session's waits and writing.
  const worktree = await liveWorktree(deps.orca, input.cwd);
  const open = openWaits(deps.store.events()).filter((e) => e.payload.session === input.session_id);
  if (open.some((e) => e.payload.tool === tool)) return;
  const n = deps.store.events({ type: "waiting_human" }).filter((e) => e.payload.session === input.session_id).length + 1;
  deps.store.append({
    type: "waiting_human",
    source: "Notification",
    dedupe_key: dedupeKey(EVENTS.waiting_human, input.session_id, String(n)),
    payload: { session: input.session_id, ...(tool ? { tool } : {}), ...(message ? { excerpt: summarize(mask(message)) } : {}), ...(worktree ? { worktree } : {}) },
  });
}
