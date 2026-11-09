import type { Decision, Verdict } from "./types.ts";

export type Merged = { decision: Decision | "none"; verdicts: Verdict[] };

const RANK: Record<Decision, number> = { allow: 0, ask: 1, deny: 2 };

/** deny > ask > allow (appendix #gates, #413). Every verdict at the winning level is kept, in input order. */
export function mergeVerdicts(verdicts: readonly Verdict[]): Merged {
  if (verdicts.length === 0) return { decision: "none", verdicts: [] };
  const top = verdicts.reduce((m, v) => (RANK[v.decision] > RANK[m] ? v.decision : m), "allow" as Decision);
  return { decision: top, verdicts: verdicts.filter((v) => v.decision === top) };
}
