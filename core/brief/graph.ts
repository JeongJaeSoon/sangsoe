import type { ReadyRow, ViewInput } from "../contract/index.ts";

export type EdgeKind = "blocks" | "after" | "stacked_on" | "deploys_after";

/** One edge between Orca task ids (or a PR/decision as `pred`), as GRAPH reports it. */
export interface Edge {
  readonly pred: string;
  readonly succ: string;
  readonly kind: EdgeKind;
}

/**
 * The read side of GRAPH that stage 2 needs (U7 owns the bodies: the ready view, edge view, critical
 * path and `sangsoe graph why`). buildBrief takes it as a port so U7's functions replace `depsGraph`
 * without touching the brief.
 */
export interface GraphRead {
  ready(input: ViewInput): readonly ReadyRow[];
  edges(input: ViewInput): readonly Edge[];
  /** Longest open chain inside `tasks`, first element is what slows them now. */
  criticalPath(input: ViewInput, tasks: readonly string[]): readonly string[];
  /** Unmet predecessors of one task. */
  why(input: ViewInput, task: string): readonly Edge[];
}

const closed = (input: ViewInput) =>
  new Set(input.orca.tasks.filter((t) => t.status === "completed" || (t.status === "failed" && t.result === "cancelled")).map((t) => t.id));

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * Stand-in until U7 lands: Orca `deps` as `blocks` edges plus edge_added rows not removed later. No
 * cycle check and no trigger reading; those are GRAPH's.
 */
export const depsGraph: GraphRead = {
  edges(input) {
    const out = new Map<string, Edge>();
    for (const t of input.orca.tasks) for (const d of t.deps) out.set(`${d}>${t.id}>blocks`, { pred: d, succ: t.id, kind: "blocks" });
    for (const e of input.events) {
      const pred = str(e.payload.pred);
      const succ = str(e.payload.succ);
      const kind = str(e.payload.kind) as EdgeKind | null;
      if (!pred || !succ || !kind) continue;
      const key = `${pred}>${succ}>${kind}`;
      if (e.type === "edge_added") out.set(key, { pred, succ, kind });
      if (e.type === "edge_removed") out.delete(key);
    }
    return [...out.values()];
  },
  ready(input) {
    const done = closed(input);
    const held = new Set(input.events.filter((e) => e.type === "item_extra_set" && e.payload.hold === true).map((e) => String(e.payload.task)));
    const preds = new Map<string, string[]>();
    for (const e of this.edges(input)) preds.set(e.succ, [...(preds.get(e.succ) ?? []), e.pred]);
    return input.orca.tasks
      .filter((t) => t.status === "ready" || (t.status === "pending" && !held.has(t.id) && (preds.get(t.id) ?? []).every((p) => done.has(p))))
      .map((t) => ({ task: t.id, alias: null }));
  },
  criticalPath(input, tasks) {
    const done = closed(input);
    const open = new Set(tasks.filter((t) => !done.has(t)));
    const next = new Map<string, string[]>();
    for (const e of this.edges(input)) if (open.has(e.pred) && open.has(e.succ)) next.set(e.pred, [...(next.get(e.pred) ?? []), e.succ]);
    const memo = new Map<string, string[]>();
    const longest = (t: string, seen: Set<string>): string[] => {
      const hit = memo.get(t);
      if (hit) return hit;
      let best: string[] = [];
      for (const s of next.get(t) ?? []) {
        if (seen.has(s)) continue;
        const p = longest(s, new Set([...seen, s]));
        if (p.length > best.length) best = p;
      }
      const path = [t, ...best];
      memo.set(t, path);
      return path;
    };
    let best: string[] = [];
    for (const t of open) {
      const p = longest(t, new Set([t]));
      if (p.length > best.length) best = p;
    }
    return best.length > 1 ? best : [];
  },
  why(input, task) {
    const done = closed(input);
    return this.edges(input).filter((e) => e.succ === task && !done.has(e.pred));
  },
};
