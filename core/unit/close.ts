import { dedupeKey, EVENTS } from "../contract/index.ts";
import type { OrcaAdapter } from "../contract/orca.ts";
import { done, type Result, refuse } from "../notify/result.ts";
import type { Store } from "../store/store.ts";

export interface CloseInput {
  readonly dispatch: string;
  /** The caller's own terminal handle (`ORCA_TERMINAL_HANDLE`); empty or missing is refused. */
  readonly caller?: string | undefined;
}

export interface Closed {
  readonly dispatch: string;
  readonly terminal: string;
}

// Orca's own names for a Dispatch that will not run again. `abandoned` and `stopped` are left out:
// they fence a worker without proving its agent is gone.
const FINAL = new Set(["succeeded", "failed", "cancelled"]);
// What `worktree ps` reports for an agent that is not mid-turn.
const AT_REST = new Set(["done", "idle"]);

/**
 * Decision 263: close one finished unit's agent terminal, by handle, and only when Orca shows the
 * Dispatch final, that exact terminal still listed with an agent that is at rest and holds no wait,
 * and the terminal is not the caller's. Reads Orca only; the one row written names ids, not state.
 */
export async function closeUnit(ports: { readonly orca: OrcaAdapter; readonly store: Store }, a: CloseInput): Promise<Result<Closed>> {
  const { orca } = ports;
  const id = a.dispatch.trim();
  if (id === "") return refuse("invalid_input", "unit_close needs a Dispatch id", "pass dispatch: the id worker_done or start_unit named");

  const show = await orca.workerShow({ dispatch: id });
  if (!show.ok) return refuse("dispatch_unreadable", `worker-show ${id}: ${show.error.code}`, "retry once Orca answers; a Dispatch id Orca does not know cannot be closed");
  const w = show.value;
  if (!FINAL.has(w.state)) return refuse("not_final", `Dispatch ${id} is ${w.state}, not succeeded, failed or cancelled`, "wait for its worker_done, or stop it in Orca; unit_close never closes a unit that may still run");
  if (!w.terminal) return refuse("no_terminal", `Dispatch ${id} names no terminal`, "nothing to close");
  if (w.terminalState === "released" || w.terminalState === "release_pending") {
    return refuse("terminal_released", `the terminal of ${id} is ${w.terminalState}`, "Orca is already releasing it; nothing to close");
  }
  const terminal = w.terminal;
  if (!a.caller) return refuse("caller_unknown", "the caller's own terminal is not known (ORCA_TERMINAL_HANDLE is unset)", "run this from an Orca terminal so the caller's own terminal can be excluded");
  if (terminal === a.caller) return refuse("caller_terminal", `${terminal} is the caller's own terminal`, "close it from another session, or let Orca release it");
  if (!w.workspace) return refuse("terminal_not_live", `Dispatch ${id} names no workspace for ${terminal}`, "nothing was verified; leave it to worker-release");

  const list = await orca.terminalList({ worktree: `id:${w.workspace}` });
  if (!list.ok) return refuse("terminal_not_live", `terminal list: ${list.error.code}`, "retry once Orca answers");
  if (list.value.truncated || list.value.nonLocal.rows > 0) return refuse("terminal_not_live", "terminal list is partial", "retry once Orca answers in full");
  const row = list.value.rows.find((t) => t.handle === terminal);
  if (!row?.agentIdentity) return refuse("terminal_not_live", `${terminal} is not a live agent terminal of ${w.workspace}`, "it is already gone or holds no agent; unit_close only closes an agent's terminal");

  const ps = await orca.worktreePs({ limit: 1000, agentWait: true });
  if (!ps.ok) return refuse("agent_not_idle", `worktree ps: ${ps.error.code}`, "retry once Orca answers");
  // Rows of other hosts do not matter: the target's row is looked up by worktree id among the local rows below.
  if (ps.value.truncated || ps.value.omittedHostIds.includes("local")) return refuse("agent_not_idle", "worktree ps is partial", "retry once Orca answers in full");
  const paneKey = `${row.tabId}:${row.leafId}`;
  const agent = ps.value.rows.find((r) => r.worktreeId === w.workspace)?.agents.find((x) => x.paneKey === paneKey);
  if (!agent) return refuse("agent_not_idle", `no agent row for ${terminal} in worktree ps`, "Orca does not show its agent, so it is not shown idle");
  if (!AT_REST.has(agent.state)) return refuse("agent_not_idle", `the agent in ${terminal} is ${agent.state}`, "wait until it is at rest");
  // `null` is Orca saying it looked and found no wait; an absent field means it never looked.
  if (agent.agentWait !== null) return refuse("agent_not_idle", `the agent in ${terminal} ${agent.agentWait === undefined ? "was not checked for a wait" : "holds a wait"}`, "answer or release the wait first");

  const closed = await orca.terminalClose({ terminal });
  if (!closed.ok) return refuse("close_failed", `terminal close ${terminal}: ${closed.error.code}`, "read the terminal in Orca before trying again");
  ports.store.append({
    type: "unit_closed",
    source: "core:unit",
    entity: "dispatch",
    entity_id: id,
    dedupe_key: dedupeKey(EVENTS.unit_closed, id),
    payload: { dispatch: id, terminal },
  });
  return done({ dispatch: id, terminal });
}
