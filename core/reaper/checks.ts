import type { Exec, WorktreeRow } from "../contract/orca.ts";
import type { GhClient } from "../gh/client.ts";
import { branchOf, type Finished, repoOf } from "./finished.ts";

export type BlockReason = "uncommitted" | "unpushed" | "unpushed_other_patch";
export type Check = { ok: true } | { ok: false; blocked: BlockReason } | { ok: false; unknown: string };

/**
 * Decision 82 R4, the last gate before `worktree rm`: no uncommitted change (untracked files
 * included; git already leaves ignored ones out), and no commit only this machine has. "On the
 * remote" is asked of GitHub, never read from a local default branch that may be stale.
 */
export async function preDelete(
  card: WorktreeRow,
  finished: Extract<Finished, { state: "finished" }>,
  exec: Exec,
  gh: GhClient,
): Promise<Check> {
  const status = await exec("git", ["-C", card.path, "status", "--porcelain=v1", "--untracked-files=all"]);
  if (status.code !== 0) return { ok: false, unknown: "git status failed" };
  if (status.stdout.trim() !== "") return { ok: false, blocked: "uncommitted" };

  // A squash merge leaves the card's own commits off every remote branch; the PR carrying HEAD is the proof.
  if (finished.carried) return { ok: true };

  const repo = repoOf(card);
  const head = card.head;
  if (!repo || !head) return { ok: false, unknown: "no repository or HEAD" };
  const known = await gh.get(`repos/${repo}/commits/${head}`);
  if (known.kind === "ok") return { ok: true };
  if (known.kind !== "error" || (known.status !== 404 && known.status !== 422)) {
    return { ok: false, unknown: `commit lookup: ${known.kind}` };
  }
  // Never pushed. Same message at the branch tip on GitHub but another sha: amended or rebased after the push.
  const local = await exec("git", ["-C", card.path, "log", "-1", "--format=%B", head]);
  const tip = await gh.get<{ commit?: { message?: string } }>(
    `repos/${repo}/commits/${encodeURIComponent(branchOf(card))}`,
  );
  const sameMessage =
    local.code === 0 && tip.kind === "ok" && (tip.data?.commit?.message ?? "").trim() === local.stdout.trim();
  return { ok: false, blocked: sameMessage ? "unpushed_other_patch" : "unpushed" };
}
