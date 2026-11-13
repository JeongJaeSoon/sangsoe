import type { StoredEvent } from "../contract/index.ts";
import type { Role } from "../start/types.ts";
import type { Store } from "../store/store.ts";

/** The fields of Claude Code's hook input the recorders read; every one but session_id may be absent. */
export interface SessionHookInput {
  readonly session_id: string;
  readonly transcript_path?: string;
  readonly cwd?: string;
  readonly hook_event_name?: string;
  readonly source?: string;
  readonly model?: string;
  readonly agent_type?: string;
  readonly prompt?: string;
  readonly prompt_id?: string;
  readonly tool_name?: string;
  readonly message?: string;
  readonly notification_type?: string;
  readonly trigger?: string;
  readonly reason?: string;
  /** StopFailure: the API error type the turn ended on, and the error text itself. */
  readonly error?: string;
  readonly last_assistant_message?: string;
}

/** undefined for anything that is not a JSON object with a session id: the recorder then does nothing. */
export function parseSessionInput(text: string): SessionHookInput | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.session_id !== "string" || o.session_id === "") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) if (typeof v === "string") out[k] = v;
  return out as unknown as SessionHookInput;
}

export interface SessionRow {
  readonly seq: number;
  readonly role: Role;
  /** The Task this session works, when Orca dispatched it. */
  readonly task: string | undefined;
  /** The Run the Task lives in (its owning lead's); the Run told about a wait. */
  readonly taskRun: string | undefined;
  /** The Run this session held at start (`run-current`). */
  readonly heldRun: string | undefined;
}

const runOf = (col: string | null) => (col?.startsWith("run:") ? col.slice(4) : undefined);

export function toSessionRow(e: StoredEvent): SessionRow {
  return {
    seq: e.seq,
    role: e.payload.role as Role,
    task: e.entity === "task" && e.entity_id ? e.entity_id : undefined,
    taskRun: runOf(e.subject),
    heldRun: runOf(e.target),
  };
}

/** The latest session_started row of this Claude Code session: the one fact that makes it a sangsoe session. */
export function sessionOf(store: Pick<Store, "events">, session: string): SessionRow | undefined {
  const rows = store.events({ type: "session_started" }).filter((e) => e.payload.session === session);
  const last = rows.at(-1);
  return last ? toSessionRow(last) : undefined;
}
