import { dedupeSegment } from "../../contract/index.ts";
import type { ItemState } from "../../contract/transitions.ts";

/** One workflow run of a push to the default branch, as `actions/runs?head_sha=` lists it (latest attempt). */
export type MainRun = {
  id: number;
  run_attempt: number;
  status: string;
  conclusion: string | null;
  /** ms epoch of the run's last update. */
  updatedAt: number;
  /** Jobs the run reported; null when not read. A failed run with 0 jobs never started (GitHub outage). */
  jobs: number | null;
};

export type MainVerdict =
  | { kind: "pending" }
  | { kind: "unknown"; why: string }
  | { kind: "green"; run: MainRun }
  | { kind: "red"; run: MainRun }
  /** A first attempt failed: `ci_failed` asks the notified party for its one rerun before `main_red`. */
  | { kind: "suspect"; run: MainRun };

const FAILED = new Set(["failure", "timed_out", "startup_failure"]);
const PASSED = new Set(["success", "neutral", "skipped"]);

/**
 * The push CI of a merge sha (decision 79 N2). A cancelled run is never red (a newer push replaced
 * it), a failed run with no jobs is unknown (U24a), a first-attempt failure waits `graceMs` for one
 * rerun, and a failure on a rerun, or past the grace with none, is red.
 */
export function classifyMain(runs: readonly MainRun[], now: number, graceMs: number): MainVerdict {
  if (runs.length === 0) return { kind: "pending" };
  if (runs.some((r) => r.status !== "completed")) return { kind: "pending" };
  const counted = runs.filter((r) => r.conclusion !== "cancelled");
  if (counted.length === 0) return { kind: "unknown", why: "every run was cancelled" };
  const failed = counted.filter((r) => FAILED.has(r.conclusion ?? ""));
  const empty = failed.filter((r) => r.jobs === 0);
  if (empty.length > 0) return { kind: "unknown", why: `run ${empty[0]?.id} failed with 0 jobs` };
  if (failed.some((r) => r.jobs === null)) return { kind: "unknown", why: "jobs of a failed run unread" };
  const rerun = failed.find((r) => r.run_attempt >= 2);
  if (rerun) return { kind: "red", run: rerun };
  const first = failed[0];
  if (first) return now - first.updatedAt >= graceMs ? { kind: "red", run: first } : { kind: "suspect", run: first };
  const odd = counted.find((r) => !PASSED.has(r.conclusion ?? ""));
  if (odd) return { kind: "unknown", why: `run ${odd.id} ended ${odd.conclusion}` };
  const last = counted.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
  return { kind: "green", run: last };
}

/** Orca Task status → the item state `item_transition.from` names (the brief's reading, minus holds). */
export function itemStateOf(status: string): ItemState | null {
  switch (status) {
    case "dispatched":
      return "in_progress";
    case "blocked":
      return "blocked";
    case "ready":
      return "ready";
    case "pending":
      return "planned";
    default:
      return null;
  }
}

export const isClosedTask = (status: string) => status === "completed" || status === "failed" || status === "cancelled";

/** `verify-tier:N` → `VN`, the label decision 85 reads. */
export function requestedTier(labels: readonly string[]): string | null {
  const tiers = labels.flatMap((l) => {
    const m = /^verify-tier:([0-3])$/i.exec(l.trim());
    return m ? [`V${m[1]}`] : [];
  });
  return tiers.length > 0 ? tiers.sort().at(-1) ?? null : null;
}

export const key = (type: string, ...segments: string[]) => [type, ...segments.map(dedupeSegment)].join(":");

/** `acme/api#7` from repo and number, lowercase as `prRef` demands. */
export const prRef = (repo: string, n: number) => `${repo.toLowerCase()}#${n}`;
export const prUrl = (repo: string, n: number) => `https://github.com/${repo}/pull/${n}`;
