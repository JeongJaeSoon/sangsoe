import type { OrcaSnapshot } from "../contract/views.ts";
import type { CoreDeps } from "../notify/result.ts";
import { addEdgeTo } from "./edit.ts";
import { foldFacts } from "./facts.ts";
import { itemRef, prNode } from "./nodes.ts";

// `graph sync` (decision 50): queue-monitor calls it after detector signals pile up. Detectors only write
// signals; GRAPH turns them into edges. pr_opened does not carry a PR's base, so the caller (which reads
// GitHub) passes the stack facts it saw: which open PR sits on which other PR.

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

export function syncGraph(deps: Pick<CoreDeps, "store">, snapshot: OrcaSnapshot, stacks: readonly StackFact[] = []): SyncResult {
  const facts = foldFacts(deps.store.events());
  const added: string[] = [];
  const refused: string[] = [];
  for (const s of stacks) {
    const pr = facts.prs.get(s.pr);
    if (!pr || pr.merged || pr.closed) continue;
    for (const task of pr.tasks) {
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
