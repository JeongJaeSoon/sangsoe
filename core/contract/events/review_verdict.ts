import { ContractError, defineEvent, int, match, prRef } from "../define.ts";

// One independent review's verdict on one PR head (decision 111). `sangsoe review record` and the
// review_record tool write it (decision 162); `sangsoe plugin approve` and land read these rows.
// dedupe_key review_verdict:<pr>:<head_sha>:<reviewer>:<act_on>: a repeat of the same count stands,
// another count is a second row, and a row with Act-on findings outweighs a clean one (S2).
const identity = match(/^[a-z0-9][a-z0-9_.-]*$/, "lowercase login or reviewer name");

export default defineEvent(
  "review_verdict",
  {
    pr: prRef,
    head_sha: match(/^[0-9a-f]{40}$/, "full 40-character sha"),
    act_on: int,
    reviewer: identity,
    author: identity,
  },
  {
    refine: (v, p) => {
      if (Number(v.act_on) < 0) throw new ContractError(`${p}.act_on: a count, not ${String(v.act_on)}`);
      if (v.reviewer === v.author) throw new ContractError(`${p}.reviewer: the PR's author cannot review it`);
    },
    // Not closed: rows written before the count joined the key end at the reviewer and still read.
    dedupeBound: (p) => [p.pr, p.head_sha, p.reviewer],
    sources: ["review record"],
  },
);
