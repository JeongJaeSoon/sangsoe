import { dedupeSegment } from "./dedupe.ts";

/** The `notified` row a delivery about one Task writes: `target` is the Task, the key binds it first. */
export interface NotifiedKey {
  readonly target: string;
  readonly dedupe_key: string;
}

// Decision 91④ spells the key `notified:dNNN:<task>`; the `notified` type owns the prefix `notify` and
// binds its first segment to the row's target, so the one accepted spelling is `notify:<task>:dNNN`.
// decision_answer, the start procedure (first prompt) and SessionStart all check this same key, so an
// answer reaches each waiter Task once whoever delivers it (decision 0116).
export function answerNotifiedKey(decision: string, task: string): NotifiedKey {
  return { target: task, dedupe_key: `notify:${dedupeSegment(task)}:${dedupeSegment(decision)}` };
}

/** Decision 91③: a moot decision tells each waiter once, under `moot:dNNN`. */
export function mootNotifiedKey(decision: string, task: string): NotifiedKey {
  return { target: task, dedupe_key: `notify:${dedupeSegment(task)}:moot:${dedupeSegment(decision)}` };
}
