import type { OrcaSnapshot } from "../contract/views.ts";
import type { CoreDeps } from "../notify/result.ts";
import { addEdgeTo } from "./edit.ts";
import { edgeId, type Facts, foldFacts, type PrFact } from "./facts.ts";
import { itemRef, prNode } from "./nodes.ts";

// `graph sync` (decision 50): queue-monitor calls it after detector signals pile up. Detectors only write
// signals; GRAPH turns them into edges. queue-monitor infers stacks from pr_opened's head and base rows
// (decision 212 ③); `graph sync --stack` still passes a stack fact by hand.

export interface StackFact {
  readonly pr: string;
  readonly base: string;
}

export interface SyncResult {
  /** stacked_on edges added (pred PR → item the stacked PR belongs to). */
  readonly added: readonly string[];
  /** PRs whose base changed: their lead re-requests land so the verdict is re-checked at the new head. */
  readonly relandPrs: readonly string[];
  /** Edges whose predecessor PR closed unmerged: shown as dangling by why until the lead decides. */
  readonly dangling: readonly string[];
  /** Edges from merged PRs: met on the next ready read; nothing is written for them. */
  readonly met: readonly string[];
  readonly refused: readonly string[];
}

const repoOf = (pr: string) => pr.slice(0, pr.indexOf("#"));
const isOpen = (p: PrFact) => p.opened && !p.merged && !p.closed;

/**
 * The stacks pr-monitor's rows already show: an open PR whose base branch is the head branch of exactly
 * one other open PR in the same repository. A branch two open PRs share says nothing.
 */
export function inferStacks(facts: Facts): StackFact[] {
  const heads = new Map<string, string[]>();
  for (const p of facts.prs.values()) {
    if (!isOpen(p) || p.head === undefined) continue;
    const k = `${repoOf(p.pr)}\n${p.head}`;
    heads.set(k, [...(heads.get(k) ?? []), p.pr]);
  }
  const out: StackFact[] = [];
  for (const p of facts.prs.values()) {
    if (!isOpen(p) || p.base === undefined) continue;
    const on = heads.get(`${repoOf(p.pr)}\n${p.base}`) ?? [];
    if (on.length === 1 && on[0] !== p.pr) out.push({ pr: p.pr, base: on[0] as string });
  }
  return out;
}

/**
 * `infer` adds the stacks inferStacks reads, except an edge a session removed: removing it is the
 * session's call, and the next round must not put it back. Stacks the caller names are added as given.
 */
export function syncGraph(deps: Pick<CoreDeps, "store">, snapshot: OrcaSnapshot, stacks: readonly StackFact[] = [], o: { infer?: boolean } = {}): SyncResult {
  const facts = foldFacts(deps.store.events());
  const added: string[] = [];
  const refused: string[] = [];
  const inferred = o.infer ? inferStacks(facts).map((s) => ({ ...s, inferred: true })) : [];
  for (const s of [...stacks.map((x) => ({ ...x, inferred: false })), ...inferred]) {
    const pr = facts.prs.get(s.pr);
    if (!pr || pr.merged || pr.closed) continue;
    for (const task of pr.tasks) {
      if (s.inferred && facts.removals.has(edgeId(prNode(s.base), itemRef(task), "stacked_on"))) continue;
      const r = addEdgeTo(deps, snapshot, { pred: prNode(s.base), succ: itemRef(task), kind: "stacked_on" });
      if (r.ok && r.value.status === "added") added.push(`${prNode(s.base)} → ${itemRef(task)}`);
      if (!r.ok) refused.push(`${s.pr}: ${r.refusal.code} ${r.refusal.reason}`);
    }
  }
  const relandPrs = [...new Set(deps.store.events({ type: "pr_base_changed" }).map((e) => String(e.payload.pr)))].filter((p) => !facts.prs.get(p)?.merged);
  const after = foldFacts(deps.store.events());
  const boundTo = (pr: string) => [...(after.prs.get(pr)?.tasks ?? [])].map(itemRef);
  const dangling: string[] = [];
  const met: string[] = [];
  for (const e of after.edges) {
    const prs = e.pred.startsWith("pr:") ? [e.pred.slice(3)] : [...after.prs.values()].filter((p) => boundTo(p.pr).includes(e.pred)).map((p) => p.pr);
    if (prs.some((p) => after.prs.get(p)?.closed && !after.prs.get(p)?.merged) && e.kind !== "after") dangling.push(`${e.pred} → ${e.succ} (${e.kind})`);
    else if (prs.length > 0 && prs.every((p) => after.prs.get(p)?.merged)) met.push(`${e.pred} → ${e.succ} (${e.kind})`);
  }
  return { added, relandPrs, dangling, met, refused };
}
