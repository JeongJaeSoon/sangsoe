import { defineEvent, isoUtc, opt, str } from "../define.ts";

export default defineEvent("rate_limited", { kind: str, reset_at: opt(isoUtc) });
