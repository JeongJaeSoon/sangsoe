// `review_verdict` (decision 111): its one writer, `sangsoe review record`, and the one reader
// `sangsoe plugin approve` uses for condition (1).
import { ContractError, dedupeKey, EVENTS, type StoredEvent } from "../contract/index.ts";
import type { Store } from "../store/store.ts";
import { type Exec, FULL_SHA, type ReviewEvidence } from "./approve.ts";

export type ReviewRecordInput = { repo: string; pr: number; head: string; actOn: number; reviewer: string };
export type ReviewRecordResult = { ok: boolean; inserted: boolean; seq: number | null; author: string | null; note: string };

const prRefOf = (repo: string, pr: number) => `${repo.toLowerCase()}#${pr}`;

export async function recordReviewVerdict(
  input: ReviewRecordInput,
  deps: { exec: Exec; openStore: () => Store },
): Promise<ReviewRecordResult> {
  const fail = (note: string, author: string | null = null): ReviewRecordResult => ({ ok: false, inserted: false, seq: null, author, note });
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repo)) return fail(`repo must be owner/name, got ${input.repo}`);
  if (!Number.isInteger(input.pr) || input.pr < 1) return fail(`pr must be a PR number, got ${input.pr}`);
  if (!FULL_SHA.test(input.head)) return fail(`head must be a full 40-character sha, got ${input.head}`);
  if (!Number.isInteger(input.actOn) || input.actOn < 0) return fail(`act-on must be a count, got ${input.actOn}`);
  if (input.reviewer.trim() === "") return fail("reviewer is empty");

  // The author comes from GitHub, never from the caller, so a caller cannot name someone else.
  const pr = await deps.exec("gh", ["api", `repos/${input.repo}/pulls/${input.pr}`, "--jq", ".user.login"]);
  const author = pr.stdout.trim();
  if (pr.code !== 0 || author === "") return fail(`cannot read the author of ${input.repo}#${input.pr}: ${pr.stderr.trim() || pr.code}`);
  if (author.toLowerCase() === input.reviewer.toLowerCase()) return fail(`${input.reviewer} is the author of ${input.repo}#${input.pr}`, author);

  const ref = prRefOf(input.repo, input.pr);
  let store: Store;
  try {
    store = deps.openStore();
  } catch (e) {
    return fail(`cannot open the store: ${e instanceof Error ? e.message : String(e)}`, author);
  }
  try {
    const out = store.append({
      type: "review_verdict",
      source: "review record",
      actor: input.reviewer,
      dedupe_key: dedupeKey(EVENTS.review_verdict, ref, input.head, input.reviewer),
      payload: { pr: ref, head_sha: input.head, act_on: input.actOn, reviewer: input.reviewer, author },
    });
    const note = out.inserted
      ? `recorded: ${ref} ${input.head} reviewed by ${input.reviewer}, ${input.actOn} Act-on`
      : `already recorded: ${input.reviewer}'s verdict on ${ref} ${input.head} stands (seq ${out.seq})`;
    return { ok: true, inserted: out.inserted, seq: out.seq, author, note };
  } catch (e) {
    if (e instanceof ContractError) return fail(e.message, author);
    throw e;
  } finally {
    store.close();
  }
}

// Every recorded verdict on the head counts: one with Act-on findings outweighs any clean one.
export function reviewEvidenceFrom(
  events: readonly StoredEvent[],
  repo: string,
  pr: number,
  headSha: string,
): ReviewEvidence | null {
  const ref = prRefOf(repo, pr);
  const rows = events.filter((e) => e.type === "review_verdict" && e.payload.pr === ref && e.payload.head_sha === headSha);
  const pick = rows.find((e) => Number(e.payload.act_on) > 0) ?? rows[0];
  if (!pick) return null;
  return {
    headSha: String(pick.payload.head_sha),
    actOn: Number(pick.payload.act_on),
    reviewer: String(pick.payload.reviewer),
    author: String(pick.payload.author),
  };
}
