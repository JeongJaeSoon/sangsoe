import type { NotifiedKey } from "../contract/index.ts";
import { notify } from "../notify/notify.ts";
import { type CoreDeps, done, type Result, refuse } from "../notify/result.ts";
import { type DecisionState, isClosedTask, isOpenGate, orcaReads } from "./waiters.ts";

export interface Released {
  readonly resolved: readonly string[];
  readonly notified: readonly string[];
  readonly handedOff: readonly string[];
}

export interface ReleaseInput {
  readonly callerRun: string;
  /** gate-resolve's text: `dNNN: <quote>` or `MOOT dNNN: <evidence>`. */
  readonly resolution: string;
  readonly keyFor: (task: string) => NotifiedKey;
  readonly subject: string;
}

/**
 * Frees every waiter of a closed decision: resolves the open gates bound to the caller's Run and tells
 * each waiter once (decision 84③: resolve alone is not trusted to wake anyone). A gate in another Run
 * cannot be resolved from here (decision 77 라), so that Run gets one message and resolves it with the
 * same function. A closed Task's gate is left alone; its Run is told instead (decision 91④(ii)). A Task
 * with no worker yet is not told: the start procedure puts the answer in the first prompt (91④(i)).
 */
export async function release(deps: CoreDeps, state: DecisionState, input: ReleaseInput): Promise<Result<Released>> {
  const d = state.row.decision;
  const reads = orcaReads(deps.orca);
  const resolved: string[] = [];
  const notified: string[] = [];
  const handedOff: string[] = [];
  for (const w of state.waiters) {
    if (!w.run || !w.gate) continue;
    const gate = await reads.gate(w.run, w.gate);
    const task = await reads.task(w.run, w.task);
    const closed = task !== undefined && isClosedTask(task);
    const open = gate !== undefined && isOpenGate(gate) && !closed;

    if (w.run !== input.callerRun) {
      if (!open) continue;
      const key = input.keyFor(w.task);
      const r = await notify(deps, {
        key: { target: key.target, dedupe_key: `${key.dedupe_key}:resolve` },
        to: "lead",
        chain: { leadRun: w.run },
        subject: `${d}: resolve gate ${w.gate}`,
        body: `${input.resolution}\nThe gate ${w.gate} on ${w.task} is bound to your Run: call decision_answer for ${d} there.`,
        msgType: "handoff",
        source: "decision_answer",
      });
      if (!r.ok) return r;
      if (r.value.status === "sent") handedOff.push(w.task);
      continue;
    }

    if (open) {
      const r = await deps.orca.gateResolve({ id: w.gate, resolution: input.resolution });
      if (!r.ok) return refuse("orca_error", `gate-resolve ${w.gate}: ${r.error.code}`, "call again; the decision is already closed");
      resolved.push(w.gate);
    }
    if (w.carrier || !task) continue;
    const chain = closed ? { leadRun: w.run } : task.dispatchId ? { dispatch: task.dispatchId, leadRun: w.run } : undefined;
    if (!chain) continue;
    const r = await notify(deps, {
      key: input.keyFor(w.task),
      to: closed ? "lead" : "worker",
      chain,
      subject: input.subject,
      body: input.resolution,
      msgType: "decision_gate",
      source: "decision_answer",
    });
    if (!r.ok) return r;
    if (r.value.status === "sent") notified.push(w.task);
  }
  return done({ resolved, notified, handedOff });
}
