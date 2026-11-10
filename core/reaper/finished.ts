import type { Exec, WorkerRow, WorktreeRow } from "../contract/orca.ts";
import type { GhClient } from "../gh/client.ts";
import { settled } from "../recover/recover.ts";

export type Pr = { number: number; state: string; merged_at: string | null; head: { sha: string; ref: string; label?: string } };

/** `github:<owner>/<repo>` → `owner/repo`; anything else is a repository REAPER cannot ask about. */
export function repoOf(card: Pick<WorktreeRow, "projectId">): string | null {
  const m = /^github:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/.exec(card.projectId ?? "");
  return m?.[1] ?? null;
}

const REMOTE_REPO = /github\.com[/:]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;

/**
 * Orca's projectId is lowercase, and a fine-grained token answers 404 for a private repo named in
 * another case. The card's `origin` remote gives the spelling when it names the same repository;
 * otherwise the card keeps Orca's.
 */
export async function withRemoteCase<C extends Pick<WorktreeRow, "projectId" | "path">>(card: C, exec: Exec): Promise<C> {
  const repo = repoOf(card);
  if (!repo) return card;
  const r = await exec("git", ["-C", card.path, "remote", "get-url", "origin"]);
  const spelled = r.code === 0 ? REMOTE_REPO.exec(r.stdout.trim())?.[1] : undefined;
  return spelled && spelled !== repo && spelled.toLowerCase() === repo.toLowerCase() ? { ...card, projectId: `github:${spelled}` } : card;
}

export const branchOf = (card: Pick<WorktreeRow, "branch">) => card.branch.replace(/^refs\/heads\//, "");

export type Finished =
  | { state: "finished"; carried: boolean; pr: Pr | null }
  | { state: "unfinished"; why: string }
  | { state: "unknown"; why: string };

const FINISHED_OUTCOMES = new Set(["succeeded", "cancelled"]);

/**
 * d119's finished judgment for one card. A PR on the card's branch wins: open is unfinished, merged
 * or closed is finished only when it carried the card's HEAD (same sha, or GitHub says HEAD is not
 * ahead of the PR head). With no PR, every Dispatch that ran in the card has settled and the last
 * one succeeded or was cancelled. Quiet is never a reason; whatever cannot be read is unknown.
 */
export async function judgeFinished(card: WorktreeRow, gh: GhClient, workers: readonly WorkerRow[]): Promise<Finished> {
  const repo = repoOf(card);
  if (!repo) return { state: "unknown", why: "not a GitHub repository" };
  if (!card.head) return { state: "unknown", why: "no HEAD on the card row" };
  const branch = branchOf(card);
  // GitHub drops a head filter it cannot use and lists the repository's newest PRs instead.
  if (branch === "") return { state: "unknown", why: "no branch (detached HEAD)" };
  const label = `${repo.split("/")[0]}:${branch}`;
  const r = await gh.get<Pr[]>(`repos/${repo}/pulls?head=${encodeURIComponent(label)}&state=all&per_page=10`);
  if (r.kind !== "ok" || !Array.isArray(r.data)) return { state: "unknown", why: `PR lookup: ${r.kind}` };
  const pr = r.data
    .filter((p) => p.head?.ref === branch && (p.head.label === undefined || p.head.label === label))
    .sort((a, b) => b.number - a.number)[0];
  if (pr) {
    if (pr.state === "open") return { state: "unfinished", why: `PR #${pr.number} is open` };
    if (pr.head.sha === card.head) return { state: "finished", carried: true, pr };
    const cmp = await gh.get<{ status?: string }>(`repos/${repo}/compare/${pr.head.sha}...${card.head}`);
    if (cmp.kind === "ok" && (cmp.data?.status === "identical" || cmp.data?.status === "behind")) {
      return { state: "finished", carried: true, pr };
    }
    if (cmp.kind === "ok" || (cmp.kind === "error" && cmp.status === 404)) {
      return { state: "unfinished", why: `PR #${pr.number} did not carry HEAD` };
    }
    return { state: "unknown", why: `compare: ${cmp.kind}` };
  }
  const mine = workers.filter((w) => w.workspace === card.id);
  if (mine.length === 0) return { state: "unknown", why: "no PR and no Dispatch" };
  if (!mine.every(settled)) return { state: "unfinished", why: "a Dispatch has not settled" };
  // worker-list is newest first.
  const last = mine[0];
  if (last && (FINISHED_OUTCOMES.has(last.state) || FINISHED_OUTCOMES.has(last.outcome ?? ""))) {
    return { state: "finished", carried: false, pr: null };
  }
  return { state: "unfinished", why: `last Dispatch ended ${last?.outcome ?? last?.state}` };
}
