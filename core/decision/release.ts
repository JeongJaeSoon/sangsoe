import type { NotifiedKey } from "../contract/index.ts";
import { notify } from "../notify/notify.ts";
import { type CoreDeps, done, type Result, refuse } from "../notify/result.ts";
import { type DecisionState, isOpenGate, orcaReads, owed, type Waiter } from "./waiters.ts";

export interface Released {
  readonly resolved: readonly string[];
  readonly notified: readonly string[];
  readonly handedOff: readonly string[];
  /**
   * Waiters this caller could neither free nor tell, because Orca takes no message from a process
   * with no terminal (the panel, the timer). The session holding the waiter's Run frees them from
   * its own hooks (decision 274).
   */
  readonly pending: readonly string[];
}

export interface ReleaseInput {
  readonly callerRun: string;
  /** gate-resolve's text: `dNNN: <quote>` or `MOOT dNNN: <evidence>`. */
  readonly resolution: string;
  readonly keyFor: (task: string) => NotifiedKey;
  readonly subject: string;
  readonly resumeWith: "decision_answer" | "decision_moot";
  /** The exact call the Run holding a foreign gate makes to resolve it: the same operation, resumed there. */
  readonly resume: string;
}

/**
 * Frees every waiter of a closed decision. Gates bound to the caller's Run are resolved here; a gate in
 * another Run cannot be (decision 77 라), so that Run gets one message and resumes the same operation.
 * What a waiter is owed is read by `owed` (waiters.ts), whichever Run it sits in. A waiter whose worker
 * runs is told once by Dispatch (decision 84③: resolve alone is not trusted to wake anyone). A closed
 * Task's Run is told once when its gate is still open or it has none (decision 91④(ii)); a gate resolved
 * while the Task was live was the delivery. A Task with no worker yet is not told: the start procedure
 * puts the answer in the first prompt (91④(i)). One waiter's failure does not hold back the others: the call goes on, then
 * refuses naming each failure, and calling again resumes only what is left.
 */
export async function release(deps: CoreDeps, state: DecisionState, input: ReleaseInput): Promise<Result<Released>> {
  const out: Out = { resolved: [], notified: [], handedOff: [], pending: [] };
  const failed: string[] = [];
  const reads = orcaReads(deps.orca);
  for (const w of state.waiters) {
    const r = await releaseOne(deps, reads, state.row.decision, w, input, out);
    if (!r.ok) failed.push(`${w.task}: ${r.refusal.code} ${r.refusal.reason}`);
  }
  if (failed.length > 0) {
    return refuse("release_incomplete", failed.join("; "), "call again; what was done is not repeated");
  }
  return done(out);
}

type Out = { resolved: string[]; notified: string[]; handedOff: string[]; pending: string[] };

// notify's answer when this process has no terminal to send from: not a failure of the release.
const told = (out: Out, task: string, r: Awaited<ReturnType<typeof notify>>, into: "handedOff" | "notified"): Result<null> => {
  if (r.ok) {
    if (r.value.status === "sent") out[into].push(task);
    return done(null);
  }
  if (r.refusal.code !== "no_sender") return r;
  out.pending.push(task);
  return done(null);
};

async function releaseOne(
  deps: CoreDeps,
  reads: ReturnType<typeof orcaReads>,
  d: string,
  w: Waiter,
  input: ReleaseInput,
  out: Out,
): Promise<Result<null>> {
  // A waiter joined while its worker ran has no gate (Orca refuses one then, decision 197): only the message below.
  if (!w.run || (!w.gate && w.carrier)) return done(null);
  const task = await reads.task(w.run, w.task);
  if (!task.ok) return task;
  const gate = w.gate ? await reads.gate(w.run, w.gate) : done(undefined);
  if (!gate.ok) return gate;
  const due = owed(w, task.value, gate.value !== undefined && isOpenGate(gate.value));
  const open = due.gate;

  if (open && w.run !== input.callerRun) {
    const key = input.keyFor(w.task);
    const r = await notify(deps, {
      key: { target: key.target, dedupe_key: `${key.dedupe_key}:resolve` },
      to: "lead",
      chain: { leadRun: w.run },
      subject: `${d}: resolve gate ${open}`,
      body: `${input.resolution}\nThe gate ${open} on ${w.task} is bound to your Run. Run there: ${input.resume}`,
      msgType: "handoff",
      source: input.resumeWith,
    });
    return told(out, w.task, r, "handedOff");
  }
  if (open) {
    const r = await deps.orca.gateResolve({ id: open, resolution: input.resolution });
    if (!r.ok) return refuse("orca_error", `gate-resolve ${open}: ${r.error.code}`, "call again");
    out.resolved.push(open);
  }

  if (!due.tell) return done(null);
  const dispatch = task.value?.dispatchId;
  const r = await notify(deps, {
    key: input.keyFor(w.task),
    to: due.tell === "run" ? "lead" : "worker",
    chain: due.tell === "worker" && dispatch ? { dispatch, leadRun: w.run } : { leadRun: w.run },
    subject: input.subject,
    body: input.resolution,
    // Not decision_gate: Orca takes that type (and escalation) only from the Dispatch's own process (decision 197).
    msgType: "status",
    source: input.resumeWith,
  });
  return told(out, w.task, r, "notified");
}
