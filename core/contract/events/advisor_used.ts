import { defineEvent, int, str } from "../define.ts";

// Decision 200: one advisor call read from a session's transcript by the Stop hook. `msg` is the
// assistant message id and the call's place in its usage list; cost is computed on read from the
// catalog, never stored.
export default defineEvent("advisor_used", { session: str, msg: str, model: str, input_tokens: int, output_tokens: int });
