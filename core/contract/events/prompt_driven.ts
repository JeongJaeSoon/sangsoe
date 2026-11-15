import { defineEvent, opt, str } from "../define.ts";

// Decision 280: Orca's `agent.prompt.before` hook saw a prompt driven into an agent's terminal (an
// `orca terminal send`), which no person typed. `hash` is the hash of the masked text; the text itself
// is never kept. The session's UserPromptSubmit hook reads the row and writes no owner_action for it.
export default defineEvent("prompt_driven", { terminal: str, hash: str, input_kind: opt(str), agent: opt(str) });
