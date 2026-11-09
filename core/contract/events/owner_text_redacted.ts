import { defineEvent, int, str } from "../define.ts";

// Only Store.redactOwnerText (`sangsoe owner-text redact`) writes it, in the transaction that empties the text.
export default defineEvent(
  "owner_text_redacted",
  { seq: int, reason: str },
  { storeOnly: true, dedupeBound: (p) => [String(p.seq)], dedupeClosed: true },
);
