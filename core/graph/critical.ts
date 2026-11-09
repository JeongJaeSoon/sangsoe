import type { ViewInput, ViewTask } from "../contract/views.ts";
import { type Facts, foldFacts } from "./facts.ts";
import { parseNode } from "./nodes.ts";

// Decision 29 and appendix "크리티컬 패스": the longest chain of unfinished items in one group (a
// lead), external predecessors from other groups included as named endpoints. A node weighs its `est`
// when that is a positive number, else 1 (a step). A pure function over the edge and item reads.

export interface CriticalNode {
  readonly task: string;
  readonly item: string;
  readonly weight: number;
  /** Set when the node belongs to another group: an external predecessor. */
  readonly externalGroup?: string;
}

export interface CriticalPath {
  readonly path: readonly CriticalNode[];
  readonly length: number;
  /** Some node on the path weighed its est: the length is an estimate (decision 29). */
  readonly estimated: boolean;
  /** What holds things up now: the first node on the path. */
  readonly slowest: CriticalNode | null;
}

const finished = (t: ViewTask) => t.status === "completed" || t.status === "failed";

export interface ItemGraph {
  readonly nodes: readonly string[];
  readonly preds: ReadonlyMap<string, readonly string[]>;
}

/** Unfinished items and the item → item edges among them, from Orca deps and extra edges. */
export function itemGraph(input: ViewInput, facts: Facts): ItemGraph {
  const live = new Set(input.orca.tasks.filter((t) => !finished(t)).map((t) => t.id));
  const preds = new Map<string, string[]>();
  const link = (p: string, s: string) => {
    if (!live.has(p) || !live.has(s)) return;
    const list = preds.get(s) ?? [];
    if (!list.includes(p)) list.push(p);
    preds.set(s, list);
  };
  for (const t of input.orca.tasks) for (const d of t.deps) link(d, t.id);
  for (const e of facts.edges) {
    const p = parseNode(e.pred);
    const s = parseNode(e.succ);
    if (p?.kind === "item" && s?.kind === "item") link(p.task, s.task);
  }
  return { nodes: [...live], preds };
}

export const weightOf = (est: string | undefined): number | undefined => {
  const n = est === undefined ? Number.NaN : Number(est);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** Longest path in a DAG; on equal length the earlier-ordered node wins (`order` = creation order). */
export function longestPath(
  nodes: readonly string[],
  preds: ReadonlyMap<string, readonly string[]>,
  weight: (n: string) => number,
  order: (n: string) => number,
): { path: string[]; length: number } {
  const sorted = [...nodes].sort((a, b) => order(a) - order(b));
  const indeg = new Map(sorted.map((n) => [n, (preds.get(n) ?? []).length]));
  const succs = new Map<string, string[]>();
  for (const n of sorted) for (const p of preds.get(n) ?? []) succs.set(p, [...(succs.get(p) ?? []), n]);
  const queue = sorted.filter((n) => indeg.get(n) === 0);
  const topo: string[] = [];
  while (queue.length > 0) {
    queue.sort((a, b) => order(a) - order(b));
    const n = queue.shift() as string;
    topo.push(n);
    for (const s of succs.get(n) ?? []) {
      indeg.set(s, (indeg.get(s) ?? 0) - 1);
      if (indeg.get(s) === 0) queue.push(s);
    }
  }
  if (topo.length !== sorted.length) throw new Error("critical path: the item graph has a cycle");
  const dist = new Map<string, number>();
  const back = new Map<string, string>();
  for (const n of topo) {
    let best: string | undefined;
    for (const p of preds.get(n) ?? []) {
      const better = best === undefined || (dist.get(p) ?? 0) > (dist.get(best) ?? 0) || ((dist.get(p) ?? 0) === (dist.get(best) ?? 0) && order(p) < order(best));
      if (better) best = p;
    }
    dist.set(n, weight(n) + (best === undefined ? 0 : (dist.get(best) ?? 0)));
    if (best !== undefined) back.set(n, best);
  }
  let end: string | undefined;
  for (const n of sorted) if (end === undefined || (dist.get(n) ?? 0) > (dist.get(end) ?? 0)) end = n;
  if (end === undefined) return { path: [], length: 0 };
  const path = [end];
  for (let c = back.get(end); c !== undefined; c = back.get(c)) path.unshift(c);
  return { path, length: dist.get(end) ?? 0 };
}

/** `graph critical [--lead L]`: without a lead, every unfinished item counts. */
export function criticalPath(input: ViewInput, lead?: string): CriticalPath {
  const facts = foldFacts(input.events);
  const g = itemGraph(input, facts);
  const inGroup = (t: string) => lead === undefined || facts.items.get(t)?.lead === lead;
  // Group items plus every unfinished ancestor outside the group (external predecessors).
  const keep = new Set(g.nodes.filter(inGroup));
  const stack = [...keep];
  while (stack.length > 0) {
    for (const p of g.preds.get(stack.pop() as string) ?? []) {
      if (!keep.has(p)) {
        keep.add(p);
        stack.push(p);
      }
    }
  }
  const index = new Map(input.orca.tasks.map((t, i) => [t.id, i]));
  const order = (t: string) => facts.items.get(t)?.createdSeq ?? 1e9 + (index.get(t) ?? 0);
  const weight = (t: string) => weightOf(facts.items.get(t)?.est) ?? 1;
  const nodes = [...keep];
  const preds = new Map(nodes.map((n) => [n, (g.preds.get(n) ?? []).filter((p) => keep.has(p))]));
  const { path, length } = longestPath(nodes, preds, weight, order);
  const out: CriticalNode[] = path.map((t) => {
    const x = facts.items.get(t);
    return { task: t, item: x?.alias ?? t, weight: weight(t), ...(inGroup(t) ? {} : { externalGroup: x?.lead ?? "(묶음 모름)" }) };
  });
  return { path: out, length, estimated: path.some((t) => weightOf(facts.items.get(t)?.est) !== undefined), slowest: out[0] ?? null };
}

export interface ImpactRow {
  readonly task: string;
  readonly item: string;
  readonly distance: number;
  readonly lead: string | null;
  readonly priority: string;
}

/** `graph impact <item>`: unfinished items reachable downstream, nearest first. */
export function impact(input: ViewInput, task: string): ImpactRow[] {
  const facts = foldFacts(input.events);
  const start = facts.aliases.get(task) ?? task;
  const g = itemGraph(input, facts);
  const succs = new Map<string, string[]>();
  for (const [s, ps] of g.preds) for (const p of ps) succs.set(p, [...(succs.get(p) ?? []), s]);
  const dist = new Map<string, number>([[start, 0]]);
  const queue = [start];
  while (queue.length > 0) {
    const n = queue.shift() as string;
    for (const s of succs.get(n) ?? []) {
      if (dist.has(s)) continue;
      dist.set(s, (dist.get(n) ?? 0) + 1);
      queue.push(s);
    }
  }
  return [...dist]
    .filter(([t]) => t !== start)
    .map(([t, d]) => {
      const x = facts.items.get(t);
      return { task: t, item: x?.alias ?? t, distance: d, lead: x?.lead ?? null, priority: x?.priority ?? "P2" };
    })
    .sort((a, b) => a.distance - b.distance || a.item.localeCompare(b.item));
}
