import { defineEvent, oneOf, opt, orcaId } from "../define.ts";

// The report body stays in the Orca message; this row keeps ids and the outcome.
export default defineEvent("worker_done", {
  dispatch: orcaId,
  task: opt(orcaId),
  msg_id: opt(orcaId),
  outcome: oneOf("succeeded", "failed"),
});
