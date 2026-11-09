import { defineEvent, int, match, str } from "../define.ts";

// Written once per `sangsoe plugin approve` that Orca's enable accepted (decision 104). Orca's own
// approval state is not copied (decision 74). at: epoch milliseconds of the enable.
export default defineEvent("plugin_approved", {
  key: str,
  version: str,
  fingerprint: str,
  commit: match(/^[0-9a-f]{40}$/, "full 40-character sha"),
  at: int,
});
