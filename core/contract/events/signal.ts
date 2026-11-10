import { defineEvent, oneOf, opt, str } from "../define.ts";

// One type with a kind, not a type per kind (decision 22). start_refused replaced start_fallback (decision 94 (바)).
export default defineEvent("signal", {
  kind: oneOf("loss", "wait", "orchestrator_correction", "main_flake", "start_refused", "store_rebuilt", "host_rows_reread"),
  reason: opt(str),
});
