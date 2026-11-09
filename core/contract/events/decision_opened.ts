import { decisionNo, defineEvent, match, opt, orcaId } from "../define.ts";

// Question text and options live in the Orca gate. dedupe_key decision:<decision_key>[:r<n>].
export default defineEvent(
  "decision_opened",
  {
    decision: decisionNo,
    decision_key: match(/^[^\s:]+$/, "decision key without spaces or colons"),
    task: opt(orcaId),
    gate: opt(orcaId),
  },
  { dedupe: "decision", dedupeBound: (p) => [p.decision_key], needs: "judgment" },
);
