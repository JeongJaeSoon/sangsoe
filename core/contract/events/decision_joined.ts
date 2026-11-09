import { decisionNo, defineEvent, opt, orcaId } from "../define.ts";

// `run` is the Run the waiter Task sits in: gate-list and gate-resolve work only inside it (decision 77 라).
export default defineEvent("decision_joined", {
  decision: decisionNo,
  waiter: orcaId,
  gate: opt(orcaId),
  run: opt(orcaId),
});
