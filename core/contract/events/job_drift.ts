import { defineEvent, opt, str } from "../define.ts";

export default defineEvent(
  "job_drift",
  { plugin: str, expected: opt(str), actual: opt(str) },
  { needs: "action" },
);
