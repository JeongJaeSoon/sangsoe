import { arr, defineEvent, int, opt, sha, str } from "../define.ts";

// kind: a verify kind, probe:<kind>, or owner_act:seen|failed|proposed. Large outputs are a path + sha256.
export default defineEvent("evidence", {
  kind: str,
  head_sha: opt(sha),
  exit_code: opt(int),
  not_verified: opt(arr(str)),
  path: opt(str),
  sha256: opt(str),
});
