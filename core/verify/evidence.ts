import type { StoredEvent } from "../contract/index.ts";
import type { UiEvidenceRule } from "./verify-tier.ts";

// Evidence rows bind to a PR by the row's `subject` (lowercase owner/repo#N); the payload carries
// kind, head_sha, exit_code and not_verified (decision 85, decision 0125).

export type EvidenceGap = { kind: string; why: string };

const atHead = (row: StoredEvent, head: string) => {
  const sha = String(row.payload.head_sha ?? "");
  return sha.length >= 7 && head.startsWith(sha);
};

/** Decision 238: a `ui` row's `observed` is a JSON object naming one of the rule's surfaces and a number for each measure. */
function uiGap(observed: unknown, rule: UiEvidenceRule): string | null {
  let o: Record<string, unknown> = {};
  try {
    const v = typeof observed === "string" ? (JSON.parse(observed) as unknown) : undefined;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) o = v as Record<string, unknown>;
  } catch {
    // Free text names no surface.
  }
  if (typeof o.surface !== "string") return `observed names no surface (one of ${rule.surface.join(", ")})`;
  if (!rule.surface.includes(o.surface)) return `observed surface ${o.surface} is not one of ${rule.surface.join(", ")}`;
  const missing = rule.measures.filter((m) => typeof o[m] !== "number" || !Number.isFinite(o[m]));
  return missing.length > 0 ? `observed lacks ${missing.join(", ")}` : null;
}

function judge(rows: readonly StoredEvent[], kind: string, author: string | null, ui?: UiEvidenceRule): EvidenceGap | null {
  if (rows.length === 0) return { kind, why: "no row" };
  const counted = rows.filter((r) => r.actor !== null && r.actor.toLowerCase() !== author);
  const latest = counted.at(-1);
  if (!latest) {
    const byAuthor = rows.some((r) => r.actor !== null);
    return { kind, why: byAuthor ? "written by the PR's author" : "writer unknown" };
  }
  const code = latest.payload.exit_code;
  if (code === undefined) return { kind, why: "exit_code missing" };
  if (code !== 0) return { kind, why: `exit_code ${String(code)}` };
  const nv = latest.payload.not_verified;
  if (!Array.isArray(nv) || nv.length === 0) return { kind, why: "not_verified empty" };
  const why = kind === "ui" && ui ? uiGap(latest.payload.observed, ui) : null;
  return why ? { kind, why } : null;
}

/** The kinds that lack passing evidence at `head`, in the order asked. Empty means the check passes. */
export function evidenceGaps(
  events: readonly StoredEvent[],
  a: { pr: string; head: string; author: string | null; kinds: readonly string[]; ui?: UiEvidenceRule },
): EvidenceGap[] {
  const author = a.author?.toLowerCase() ?? null;
  const rows = events.filter((e) => e.type === "evidence" && e.subject === a.pr && atHead(e, a.head));
  return a.kinds.flatMap((kind) => {
    const gap = judge(
      rows.filter((r) => r.payload.kind === kind),
      kind,
      author,
      a.ui,
    );
    return gap ? [gap] : [];
  });
}

/**
 * A merged PR's item is done only when, if its merge sets off a release or deploy (a
 * `deploys_after` edge), the dev stage was recorded and passing `dev` evidence exists; else 🔍.
 */
export function mergedItemMark(a: { pr: string; deploysAfter: boolean; events: readonly StoredEvent[] }): "done" | "unverified" {
  if (!a.deploysAfter) return "done";
  const staged = a.events.some((e) => e.type === "stage_recorded" && e.payload.pr === a.pr && e.payload.stage === "dev");
  const dev = a.events.filter((e) => e.type === "evidence" && e.subject === a.pr && e.payload.kind === "dev").at(-1);
  return staged && dev?.payload.exit_code === 0 ? "done" : "unverified";
}
