import type { Planned } from "../monitor.ts";
import { key } from "./judge.ts";

/** GitHub's lists caps a page here; the round asks for one page of each. */
export const PAGE = 100;

/** `issues/N/events`: a review request has its own id there; `pulls/N/requested_reviewers` has none. */
export type IssueEvent = { id: number; event: string; requested_reviewer?: { login: string } | null; requested_team?: { slug: string } | null };
export type Review = { id: number; state: string; user: { login: string } | null; submitted_at?: string | null };
export type ReviewComment = { id: number; in_reply_to_id?: number | null; user: { login: string } | null; created_at?: string | null };

/** One read per list; `unchanged` is a 304 against the last ETag, null an unread list. */
export type ReviewReads = {
  requests: IssueEvent[] | "unchanged" | null;
  reviews: Review[] | "unchanged" | null;
  comments: ReviewComment[] | "unchanged" | null;
};

type Fact = Omit<Planned, "source">;

const login = (u: { login: string } | null | undefined) => u?.login.toLowerCase();
const list = <T>(v: T[] | "unchanged" | null): T[] => (Array.isArray(v) ? v : []);
/** GitHub's own time, so a reply can be ordered after the comment it answers (decision 201). */
const at = (t: string | null | undefined) => (typeof t === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(t) ? { at: t } : {});

/**
 * The four review facts of one PR, keyed by GitHub's own ids and carrying no text (GitHub keeps it).
 * A comment by anyone but the author is `review_commented`; the author's reply in a thread is
 * `review_replied`. `full` names the oldest-first lists that filled their page, so later entries went
 * unread this round.
 */
export function reviewFacts(pr: string, author: string, reads: ReviewReads): { facts: Fact[]; full: string[] } {
  const facts: Fact[] = [];
  for (const e of list(reads.requests)) {
    if (e.event !== "review_requested") continue;
    const reviewer = login(e.requested_reviewer) ?? (e.requested_team?.slug ? `team:${e.requested_team.slug.toLowerCase()}` : undefined);
    facts.push({ type: "pr_review_requested", dedupe_key: key("pr_review_requested", pr, String(e.id)), payload: { pr, ...(reviewer ? { reviewer } : {}) } });
  }
  for (const r of list(reads.reviews)) {
    if (r.state !== "CHANGES_REQUESTED") continue;
    const reviewer = login(r.user);
    facts.push({ type: "pr_changes_requested", dedupe_key: key("pr_changes_requested", pr, String(r.id)), payload: { pr, ...(reviewer ? { reviewer } : {}), ...at(r.submitted_at) } });
  }
  for (const c of list(reads.comments)) {
    const by = login(c.user);
    if (!by) continue;
    if (by !== author) facts.push({ type: "review_commented", dedupe_key: key("review_commented", pr, String(c.id)), payload: { pr, reviewer: by, ...at(c.created_at) } });
    else if (c.in_reply_to_id) facts.push({ type: "review_replied", dedupe_key: key("review_replied", pr, String(c.id)), payload: { pr, by, ...at(c.created_at) } });
  }
  const full = (["requests", "reviews"] as const).filter((k) => list<unknown>(reads[k]).length >= PAGE);
  return { facts, full };
}
