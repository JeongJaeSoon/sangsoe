import type { NotifiedKey } from "../contract/index.ts";
import { notify } from "../notify/notify.ts";
import { type CoreDeps, done, type Result, refuse } from "../notify/result.ts";
import { type DecisionState, isClosedTask, isOpenGate, orcaReads, type Waiter } from "./waiters.ts";

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
  readonly resumeWith: "decision_answer" | "decision_moot";
  /** The exact call the Run holding a foreign gate makes to resolve it: the same operation, resumed there. */
  readonly resume: string;
}

/**
 * Frees every waiter of a closed decision. Gates bound to the caller's Run are resolved here; a gate in
 * another Run cannot be (decision 77 라), so that Run gets one message and resumes the same operation.
 * Each waiter whose gate is no longer open is told once (decision 84③: resolve alone is not trusted to
 * wake anyone): its worker by Dispatch, or its Run when the Task is closed (decision 91④(ii)), whichever
 * Run the waiter sits in. A Task with no worker yet is not told: the start procedure puts the answer in
 * the first prompt (91④(i)). One waiter's failure does not hold back the others: the call goes on, then
 * refuses naming each failure, and calling again resumes only what is left.
 */
export async function release(deps: CoreDeps, state: DecisionState, input: ReleaseInput): Promise<Result<Released>> {
  const out: Out = { resolved: [], notified: [], handedOff: [] };
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

type Out = { resolved: string[]; notified: string[]; handedOff: string[] };

async function releaseOne(
  deps: CoreDeps,
  reads: ReturnType<typeof orcaReads>,
  d: string,
  w: Waiter,
  input: ReleaseInput,
  out: Out,
): Promise<Result<null>> {
  if (!w.run || !w.gate) return done(null);
  const task = await reads.task(w.run, w.task);
  if (!task.ok) return task;
  const gate = await reads.gate(w.run, w.gate);
  if (!gate.ok) return gate;
  const closed = task.value !== undefined && isClosedTask(task.value);
  const open = !closed && gate.value !== undefined && isOpenGate(gate.value);

  if (open && w.run !== input.callerRun) {
    const key = input.keyFor(w.task);
    const r = await notify(deps, {
      key: { target: key.target, dedupe_key: `${key.dedupe_key}:resolve` },
      to: "lead",
      chain: { leadRun: w.run },
      subject: `${d}: resolve gate ${w.gate}`,
      body: `${input.resolution}\nThe gate ${w.gate} on ${w.task} is bound to your Run. Run there: ${input.resume}`,
      msgType: "handoff",
      source: input.resumeWith,
    });
    if (r.ok && r.value.status === "sent") out.handedOff.push(w.task);
    return r.ok ? done(null) : r;
  }
  if (open) {
    const r = await deps.orca.gateResolve({ id: w.gate, resolution: input.resolution });
    if (!r.ok) return refuse("orca_error", `gate-resolve ${w.gate}: ${r.error.code}`, "call again");
    out.resolved.push(w.gate);
  }

  if (w.carrier || !task.value) return done(null);
  const dispatch = task.value.dispatchId;
  if (!closed && !dispatch) return done(null);
  const r = await notify(deps, {
    key: input.keyFor(w.task),
    to: closed ? "lead" : "worker",
    chain: closed || !dispatch ? { leadRun: w.run } : { dispatch, leadRun: w.run },
    subject: input.subject,
    body: input.resolution,
    msgType: "decision_gate",
    source: input.resumeWith,
  });
  if (r.ok && r.value.status === "sent") out.notified.push(w.task);
  return r.ok ? done(null) : r;
}
