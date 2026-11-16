import { defineEvent, oneOf, opt, str } from "../define.ts";

// One type with a kind, not a type per kind (decision 22). start_refused replaced start_fallback (decision 94 (바)).
// resume_bind (decision 322): written just before a resume's worker-start, `reason` the Dispatch it replaces,
// `target` the terminal, `subject` the session, so a retry after a lost answer can tell its own bind apart.
export default defineEvent("signal", {
  kind: oneOf("loss", "wait", "orchestrator_correction", "main_flake", "start_refused", "store_rebuilt", "host_rows_reread", "resume_bind"),
  reason: opt(str),
});
