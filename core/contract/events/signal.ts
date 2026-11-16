import { defineEvent, oneOf, opt, str } from "../define.ts";

// One type with a kind, not a type per kind (decision 22). start_refused replaced start_fallback (decision 94 (바)).
// resume_bind (decision 322): written just before a resume's worker-start, `reason` the Dispatch it replaces,
// `target` the terminal, `subject` the session, so a retry after a lost answer can tell its own bind apart.
// restart_self (decision 330): written just before `sangsoe restart` opens the terminal that resumes its
// caller, `reason` the caller's claude pid, `subject` its session, and again with `target` once the
// terminal is known, so a second run never opens another terminal waiting on the same session.
export default defineEvent("signal", {
  kind: oneOf("loss", "wait", "orchestrator_correction", "main_flake", "start_refused", "store_rebuilt", "host_rows_reread", "resume_bind", "restart_self"),
  reason: opt(str),
});
