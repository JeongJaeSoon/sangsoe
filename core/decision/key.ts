import { createHash } from "node:crypto";

const normalize = (s: string): string =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "");

/**
 * Appendix #decision-loop-detail: the subject (`item:iNNN`, else `scope:<group>`) and the sorted options,
 * normalized, hashed to 16 hex characters. The question text is left out, so a reworded question is
 * the same decision.
 */
export function decisionKey(subject: string, options: readonly string[]): string {
  const parts = [normalize(subject), ...options.map(normalize).sort()];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}
