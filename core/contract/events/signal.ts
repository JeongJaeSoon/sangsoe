import { defineEvent, oneOf, opt, str } from "../define.ts";

// One type with a kind, not a type per kind (decision 22). Decision 94 (U22) renames start_fallback.
export default defineEvent("signal", {
  kind: oneOf("loss", "wait", "orchestrator_correction", "main_flake", "start_fallback"),
  reason: opt(str),
});
