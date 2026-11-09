import { decisionNo, defineEvent, oneOf, opt, str } from "../define.ts";

// `evidence` says why a moot decision lost its cause (decision 91③): "tasks_closed" or "pr_closed:<owner/repo#N>".
export default defineEvent("decision_closed", {
  decision: decisionNo,
  reason: oneOf("answered", "moot"),
  evidence: opt(str),
});
