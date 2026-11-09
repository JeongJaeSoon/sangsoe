import type { ItemTimelineView, StoredEvent } from "../../contract/index.ts";

const NOISE: ReadonlySet<string> = new Set(["turn_ended", "worker_idle", "compacted", "observed_change"]);

const s = (v: unknown): string | null => (typeof v === "string" ? v : null);

// One item's events in seq order: the owner_action that made it, its owner_class, transitions,
// evidence, signals of PRs linked to it, and its decisions. Session noise is dropped.
export const item_timeline: ItemTimelineView = (input, task) => {
  const prs = new Set<string>();
  const decisions = new Set<string>();
  const ownerActions = new Set<string>();
  for (const e of input.events) {
    const d = s(e.payload.decision);
    if (e.type === "decision_joined" && d && s(e.payload.waiter) === task) decisions.add(d);
    if (s(e.payload.task) !== task) continue;
    const pr = s(e.payload.pr);
    if (e.type === "pr_opened" && pr) prs.add(pr);
    if (e.type === "decision_opened" && d) decisions.add(d);
    if (e.type === "item_created") ownerActions.add(`owner_action:${String(e.payload.owner_action)}`);
  }
  const belongs = (e: StoredEvent): boolean => {
    if (NOISE.has(e.type)) return false;
    const p = e.payload;
    if (s(p.task) === task || s(p.waiter) === task) return true;
    if (e.type === "owner_action" && ownerActions.has(`owner_action:${e.seq}`)) return true;
    if (e.subject !== null && ownerActions.has(e.subject)) return true;
    const pr = s(p.pr);
    if (pr && prs.has(pr)) return true;
    const d = s(p.decision);
    return d !== null && decisions.has(d);
  };
  return input.events
    .filter(belongs)
    .sort((a, b) => a.seq - b.seq)
    .map((e) => ({ seq: e.seq, ts: e.ts, type: e.type, payload: e.payload }));
};
