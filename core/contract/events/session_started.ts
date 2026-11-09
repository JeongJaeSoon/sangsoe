import { defineEvent, opt, str } from "../define.ts";

export default defineEvent("session_started", {
  session: str,
  role: str,
  tier: opt(str),
  model: str,
  effort: opt(str),
});
