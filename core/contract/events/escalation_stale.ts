import { defineEvent, opt, str } from "../define.ts";

// reason: waiting_unreleased · verify_unconfirmed · (absent for an unread escalation or an undelivered answer).
export default defineEvent(
  "escalation_stale",
  { ref: str, reason: opt(str), excerpt: opt(str) },
  { needs: "judgment" },
);
