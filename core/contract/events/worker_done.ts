import { defineEvent, opt, orcaId } from "../define.ts";

// A marker of Orca's worker_done message, written by orca-monitor. The outcome and body stay in
// Orca (decision 196): a reader that needs them reads the message by msg_id.
export default defineEvent("worker_done", {
  dispatch: orcaId,
  task: opt(orcaId),
  msg_id: opt(orcaId),
});
