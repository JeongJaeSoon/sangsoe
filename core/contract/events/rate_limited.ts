import { defineEvent, isoUtc, opt, str } from "../define.ts";

// kind: github (pr-monitor's API budget) · usage_limit (a dispatched session's `errored` stop on the
// model usage limit, entity dispatch; it resumes by itself, so it is not a worker_dead, decision 196).
export default defineEvent("rate_limited", { kind: str, reset_at: opt(isoUtc) });
