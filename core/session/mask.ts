import { createHash } from "node:crypto";

// The owner's words are stored masked (decision 34): a value that looks like a credential never reaches
// the store, its summary or its hash input. A miss is redacted later with `sangsoe owner-text redact`.
const PATTERNS: readonly RegExp[] = [
  /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\b(sk-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];
// A long opaque run is masked unless it is plain hex (a git sha the owner pasted).
const OPAQUE = /\b[A-Za-z0-9+_-]{40,}={0,2}/g;
// Not \b: an env name such as DB_PASSWORD has no word boundary before the keyword.
const ASSIGNED = /(?<![A-Za-z0-9])(password|passwd|secret|token|api[_-]?key|authorization)(\s*[:=]\s*|\s+)(bearer\s+)?("[^"]*"|'[^']*'|\S+)/gi;

export const MASK = "[masked]";

export function mask(text: string): string {
  let out = text.replace(ASSIGNED, (_m, k: string, sep: string, bearer: string | undefined) => `${k}${sep}${bearer ?? ""}${MASK}`);
  for (const re of PATTERNS) out = out.replace(re, MASK);
  return out.replace(OPAQUE, (m) => (/^[0-9a-f]+$/i.test(m) ? m : MASK));
}

/** One line, at most `max` characters, of already-masked text. */
export function summarize(masked: string, max = 120): string {
  const line = masked.replace(/\s+/g, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

export const hashOf = (masked: string): string => createHash("sha256").update(masked).digest("hex").slice(0, 16);
