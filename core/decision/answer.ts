import { answerNotifiedKey, type StoredEvent } from "../contract/index.ts";
import type { Store } from "../store/store.ts";
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
  const source = sourceOf(store, input);
  if (!source.ok) return source;

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
  // Once an answer is recorded it is delivered, even when a racing moot took the close row first: the
  // view then keeps the decision "answered", and its gates still have to be released.
  const state = readDecision(store, d);
  if (!state || state.row.state === "open" || state.row.closedReason === "moot") {
    return refuse("closed_moot", `${d} was closed as moot before this answer`, "the answer is recorded; re-ask to reverse");
  }
  const answer = state.row.answer ?? input.answer;
  const r = await release(deps, state, {
    callerRun: input.callerRun,
    resolution: `${d}: ${answer}`,
    keyFor: (task) => answerNotifiedKey(d, task),
    subject: `${d} answered`,
    resumeWith: "decision_answer",
  });
  return r.ok ? done({ status: "answered", decision: d, ...r.value }) : r;
}

// An answer rests on a recorded owner_action, or for linkedBy "observed" on the observed fact (pr_merged).
// One owner_action answers one decision (appendix #decision-loop-detail).
function sourceOf(store: Store, input: DecisionAnswerInput): Result<StoredEvent> {
  const row = store.events({ afterSeq: input.ownerAction - 1 })[0];
  const want = input.linkedBy === "observed" ? OBSERVED : ["owner_action"];
  if (row?.seq !== input.ownerAction || !want.includes(row.type)) {
    return refuse("no_owner_action", `seq ${input.ownerAction} is not a recorded ${want.join(" or ")}`, "pass the seq of the owner's recorded words or the observed event");
  }
  const other = store
    .events({ type: "decision_answered" })
    .find((e) => e.payload.owner_action === input.ownerAction && e.payload.decision !== input.decision);
  if (other) {
    return refuse("owner_action_used", `seq ${input.ownerAction} already answers ${String(other.payload.decision)}`, "one owner_action answers one decision");
  }
  return done(row);
}

const OBSERVED = ["pr_merged"];
