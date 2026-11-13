import { mootNotifiedKey } from "../contract/index.ts";
import { type CoreDeps, done, type Result, refuse } from "../notify/result.ts";
import { type Released, release } from "./release.ts";
import { isClosedTask, orcaReads, readDecision } from "./waiters.ts";

export type MootEvidence = { readonly kind: "tasks_closed" } | { readonly kind: "pr_closed"; readonly pr: string };

export interface DecisionMootInput {
  readonly decision: string;
  readonly evidence: MootEvidence;
  readonly callerRun: string;
}

export interface DecisionMooted extends Released {
  readonly status: "moot" | "not_open";
  readonly decision: string;
}

/**
 * Decision 91③: closes an open decision whose cause is gone, without an answer. "tasks_closed" is
 * re-read here: every waiter Task but the carrier, at least one, must be completed or cancelled. The
 * caller (queue-monitor) has read "pr_closed" itself. Open gates of live Tasks resolve as `MOOT dNNN`.
 * Decision 231: a decision with no waiter at all, carrier included, is a broken record (Orca refused its
 * gate after decision_opened, decision 219); nothing waits on it, so it is moot with no Orca call.
 */
export async function decisionMoot(deps: CoreDeps, input: DecisionMootInput): Promise<Result<DecisionMooted>> {
  const { store } = deps;
  const d = input.decision;
  const nothing = { resolved: [], notified: [], handedOff: [] };
  const before = readDecision(store, d);
  if (!before) return refuse("unknown_decision", `no decision ${d}`, "moot an open dNNN");
  if (before.row.state !== "open" && before.row.closedReason !== "moot") {
    return done({ status: "not_open", decision: d, ...nothing });
  }

  // Already moot: a re-call resumes the delivery a crashed call left, under the evidence first recorded.
  if (before.row.state === "open" && input.evidence.kind === "tasks_closed") {
    const waiters = before.waiters.filter((w) => !w.carrier);
    const reads = orcaReads(deps.orca);
    let allClosed = before.waiters.length === 0 || waiters.length > 0;
    for (const w of waiters) {
      if (!w.run) {
        allClosed = false;
        continue;
      }
      const task = await reads.task(w.run, w.task);
      if (!task.ok) return task;
      if (!task.value || !isClosedTask(task.value)) allClosed = false;
    }
    if (!allClosed) return refuse("not_moot", `a waiter of ${d} is still open`, "leave the decision open");
  }
  store.append({
    type: "decision_closed",
    source: "decision_moot",
    dedupe_key: `decision_closed:${d}`,
    payload: {
      decision: d,
      reason: "moot",
      evidence: input.evidence.kind === "pr_closed" ? `pr_closed:${input.evidence.pr}` : "tasks_closed",
    },
  });
  const state = readDecision(store, d);
  if (state?.row.closedReason !== "moot") return done({ status: "not_open", decision: d, ...nothing });
  const closedRow = store.events({ type: "decision_closed" }).find((e) => e.dedupe_key === `decision_closed:${d}`);
  const evidence = String(closedRow?.payload.evidence ?? "moot");
  const r = await release(deps, state, {
    callerRun: input.callerRun,
    resolution: `MOOT ${d}: ${evidence}`,
    keyFor: (task) => mootNotifiedKey(d, task),
    subject: `${d} is moot`,
    resumeWith: "decision_moot",
    resume: `sangsoe decision moot --decision ${d}`,
  });
  return r.ok ? done({ status: "moot", decision: d, ...r.value }) : r;
}
