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
  /** What the Run holding a foreign gate calls to resolve it: the same operation, resumed there. */
  readonly resumeWith: "decision_answer" | "decision_moot";
}

/**
 * Frees every waiter of a closed decision. Gates bound to the caller's Run are resolved here; a gate in
 * another Run cannot be (decision 77 라), so that Run gets one message and resumes the same operation.
 * Each waiter whose gate is no longer open is told once (decision 84③: resolve alone is not trusted to
 * wake anyone): its worker by Dispatch, or its Run when the Task is closed (decision 91④(ii)), whichever
 * Run the waiter sits in. A Task with no worker yet is not told: the start procedure puts the answer in
 * the first prompt (91④(i)). A failed Orca read stops the call; calling again resumes it.
 */
export async function release(deps: CoreDeps, state: DecisionState, input: ReleaseInput): Promise<Result<Released>> {
  const d = state.row.decision;
  const reads = orcaReads(deps.orca);
  const resolved: string[] = [];
  const notified: string[] = [];
  const handedOff: string[] = [];
  for (const w of state.waiters) {
    if (!w.run || !w.gate) continue;
    const task = await reads.task(w.run, w.task);
    if (!task.ok) return task;
    const gate = await reads.gate(w.run, w.gate);
    if (!gate.ok) return gate;
    const closed = task.value !== undefined && isClosedTask(task.value);
    let open = !closed && gate.value !== undefined && isOpenGate(gate.value);

    if (open && w.run === input.callerRun) {
      const r = await deps.orca.gateResolve({ id: w.gate, resolution: input.resolution });
      if (!r.ok) return refuse("orca_error", `gate-resolve ${w.gate}: ${r.error.code}`, "call again; the decision is already closed");
      resolved.push(w.gate);
      open = false;
    } else if (open) {
      const key = input.keyFor(w.task);
      const r = await notify(deps, {
        key: { target: key.target, dedupe_key: `${key.dedupe_key}:resolve` },
        to: "lead",
        chain: { leadRun: w.run },
        subject: `${d}: resolve gate ${w.gate}`,
        body: `${input.resolution}\nThe gate ${w.gate} on ${w.task} is bound to your Run: call ${input.resumeWith} for ${d} there.`,
        msgType: "handoff",
        source: input.resumeWith,
      });
      if (!r.ok) return r;
      if (r.value.status === "sent") handedOff.push(w.task);
      continue;
    }

    if (open || w.carrier || !task.value) continue;
    const dispatch = task.value.dispatchId;
    if (!closed && !dispatch) continue;
    const r = await notify(deps, {
      key: input.keyFor(w.task),
      to: closed ? "lead" : "worker",
      chain: closed || !dispatch ? { leadRun: w.run } : { dispatch, leadRun: w.run },
      subject: input.subject,
      body: input.resolution,
      msgType: "decision_gate",
      source: input.resumeWith,
    });
    if (!r.ok) return r;
    if (r.value.status === "sent") notified.push(w.task);
  }
  return done({ resolved, notified, handedOff });
}
