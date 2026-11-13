import { ContractError, defineEvent, oneOf, opt, orcaId, str } from "../define.ts";

// A session waiting on a person. A session holding no Dispatch is seen by the Notification hook
// (`session`); a dispatched one by Orca's `needs-input` stop escalation (`dispatch`, decision 196).
// `worktree`: Orca's path-free instance id of the worktree a session's wait was raised in, set only
// while Orca showed a live terminal there (decision 232). `cause` auth: the session stopped on a lost
// login, so the person it waits on has to sign in again (decision 237).
export default defineEvent(
  "waiting_human",
  { session: opt(str), dispatch: opt(orcaId), tool: opt(str), excerpt: opt(str), worktree: opt(str), cause: opt(oneOf("auth")) },
  {
    needs: "action",
    refine: (v, p) => {
      if (v.session === undefined && v.dispatch === undefined) throw new ContractError(`${p}: needs session or dispatch`);
    },
  },
);
