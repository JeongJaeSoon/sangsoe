import { ContractError, defineEvent, opt, orcaId, str } from "../define.ts";

// A session waiting on a person. A session holding no Dispatch is seen by the Notification hook
// (`session`); a dispatched one by Orca's `needs-input` stop escalation (`dispatch`, decision 196).
export default defineEvent(
  "waiting_human",
  { session: opt(str), dispatch: opt(orcaId), tool: opt(str), excerpt: opt(str) },
  {
    needs: "action",
    refine: (v, p) => {
      if (v.session === undefined && v.dispatch === undefined) throw new ContractError(`${p}: needs session or dispatch`);
    },
  },
);
