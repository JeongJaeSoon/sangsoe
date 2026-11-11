import type { StoredEvent } from "../contract/index.ts";

// Decision 215 (G31): a PR whose base changed needs a clean review verdict recorded after that
// change. Derived from pr_base_changed and review_verdict only; the re-review item GRAPH makes for
// it is never read back here.

export type BaseChange = { readonly from: string; readonly to: string; readonly seq: number };

/** The PR's latest base change, or null when its base never changed. */
export function lastBaseChange(events: readonly StoredEvent[], pr: string): BaseChange | null {
  const e = events.filter((x) => x.type === "pr_base_changed" && x.payload.pr === pr).at(-1);
  return e ? { from: String(e.payload.from), to: String(e.payload.to), seq: e.seq } : null;
}

/** Verdicts on the PR that count now: those recorded after its latest base change. */
export function verdictsSinceBase(events: readonly StoredEvent[], pr: string): StoredEvent[] {
  const since = lastBaseChange(events, pr)?.seq ?? 0;
  return events.filter((e) => e.type === "review_verdict" && e.payload.pr === pr && e.seq > since);
}

/**
 * The re-review item made for the base change at `since`: an item created after it whose blocks
 * edge ends at one of the PR's items. Returns its alias, or null when none was made yet.
 */
export function rereviewItem(events: readonly StoredEvent[], pr: string, since: number): string | null {
  const prItems = new Set(events.filter((e) => e.type === "pr_opened" && e.payload.pr === pr && typeof e.payload.task === "string").map((e) => `item:${String(e.payload.task)}`));
  const made = new Map(events.filter((e) => e.type === "item_created" && e.seq > since).map((e) => [`item:${String(e.payload.task)}`, String(e.payload.alias)]));
  const edge = events.find((e) => e.type === "edge_added" && e.payload.kind === "blocks" && prItems.has(String(e.payload.succ)) && made.has(String(e.payload.pred)));
  return edge ? (made.get(String(edge.payload.pred)) ?? null) : null;
}

/**
 * The base change still waiting on its re-review: no verdict with 0 Act-on recorded after it (at
 * `head`, when given). Null when the base never changed or the re-review is in.
 */
export function pendingRereview(events: readonly StoredEvent[], pr: string, head?: string): BaseChange | null {
  const change = lastBaseChange(events, pr);
  if (!change) return null;
  const clean = verdictsSinceBase(events, pr).some((e) => Number(e.payload.act_on) === 0 && (head === undefined || e.payload.head_sha === head));
  return clean ? null : change;
}
