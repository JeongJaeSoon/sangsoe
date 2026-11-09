import { decisionNo, defineEvent, oneOf } from "../define.ts";

export default defineEvent("decision_closed", { decision: decisionNo, reason: oneOf("answered", "moot") });
