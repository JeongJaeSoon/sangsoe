import type { ReadyRow, ViewInput } from "../contract/views.ts";
import { itemGraph, longestPath, weightOf } from "./critical.ts";
import { type EdgeKind, foldFacts } from "./facts.ts";
import { readiness, why } from "./ready.ts";

// The read port brief (U9) and other readers take: plain task ids, one shape for edges from both homes.

export interface GraphEdge {
  /** A task id, or `pr:owner/repo#N` / `decision:dNNN` for a non-item predecessor. */
  readonly pred: string;
  readonly succ: string;
  readonly kind: EdgeKind;
}

export interface GraphWhyEdge extends GraphEdge {
  readonly predState: string;
  /** A ✅-less end the lead resolves (decision 26): cancelled, or a PR closed without merge. */
  readonly dangling: boolean;
  readonly todo: string;
}

const bare =(ref: string) => (ref.startsWith("item:") ? ref.slice(5) : ref);

export const graphRead = {
  /**
   * Every 🟢 item, the owner's included: item state reads this (decision 147). A lead's start list
   * is ready(), which leaves owner_ready out.
   */
  ready: (input: ViewInput): ReadyRow[] =>
    readiness(input)
      .filter((r) => r.readiness === "ready" || r.readiness === "owner_ready")
      .map((r) => ({ task: r.task, alias: r.item === r.task ? null : r.item })),
  /** Every live edge: Orca deps (as blocks) and extra edges. */
  edges(input: ViewInput): GraphEdge[] {
    const facts = foldFacts(input.events);
    const orca = input.orca.tasks.flatMap((t) => t.deps.map((d) => ({ pred: d, succ: t.id, kind: "blocks" as const })));
    return [...orca, ...facts.edges.map((e) => ({ pred: bare(e.pred), succ: bare(e.succ), kind: e.kind }))];
  },
  /** Longest chain among `tasks` (unfinished ones only); first = what slows things now, [] if none. */
  criticalPath(input: ViewInput, tasks: readonly string[]): string[] {
    const facts = foldFacts(input.events);
    const g = itemGraph(input, facts);
    const keep = new Set(g.nodes.filter((n) => tasks.includes(n)));
    const preds = new Map([...keep].map((n) => [n, (g.preds.get(n) ?? []).filter((p) => keep.has(p))]));
    const order = (t: string) => facts.items.get(t)?.createdSeq ?? 1e9 + tasks.indexOf(t);
    return longestPath([...keep], preds, (t) => weightOf(facts.items.get(t)?.est) ?? 1, order).path;
  },
  /** The unmet edges into `task` (trigger and hold rows left out), with the why table's state and to-do. */
  why(input: ViewInput, task: string): GraphWhyEdge[] {
    return why(input, task)
      .rows.filter((r) => r.kind !== "trigger" && r.kind !== "hold" && r.kind !== "orca")
      .map((r) => ({ pred: bare(r.pred), succ: task, kind: r.kind as EdgeKind, predState: r.predState, dangling: r.dangling, todo: r.todo }));
  },
};
