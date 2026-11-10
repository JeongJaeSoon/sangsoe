import type { ViewTask } from "../contract/views.ts";
import type { Facts } from "./facts.ts";

// Decision 178: a PR author's worker_done completes its Task before the merge (decision 175), so
// "completed" alone does not say the work is in. GRAPH readiness and the item view both ask this.

export type TaskPrState = "none" | "open" | "merged" | "closed_unmerged" | "unknown";

export interface TaskPr {
  readonly state: TaskPrState;
  readonly prs: readonly string[];
}

const PR_URL = /https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)/g;

/** The PRs a worker report names, as lowercase `owner/repo#N`, first mention first. */
export function reportPrs(report: string | undefined): string[] {
  if (!report) return [];
  const out = new Set<string>();
  for (const m of report.matchAll(PR_URL)) out.add(`${m[1]}/${m[2]}#${m[3]}`.toLowerCase());
  return [...out];
}

function stateOf(pr: string, facts: Facts): TaskPrState {
  const f = facts.prs.get(pr);
  if (!f || !(f.opened || f.merged || f.closed)) return "unknown";
  return f.merged ? "merged" : f.closed ? "closed_unmerged" : "open";
}

/**
 * The PRs pr-monitor bound to the Task (`pr_opened.task`) decide when there are any. Before that
 * binding exists, the PRs the Task's worker report names stand in, read from pr-monitor's rows for
 * them; a PR with no row yet is unknown. No PR anywhere is `none`: a Task that never had one.
 * One open or unknown PR holds the whole Task; all merged is merged; otherwise one closed unmerged.
 */
export function taskPr(task: ViewTask, facts: Facts): TaskPr {
  const bound = [...facts.prs.values()].filter((p) => p.tasks.has(task.id)).map((p) => p.pr);
  const prs = bound.length > 0 ? bound : reportPrs(task.report);
  if (prs.length === 0) return { state: "none", prs };
  const states = prs.map((pr) => stateOf(pr, facts));
  const state: TaskPrState = states.includes("unknown")
    ? "unknown"
    : states.includes("open")
      ? "open"
      : states.includes("closed_unmerged")
        ? "closed_unmerged"
        : "merged";
  return { state, prs };
}
