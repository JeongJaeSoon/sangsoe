import { defineEvent, oneOf, opt, str } from "../define.ts";

// The masked original text lives in the owner_text table under this row's seq, never here (decision 34).
export default defineEvent("owner_action", {
  origin: oneOf("chat", "button", "shell"),
  summary: str,
  hash: str,
  cc_session: opt(str),
  cc_message: opt(str),
});
