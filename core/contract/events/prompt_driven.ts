import { defineEvent, opt, str } from "../define.ts";

// Decision 280: Orca's `agent.prompt.before` hook saw a prompt Orca submitted to an agent's terminal;
// `input_kind` is Orca's name for how (`driving`: sent there through Orca's CLI). `hash` is the hash
// of the masked text; the text itself is never kept. The session's UserPromptSubmit hook writes no
// owner_action for a prompt with a `driving` row; rows of other kinds are only kept.
export default defineEvent("prompt_driven", { terminal: str, hash: str, input_kind: opt(str), agent: opt(str) });
