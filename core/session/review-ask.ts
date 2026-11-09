import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { prRef } from "../contract/index.ts";
import { done, type Result, refuse } from "../notify/result.ts";
import type { Store } from "../store/store.ts";

export interface ReviewAsk {
  readonly pr: string;
  readonly reviewer: string;
  readonly reminder: boolean;
}

export function parseReviewAsk(raw: Readonly<Record<string, unknown>>): Result<ReviewAsk> {
  const pr = typeof raw.pr === "string" ? raw.pr.trim().toLowerCase() : "";
  try {
    prRef(pr, "pr");
  } catch {
    return refuse("bad_input", "pr: expected owner/repo#N", "pass the PR as owner/repo#N, e.g. acme/api#12");
  }
  if (typeof raw.reviewer !== "string" || raw.reviewer.trim() === "") return refuse("bad_input", "reviewer: expected a name", "pass the reviewer's handle");
  if (raw.reminder !== undefined && typeof raw.reminder !== "boolean") return refuse("bad_input", "reminder: expected true or false", "omit reminder or pass a boolean");
  return done({ pr, reviewer: raw.reviewer.trim(), reminder: raw.reminder === true });
}

/** The reviewer map in ~/.config/sangsoe/config.json (`reviewers`: handle → anything); none when unread. */
export function configuredReviewers(home: string = homedir()): ReadonlySet<string> {
  try {
    const cfg = JSON.parse(readFileSync(join(home, ".config", "sangsoe", "config.json"), "utf8")) as { reviewers?: unknown };
    return new Set(cfg.reviewers && typeof cfg.reviewers === "object" ? Object.keys(cfg.reviewers) : []);
  } catch {
    return new Set();
  }
}

/**
 * review_ask_record (design N6): one review_ask_sent row per ask or reminder, the one entrance for asks
 * sent by hand or by a skill. A reviewer the config does not map is not skipped silently: it also gets
 * unmapped_reviewer, once per reviewer.
 */
export function reviewAskRecord(store: Store, raw: Readonly<Record<string, unknown>>, reviewers: ReadonlySet<string>): Result<{ seq: number; unmapped: boolean }> {
  const parsed = parseReviewAsk(raw);
  if (!parsed.ok) return parsed;
  const { pr, reviewer, reminder } = parsed.value;
  const r = store.append({ type: "review_ask_sent", source: "review_ask_record", subject: `pr:${pr}`, payload: { pr, reviewer, ...(reminder ? { reminder } : {}) } });
  const unmapped = !reviewers.has(reviewer);
  if (unmapped) {
    store.append({
      type: "unmapped_reviewer",
      source: "review_ask_record",
      dedupe_key: `unmapped_reviewer:${encodeURIComponent(reviewer)}`,
      payload: { reviewer },
    });
  }
  return done({ seq: r.seq, unmapped });
}
