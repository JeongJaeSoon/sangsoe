import type { DecisionRow, StoredEvent } from "../contract/index.ts";
import type { GateRow, OrcaAdapter, OrcaError, OrcaResult, TaskRow } from "../contract/orca.ts";
import { done, type Result, refuse } from "../notify/result.ts";
import { decision as decisionView } from "../store/views/decision.ts";
import type { Store } from "../store/store.ts";

export interface Waiter {
  readonly task: string;
  readonly gate: string | null;
  readonly run: string | null;
  /** The orchestrator Run's decision-carrying Task (exec_by=owner), not a worker's. */
  readonly carrier: boolean;
}

export interface DecisionState {
  readonly row: DecisionRow;
  readonly waiters: readonly Waiter[];
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** The decision row folded from events alone; whether gates are open is read from Orca by the caller. */
export function readDecision(store: Store, decision: string): DecisionState | undefined {
  const events = store.events().filter((e) => e.payload.decision === decision || e.type === "item_extra_set");
  return fold(events, decision);
}

export function readDecisionByKey(store: Store, key: string): DecisionState | undefined {
  const opened = store.events({ type: "decision_opened" }).find((e) => e.payload.decision_key === key);
  const d = str(opened?.payload.decision);
  return d ? readDecision(store, d) : undefined;
}

function fold(events: readonly StoredEvent[], decision: string): DecisionState | undefined {
  const row = decisionView({ orca: { tasks: [], gates: [] }, events, now: "1970-01-01T00:00:00Z" }).find(
    (r) => r.decision === decision,
  );
  if (!row) return undefined;
  const carriers = new Set(
    events.filter((e) => e.type === "item_extra_set" && e.payload.exec_by === "owner").map((e) => String(e.payload.task)),
  );
  const runs = new Map<string, string>();
  for (const e of events) {
    if (e.type === "decision_joined" && typeof e.payload.run === "string") runs.set(String(e.payload.waiter), e.payload.run);
  }
  const waiters = row.waiters.map((w) => ({ ...w, run: runs.get(w.task) ?? null, carrier: carriers.has(w.task) }));
  return { row, waiters };
}

// Orca's gate-resolve help speaks of "a pending decision gate"; "open" is accepted too until recorded.
export const isOpenGate = (g: Pick<GateRow, "status">): boolean => g.status === "pending" || g.status === "open";

// Completed, or cancelled: Orca writes a cancellation as `failed` with result `cancelled` (appendix
// #schema); a plain `failed` Task may be started again, so it still waits. `cancelled` as a status is
// accepted too until a recording shows which form Orca uses.
export const isClosedTask = (t: Pick<TaskRow, "status" | "result">): boolean =>
  t.status === "completed" || t.status === "cancelled" || (t.status === "failed" && t.result === "cancelled");

/**
 * Per-Run reads of one call, so a Run with several waiters is listed once. A failed read is an error,
 * never "no such Task": the caller stops and a re-call resumes (the decision is already recorded).
 */
export function orcaReads(orca: OrcaAdapter) {
  const tasks = new Map<string, Promise<OrcaResult<TaskRow[]>>>();
  const gates = new Map<string, Promise<OrcaResult<GateRow[]>>>();
  const fail = (what: string, e: OrcaError) => refuse("orca_error", `${what}: ${e.code} ${e.message}`, "call again once Orca answers");
  return {
    task: async (run: string, id: string): Promise<Result<TaskRow | undefined>> => {
      if (!tasks.has(run)) tasks.set(run, orca.taskList({ run, full: true }));
      const r = (await tasks.get(run)) as OrcaResult<TaskRow[]>;
      return r.ok ? done(r.value.find((t) => t.id === id)) : fail(`task-list ${run}`, r.error);
    },
    gate: async (run: string, id: string): Promise<Result<GateRow | undefined>> => {
      if (!gates.has(run)) gates.set(run, orca.gateList({ run }));
      const r = (await gates.get(run)) as OrcaResult<GateRow[]>;
      return r.ok ? done(r.value.find((g) => g.id === id)) : fail(`gate-list ${run}`, r.error);
    },
  };
}
