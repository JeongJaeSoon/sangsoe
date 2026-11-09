import { answerNotifiedKey } from "../contract/index.ts";
import { type CoreDeps, done, type Result, refuse } from "../notify/result.ts";
import { type Released, release } from "./release.ts";
import { readDecision } from "./waiters.ts";

export interface DecisionAnswerInput {
  readonly decision: string;
  /** The owner's words, masked by the caller. Quoted in the gate resolution and the message. */
  readonly answer: string;
  /** The owner_action seq the answer came from; for linkedBy "observed", the observed event's seq. */
  readonly ownerAction: number;
  readonly linkedBy: "hook" | "button" | "orchestrator" | "observed";
  /** The Run this session holds: only its gates can be resolved from here. */
  readonly callerRun: string;
}

export interface DecisionAnswered extends Released {
  readonly status: "answered" | "late";
  readonly decision: string;
}

const SOURCE = "decision_answer";

/**
 * Records the answer, closes the decision, then frees its waiters (release). The first recorded answer
 * is the answer: a second call, from a crash or from another Run, resumes the delivery and changes
 * nothing already done. An answer to a moot decision is recorded as late and goes nowhere (decision 91③).
 */
export async function decisionAnswer(deps: CoreDeps, input: DecisionAnswerInput): Promise<Result<DecisionAnswered>> {
  const { store } = deps;
  const d = input.decision;
  const before = readDecision(store, d);
  if (!before) return refuse("unknown_decision", `no decision ${d}`, "answer an open dNNN");
  const nothing = { resolved: [], notified: [], handedOff: [] };

  if (before.row.closedReason === "moot") {
    store.append({
      type: "decision_answered",
      source: SOURCE,
      dedupe_key: `decision_answered:${d}:late:${input.ownerAction}`,
      payload: { decision: d, owner_action: input.ownerAction, answer: input.answer, linked_by: input.linkedBy, late: true },
    });
    return done({ status: "late", decision: d, ...nothing });
  }
  if (before.row.state === "open") {
    store.append({
      type: "decision_answered",
      source: SOURCE,
      dedupe_key: `decision_answered:${d}`,
      payload: { decision: d, owner_action: input.ownerAction, answer: input.answer, linked_by: input.linkedBy },
    });
  }
  store.append({
    type: "decision_closed",
    source: SOURCE,
    dedupe_key: `decision_closed:${d}`,
    payload: { decision: d, reason: "answered" },
  });
  const state = readDecision(store, d);
  if (state?.row.closedReason !== "answered") {
    return refuse("closed_moot", `${d} was closed as moot before this answer`, "the answer is recorded; re-ask to reverse");
  }
  const answer = state.row.answer ?? input.answer;
  const r = await release(deps, state, {
    callerRun: input.callerRun,
    resolution: `${d}: ${answer}`,
    keyFor: (task) => answerNotifiedKey(d, task),
    subject: `${d} answered`,
  });
  return r.ok ? done({ status: "answered", decision: d, ...r.value }) : r;
}
