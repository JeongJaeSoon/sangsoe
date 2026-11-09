import { ContractError, defineEvent, int, match, prRef } from "../define.ts";

// One independent review's verdict on one PR head (decision 111). Only `sangsoe review record`
// writes it; `sangsoe plugin approve` reads review evidence from these rows and nowhere else.
// dedupe_key review_verdict:<pr>:<head_sha>:<reviewer>: a reviewer's first verdict on a head stands.
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
    dedupeBound: (p) => [p.pr, p.head_sha, p.reviewer],
    dedupeClosed: true,
    sources: ["review record"],
  },
);
