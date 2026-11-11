import type { ReadyRow, ViewInput } from "../contract/index.ts";

export type EdgeKind = "blocks" | "after" | "stacked_on" | "deploys_after";

/** One edge between Orca task ids (or a PR/decision as `pred`), as GRAPH reports it. */
export interface Edge {
  readonly pred: string;
  readonly succ: string;
  readonly kind: EdgeKind;
}

/**
 * The read side of GRAPH that stage 2 needs (the ready view, edge view, critical path and
 * `sangsoe graph why`). buildBrief takes it as a port; core/graph's `graphRead` is the body.
 */
export interface GraphRead {
  ready(input: ViewInput): readonly ReadyRow[];
  edges(input: ViewInput): readonly Edge[];
  /** Longest open chain inside `tasks`, first element is what slows them now. */
  criticalPath(input: ViewInput, tasks: readonly string[]): readonly string[];
  /** Unmet predecessors of one task, and what holds it (decision 218). */
  why(input: ViewInput, task: string): readonly (Omit<Edge, "kind"> & { readonly kind: EdgeKind | "pr" | "gate" | "orca" })[];
}
