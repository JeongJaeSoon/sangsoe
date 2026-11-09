import { arr, ContractError, defineEvent, int, opt, sha, str } from "../define.ts";

// kind: a verify kind, probe:<kind>, or owner_act:seen|failed|proposed. Large outputs are a path + sha256.
// observed: what a probe or an owner `!` command showed (a run id, a field value, a PR found).
export default defineEvent(
  "evidence",
  {
    kind: str,
    head_sha: opt(sha),
    exit_code: opt(int),
    not_verified: opt(arr(str)),
    path: opt(str),
    sha256: opt(str),
    observed: opt(str),
  },
  {
    refine: (v, p) => {
      if (String(v.kind).startsWith("probe:") && v.observed === undefined) {
        throw new ContractError(`${p}.observed: a probe's evidence records what it observed`);
      }
    },
  },
);
