import { defineEvent, int, oneOf, opt, str } from "../define.ts";

// restart_due (U10) reads the count, the interval and the context sizes from these rows.
export default defineEvent("compacted", {
  session: str,
  trigger: oneOf("auto", "manual"),
  pre_tokens: opt(int),
});
