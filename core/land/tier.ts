import { requiredEvidence, type TierVerdict, verifyTier } from "../verify/verify-tier.ts";
import { readDiff, readLabels, readPull } from "./github.ts";
import { type LandDeps, type LandRefusal, tierSource, tierUnreadable } from "./land.ts";

/** `tier_source` is "config", or "none (fail-closed V3): <what was missing>". */
export type TierOfPr = TierVerdict & { pr: string; head_sha: string; tier_source: string; evidence: string[] };

/** Read-only: the verify tier land would use for this PR at its current head, and the evidence it asks. */
export async function tierOfPr(
  deps: Pick<LandDeps, "gh" | "config">,
  a: { repo: string; pr: number },
): Promise<{ ok: true; value: TierOfPr } | { ok: false; refusal: LandRefusal }> {
  const fix = "sangsoe verify-tier --pr <N> [--repo <owner/name>]";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(a.repo)) return { ok: false, refusal: { code: "invalid_input", reason: `repo must be owner/name, got ${a.repo}`, fix } };
  if (!Number.isInteger(a.pr) || a.pr < 1) return { ok: false, refusal: { code: "invalid_input", reason: `pr must be a PR number, got ${a.pr}`, fix } };
  const { repo } = a; // GitHub calls keep the given case, as in land()
  const pull = await readPull(deps.gh, repo, a.pr);
  if (pull.kind !== "ok") {
    const reason = pull.kind === "rate_limited" ? `GitHub's rate limit resets at epoch ${pull.resetAt}` : pull.why;
    return { ok: false, refusal: { code: pull.kind === "rate_limited" ? "rate_limited" : "pr_unreadable", reason, fix: `check that ${repo}#${a.pr} exists and gh is logged in` } };
  }
  const diff = await readDiff(deps.gh, repo, a.pr);
  const labels = await readLabels(deps.gh, repo, a.pr, pull.data);
  const config = deps.config();
  const v = verifyTier(diff.kind === "ok" ? diff.data : null, labels.kind === "ok" ? labels.data : null, config.tier, tierUnreadable(config));
  return { ok: true, value: { pr: `${repo.toLowerCase()}#${a.pr}`, head_sha: pull.data.head.sha, ...v, tier_source: tierSource(config), evidence: requiredEvidence(v) } };
}
