import { decisionNo, defineEvent, opt, orcaId, str } from "../define.ts";

// Question text and options live in the Orca gate. dedupe_key decision:<decision_key>[:r<n>].
export default defineEvent(
  "decision_opened",
  { decision: decisionNo, decision_key: str, task: opt(orcaId), gate: opt(orcaId) },
  { dedupe: "decision", needs: "judgment" },
);
