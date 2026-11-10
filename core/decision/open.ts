import { receiptId } from "../notify/receipt.ts";
import { type CoreDeps, done, type Result, refuse } from "../notify/result.ts";
import { decisionKey } from "./key.ts";
import { type DecisionState, isClosedTask, isOpenGate, orcaReads, readDecision, readDecisionByKey } from "./waiters.ts";

export interface DecisionOpenInput {
  /** `item:iNNN`, else `scope:<group>`. */
  readonly subject: string;
  readonly options: readonly string[];
  /** Goes into the Orca gate only; never into an event (decision 74). */
  readonly question: string;
  /** Each Task that waits on the answer and the Run it sits in. */
  readonly waiters: readonly { readonly task: string; readonly run: string }[];
  /** The orchestrator Run, where a decision with no waiter gets its carrier Task. */
  readonly carrierRun?: string;
  /** The Run this session holds. gate-create and task-create bind to it, so every waiter must sit in it. */
  readonly callerRun: string;
}

export type DecisionOpened =
  | { readonly status: "opened" | "joined"; readonly decision: string; readonly gates: readonly string[] }
  | {
      readonly status: "closed";
      readonly decision: string;
      readonly answer: string | null;
      readonly reason: "answered" | "moot";
    };

const SOURCE = "decision_open";

/**
 * The re-ask gate (appendix #decision-loop-detail). A decision key already answered or mooted is not
 * asked again: its dNNN and answer come back. One still open gains the new waiters. Otherwise a new
 * dNNN is issued and every waiter Task gets one Orca gate. Calling it again after a crash creates
 * nothing twice.
 */
export async function decisionOpen(deps: CoreDeps, input: DecisionOpenInput): Promise<Result<DecisionOpened>> {
  const { store, orca } = deps;
  if (input.waiters.length === 0 && !input.carrierRun) {
    return refuse("no_waiter", "a decision needs a waiter Task or the orchestrator Run", "pass waiters, or carrierRun");
  }
  const foreign = [...input.waiters.map((w) => w.run), ...(input.carrierRun ? [input.carrierRun] : [])].find(
    (run) => run !== input.callerRun,
  );
  if (foreign) {
    return refuse("cross_run_waiter", `${foreign} is not this session's Run ${input.callerRun}`, "open the decision from each waiter's own Run");
  }
  const key = decisionKey(input.subject, input.options);
  let state = readDecisionByKey(store, key);
  let opened = false;
  if (!state) {
    const d = store.allocate("d");
    const row = store.append({
      type: "decision_opened",
      source: SOURCE,
      dedupe_key: `decision:${key}`,
      payload: { decision: d, decision_key: key },
    });
    opened = row.inserted;
    state = readDecisionByKey(store, key);
    if (!state) return refuse("store_error", `decision_opened for ${key} is not readable`, "retry");
  }
  const d = state.row.decision;
  if (state.row.state !== "open") {
    const reason = state.row.closedReason === "moot" ? "moot" : "answered";
    return done({ status: "closed", decision: d, answer: state.row.answer, reason });
  }

  // Orca refuses a gate on a Task whose supervised worker runs (task_not_startable): such a waiter
  // joins without one and hears the answer by message (release); the question then sits on a carrier
  // in this Run unless another waiter's gate holds it (decision 197).
  const reads = orcaReads(orca);
  const running: { task: string; run: string }[] = [];
  let waiters: { task: string; run: string }[] = [];
  for (const w of input.waiters) {
    const prior = state.waiters.find((x) => x.task === w.task);
    if (prior) {
      // A waiter joined without a gate stays so: a later gate would not be recorded and never resolve.
      (prior.gate !== null ? waiters : running).push(w);
      continue;
    }
    const t = await reads.task(w.run, w.task);
    if (!t.ok) return t;
    const live = t.value !== undefined && !isClosedTask(t.value) && (t.value.status === "dispatched" || t.value.dispatchId !== undefined);
    (live ? running : waiters).push(w);
  }
  for (const w of running) {
    store.append({
      type: "decision_joined",
      source: SOURCE,
      dedupe_key: `decision_joined:${d}:${encodeURIComponent(w.task)}`,
      payload: { decision: d, waiter: w.task, run: w.run },
    });
  }
  if (waiters.length === 0) {
    const run = input.carrierRun ?? input.callerRun;
    const carrier = await carrierTask(deps, state, run);
    if (!carrier.ok) return carrier;
    waiters = [{ task: carrier.value, run }];
  }

  const gates: string[] = [];
  for (const w of waiters) {
    const known = state.waiters.find((x) => x.task === w.task && x.gate !== null);
    if (known?.gate) {
      gates.push(known.gate);
      continue;
    }
    const listed = await orca.gateList({ run: w.run, task: w.task });
    if (!listed.ok) return refuse("orca_error", `gate-list ${w.task}: ${listed.error.code}`, "retry once Orca answers");
    let gate = listed.value.find(
      (g) => isOpenGate(g) && (g.taskId ?? w.task) === w.task && g.question?.startsWith(`${d}:`),
    )?.id;
    let created = false;
    if (!gate) {
      const r = await orca.gateCreate({ task: w.task, question: `${d}: ${input.question}`, options: [...input.options] });
      if (!r.ok) return refuse("orca_error", `gate-create ${w.task}: ${r.error.code}`, "retry; the decision stays open");
      gate = receiptId(r.value, "gate");
      if (!gate) return refuse("receipt_without_id", `gate-create ${w.task} returned no gate id`, "read gate-list and retry");
      created = true;
    }
    const joined = store.append({
      type: "decision_joined",
      source: SOURCE,
      dedupe_key: `decision_joined:${d}:${encodeURIComponent(w.task)}`,
      payload: { decision: d, waiter: w.task, gate, run: w.run },
    });
    // A concurrent open joined this waiter first: its gate is the one recorded, so close the one made here.
    const recorded = joined.inserted ? gate : readDecision(store, d)?.waiters.find((x) => x.task === w.task)?.gate;
    if (created && recorded && recorded !== gate) {
      const r = await orca.gateResolve({ id: gate, resolution: `${d}: duplicate gate, see ${recorded}` });
      if (!r.ok) return refuse("orca_error", `gate-resolve ${gate}: ${r.error.code}`, "retry; the duplicate gate stays open");
    }
    gates.push(recorded ?? gate);
  }
  return done({ status: opened ? "opened" : "joined", decision: d, gates });
}

// The orchestrator Run's carrier Task is titled dNNN and marked exec_by=owner; an existing one is reused.
async function carrierTask(deps: CoreDeps, state: DecisionState, run: string): Promise<Result<string>> {
  const d = state.row.decision;
  const marked = state.waiters.find((w) => w.carrier);
  if (marked) return done(marked.task);
  const listed = await deps.orca.taskList({ run });
  if (!listed.ok) return refuse("orca_error", `task-list ${run}: ${listed.error.code}`, "retry once Orca answers");
  let task = listed.value.find((t) => t.title === d)?.id;
  if (!task) {
    const created = await deps.orca.taskCreate({ spec: `Owner decision ${d}; the question is on its gate.`, title: d, run });
    if (!created.ok) return refuse("orca_error", `task-create in ${run}: ${created.error.code}`, "retry");
    task = receiptId(created.value, "task");
    if (!task) return refuse("receipt_without_id", "task-create returned no task id", "read task-list and retry");
  }
  deps.store.append({ type: "item_extra_set", source: SOURCE, payload: { task, exec_by: "owner" } });
  return done(task);
}
