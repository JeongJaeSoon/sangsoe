import { defineEvent, int, str } from "../define.ts";

// Only `sangsoe owner-text redact` writes it, in the same transaction that empties the text.
export default defineEvent("owner_text_redacted", { seq: int, reason: str });
