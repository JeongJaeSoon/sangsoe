import { bool, decisionNo, defineEvent, int, oneOf, opt, text } from "../define.ts";

// `answer` quotes the owner verbatim; a late answer is recorded but does not reopen (decision 91).
export default defineEvent("decision_answered", {
  decision: decisionNo,
  owner_action: int,
  answer: text,
  linked_by: oneOf("hook", "button", "orchestrator", "observed"),
  late: opt(bool),
});
