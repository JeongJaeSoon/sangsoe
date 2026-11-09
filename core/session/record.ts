import { dedupeKey, dedupeSegment, EVENTS } from "../contract/index.ts";
import { decisionAnswer } from "../decision/answer.ts";
import { readDecision } from "../decision/waiters.ts";
import { notify } from "../notify/notify.ts";
import type { CoreDeps } from "../notify/result.ts";
import { openWaits, type ReleaseSignal, recordReleases } from "../owner/release.ts";
import type { Store } from "../store/store.ts";
import { hashOf, mask, summarize } from "./mask.ts";
import { type SessionHookInput, type SessionRow, sessionOf } from "./session.ts";
import { sessionStart, type SessionStartOptions } from "./session-start.ts";
import { recordShellInputs } from "./shell.ts";
import { lastContextTokens, lastPreTokens, tail } from "./transcript.ts";

export const SESSION_HOOKS = [
  "session-start",
  "user-prompt-submit",
  "stop",
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
      break;
    case "stop":
      await recordShellInputs(deps, row, input.session_id, input.transcript_path);
      turnEnded(deps.store, row, input);
      released(deps.store, { kind: "turn_ended", session: input.session_id }, "Stop");
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
      released(deps.store, { kind: "session_ended", session: input.session_id, evidence: "session_ended" }, "SessionEnd");
      break;
  }
  return [];
}

/** Decision 91①: the session moving again, or ending, releases its waits; core/owner decides which. */
const released = (store: Store, signal: ReleaseSignal, source: string) => {
  // Every tool call lands here: read only the rows a release looks at, in log order.
  const events = ["waiting_human", "waiting_released", "owner_action"].flatMap((type) => store.events({ type })).sort((a, b) => a.seq - b.seq);
  return recordReleases(store, { events }, signal, source);
};

// Orca's own prompts to a dispatched session (the brief, wrapped) are not the owner's words.
const ORCA_PROMPT = /^(Please carry out this task from my Orca coordinator|You are working inside Orca, a multi-agent IDE\.)/;
const DECISION_NO = /\bd\d{3,}\b/g;

/**
 * The owner's chat line: owner_action with the masked text in owner_text. A line naming exactly one
 * dNNN links to it through U8's decision_answer (linked_by=hook); an iNNN alone links nothing, and a line
 * naming two decisions links neither (one owner_action answers one decision).
 */
async function ownerSaid(deps: CoreDeps, row: SessionRow, input: SessionHookInput): Promise<void> {
  const text = input.prompt ?? "";
  if (text.trim() === "" || ORCA_PROMPT.test(text.trimStart())) return;
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
  if (!action.inserted) return;
  const named = [...new Set(text.match(DECISION_NO) ?? [])];
  const d = named.length === 1 ? named[0] : undefined;
  if (!d || !readDecision(deps.store, d)) return;
  const current = await deps.orca.runCurrent();
  const callerRun = current.ok && typeof current.value.runId === "string" ? current.value.runId : "";
  // A refusal (an owner_action already used, a moot close) is the record's answer; the hook stays silent.
  await decisionAnswer(deps, { decision: d, answer: masked, ownerAction: action.seq, linkedBy: "hook", callerRun });
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
 * Notification → waiting_human, then one message to the owning lead (decision 91①: the lead first, the
 * owner only through queue-monitor's escalation). The tool is read from the text or left out; a repeat
 * notification for a wait still open writes nothing.
 */
async function waitingHuman(deps: CoreDeps, row: SessionRow, input: SessionHookInput): Promise<void> {
  const message = input.message ?? "";
  const kind = input.notification_type;
  if (kind ? !WAITS.has(kind) : !/permission|waiting for your input/i.test(message)) return;
  const tool = PERMISSION.exec(message)?.[1];
  const open = openWaits(deps.store.events()).filter((e) => e.payload.session === input.session_id);
  if (open.some((e) => e.payload.tool === tool)) return;
  const n = deps.store.events({ type: "waiting_human" }).filter((e) => e.payload.session === input.session_id).length + 1;
  const w = deps.store.append({
    type: "waiting_human",
    source: "Notification",
    ...(row.task ? { entity: "task", entity_id: row.task } : {}),
    dedupe_key: dedupeKey(EVENTS.waiting_human, input.session_id, String(n)),
    payload: { session: input.session_id, ...(tool ? { tool } : {}), ...(message ? { excerpt: summarize(mask(message)) } : {}) },
  });
  if (!w.inserted || !row.task || !row.taskRun) return;
  await notify(deps, {
    key: { target: row.task, dedupe_key: `notify:${dedupeSegment(row.task)}:waiting_human:${w.seq}` },
    to: "lead",
    chain: { leadRun: row.taskRun },
    subject: `${row.task}: 사람 입력 대기${tool ? ` (${tool})` : ""}`,
    body: `세션 ${input.session_id} 이 ${tool ? `${tool} 권한` : "입력"}을 기다린다. ${message ? summarize(mask(message)) : ""}`.trim(),
    msgType: "escalation",
    source: "Notification",
  });
}
