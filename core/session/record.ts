import { dedupeKey, EVENTS } from "../contract/index.ts";
import { decisionAnswer } from "../decision/answer.ts";
import { syncOwnRun } from "../graph/own-run.ts";
import { advisorCalls } from "../models/spend.ts";
import { readDecision } from "../decision/waiters.ts";
import type { CoreDeps } from "../notify/result.ts";
import { classifyPrompt } from "../owner/prompt.ts";
import { openWaits, RELEASE_READS, type ReleaseSignal, recordReleases } from "../owner/release.ts";
import type { Store } from "../store/store.ts";
import { liveWorktree } from "./locate.ts";
import { hashOf, mask, summarize } from "./mask.ts";
import { type SessionHookInput, type SessionRow, sessionOf } from "./session.ts";
import { sessionStart, type SessionStartOptions } from "./session-start.ts";
import { recordShellInputs } from "./shell.ts";
import { lastContextTokens, lastPreTokens, marked, tail } from "./transcript.ts";

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

/**
 * One recording hook call. Returns the lines to print: only SessionStart prints (its stdout is injected
 * context); every other hook prints nothing. A session with no session_started row is not sangsoe's and
 * gets no write and no Orca call.
 */
export async function recordHook(event: SessionHook, deps: CoreDeps, input: SessionHookInput, opts: SessionStartOptions = {}): Promise<string[]> {
  if (event === "session-start") return sessionStart(deps, input, opts);
  const row = sessionOf(deps.store, input.session_id);
  if (!row) return [];
  switch (event) {
    case "user-prompt-submit":
      await recordShellInputs(deps, row, input.session_id, input.transcript_path);
      await ownerSaid(deps, row, input);
      await syncOwnRun(deps, row.role, new Date().toISOString());
      break;
    case "stop":
      await recordShellInputs(deps, row, input.session_id, input.transcript_path);
      advisorUsed(deps.store, row, input);
      turnEnded(deps.store, row, input);
      released(deps.store, { kind: "turn_ended", session: input.session_id }, "Stop");
      await workerIdle(deps, row, input);
      await syncOwnRun(deps, row.role, new Date().toISOString());
      break;
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
async function ownerSaid(deps: CoreDeps, row: SessionRow, input: SessionHookInput): Promise<void> {
  const text = input.prompt ?? "";
  if (classifyPrompt(text) !== "owner") return;
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
  );
  // The orchestrator is the owner's session; a lead or worker whose Dispatch locate() missed is not.
  if (!action.inserted || row.task || row.role !== "orchestrator") return;
  const named = [...new Set(text.match(DECISION_NO) ?? [])];
  const d = named.length === 1 ? ANSWER_SHAPE.exec(text)?.[1] : undefined;
  if (!d || !readDecision(deps.store, d)) return;
  const current = await deps.orca.runCurrent();
  const callerRun = current.ok && typeof current.value.runId === "string" ? current.value.runId : "";
  // A refusal (an owner_action already used, a moot close) is the record's answer; the hook stays silent.
  await decisionAnswer(deps, { decision: d, answer: masked, ownerAction: action.seq, linkedBy: "hook", callerRun });
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
const WAITS = new Set(["permission_prompt", "idle_prompt", "elicitation_dialog"]);

/**
 * Notification → waiting_human for a session holding no Dispatch (the owner reaches it through
 * queue-monitor's escalation, decision 91①). The tool is read from the text or left out; a repeat
 * notification for a wait still open writes nothing.
 */
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

async function waitingHuman(deps: CoreDeps, row: SessionRow, input: SessionHookInput): Promise<void> {
  // A session holding a Dispatch is seen through Orca's needs-input mail alone (decision 196), which
  // Orca already delivers to the lead: one source per wait, and it holds with the plugin off.
  if (row.task) return;
  const message = input.message ?? "";
  const kind = input.notification_type;
  if (kind ? !WAITS.has(kind) : !/permission|waiting for your input/i.test(message)) return;
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
