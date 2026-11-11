import type { OrcaSnapshot } from "../contract/views.ts";
import type { CoreDeps } from "../notify/result.ts";
import { addEdgeTo, removeEdgeFrom } from "./edit.ts";
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
  /** stacked_on edges removed because the stacked PR's base no longer is the pred PR's head. */
  readonly unstacked: readonly string[];
  /** PRs whose base changed, for the round's log; decision 215's re-review item re-checks their verdict. */
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
 * Decision 215: a PR whose base moved off another PR's head branch is no longer stacked on it. Its
 * stacked_on edge from that PR is removed, so land stops refusing stack_order on it. An edge to a PR
 * whose head was never this PR's base is an ordering a session chose, and stays.
 */
function unstack(deps: Pick<CoreDeps, "store">, snapshot: OrcaSnapshot, facts: Facts, refused: string[]): string[] {
  const left = new Map<string, Set<string>>();
  for (const e of deps.store.events({ type: "pr_base_changed" })) {
    const pr = String(e.payload.pr);
    left.set(pr, (left.get(pr) ?? new Set()).add(String(e.payload.from)));
  }
  const out: string[] = [];
  for (const e of facts.edges) {
    if (e.kind !== "stacked_on" || !e.pred.startsWith("pr:")) continue;
    const below = facts.prs.get(e.pred.slice(3));
    if (below?.head === undefined) continue;
    for (const p of facts.prs.values()) {
      if (!isOpen(p) || repoOf(p.pr) !== repoOf(below.pr) || !p.tasks.has(e.succ.replace(/^item:/, ""))) continue;
      if (!left.get(p.pr)?.has(below.head) || p.base === below.head) continue;
      // The edge is the item's: another open PR of it still on that head keeps it.
      const task = e.succ.replace(/^item:/, "");
      if ([...facts.prs.values()].some((q) => isOpen(q) && q.tasks.has(task) && repoOf(q.pr) === repoOf(below.pr) && q.base === below.head)) break;
      const r = removeEdgeFrom(deps, snapshot, { pred: e.pred, succ: e.succ, kind: "stacked_on", reason: `${p.pr}'s base is ${p.base}, not ${below.pr}'s head ${below.head}` });
      if (r.ok) out.push(`${e.pred} → ${e.succ}`);
      else refused.push(`${p.pr}: ${r.refusal.code} ${r.refusal.reason}`);
      break;
    }
  }
  return out;
}

/**
 * `infer` adds the stacks inferStacks reads, except an edge a session removed: removing it is the
 * session's call, and the next round must not put it back. Stacks the caller names are added as given.
 */
export function syncGraph(deps: Pick<CoreDeps, "store">, snapshot: OrcaSnapshot, stacks: readonly StackFact[] = [], o: { infer?: boolean } = {}): SyncResult {
  const added: string[] = [];
  const refused: string[] = [];
  const unstacked = o.infer ? unstack(deps, snapshot, foldFacts(deps.store.events()), refused) : [];
  const facts = foldFacts(deps.store.events());
  const inferred = o.infer ? inferStacks(facts).map((s) => ({ ...s, inferred: true })) : [];
  for (const s of [...stacks.map((x) => ({ ...x, inferred: false })), ...inferred]) {
    const pr = facts.prs.get(s.pr);
    if (!pr || pr.merged || pr.closed) continue;
    for (const task of pr.tasks) {
      // Two PRs of one task stacked on each other order themselves by their base; an edge would make the lower one wait on itself.
      if (s.inferred && facts.prs.get(s.base)?.tasks.has(task)) continue;
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
  return { added, unstacked, relandPrs, dangling, met, refused };
}
