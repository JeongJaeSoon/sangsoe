import type { OrcaAdapter } from "../contract/orca.ts";

/**
 * Decision 323: the card on the PR's head branch lists the PR as an Orca reference, so the merge
 * closes its Task. Resolves to null when the card holds the PR (already or now), else one note line.
 */
export type ReferencePort = (a: { repo: string; pr: number; headRef: string }) => Promise<string | null>;

const miss = (why: string) => `card reference: not attached (${why})`;

export function cardReference(orca: Pick<OrcaAdapter, "worktreeShow" | "referenceAdd">): ReferencePort {
  return async ({ repo, pr, headRef }) => {
    const shown = await orca.worktreeShow({ worktree: `branch:${headRef}` });
    if (!shown.ok) return miss(`worktree show branch:${headRef}: ${shown.error.code}`);
    const card = shown.value;
    if (card.projectId?.toLowerCase() !== `github:${repo.toLowerCase()}`) {
      return miss(`the card on branch ${headRef} belongs to ${card.projectId ?? "no GitHub project"}, not ${repo}`);
    }
    const url = `https://github.com/${repo}/pull/${pr}`;
    if (card.linkedItems?.some((i) => i.url?.toLowerCase() === url.toLowerCase())) return null;
    const added = await orca.referenceAdd({ worktree: `id:${card.id}`, urls: [url] });
    return added.ok ? null : miss(`reference add: ${added.error.code}`);
  };
}
