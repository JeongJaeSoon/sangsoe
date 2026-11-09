import { decisionNo, defineEvent, opt, orcaId } from "../define.ts";

export default defineEvent("decision_joined", { decision: decisionNo, waiter: orcaId, gate: opt(orcaId) });
