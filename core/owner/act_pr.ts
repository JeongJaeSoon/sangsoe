import type { StoredEvent } from "../contract/index.ts";

/** The PR an owner's `gh pr merge|close` line names: a number, with the repo when the line gives one. */
export interface ActPr {
  readonly verb: "merge" | "close";
  readonly repo: string | null;
  readonly number: number;
}

const VALUE_FLAGS = new Set(["-t", "--subject", "-b", "--body", "-F", "--body-file", "-A", "--author-email", "--match-head-commit", "-c", "--comment", "-r", "--reason"]);
const URL_PR = /^https?:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)(?![0-9])/;

/** Null when the line is not a merge or close of a PR it names (`gh pr merge` alone merges the current branch's). */
export function actPr(act: string): ActPr | null {
  // Quotes and shell operators make the whitespace split misread which PR a command names, or hide a second command: leave the row.
  if (/["'`;&|\n]/.test(act)) return null;
  const t = act.trim().split(/\s+/);
  const verb = t[2];
  if (t[0] !== "gh" || t[1] !== "pr" || (verb !== "merge" && verb !== "close")) return null;
  let repo: string | null = null;
  let number: number | null = null;
  for (let i = 3; i < t.length; i++) {
    const w = t[i] ?? "";
    if (w === "-R" || w === "--repo") repo = t[++i]?.toLowerCase() ?? null;
    else if (w.startsWith("--repo=")) repo = w.slice("--repo=".length).toLowerCase();
    else if (VALUE_FLAGS.has(w)) i++;
    else if (w.startsWith("-")) continue;
    else if (number === null) {
      const url = URL_PR.exec(w);
      const bare = /^([1-9][0-9]*)$/.exec(w);
      if (url) {
        repo = (url[1] ?? "").toLowerCase();
        number = Number(url[2]);
      } else if (bare) number = Number(bare[1]);
      else return null;
    }
  }
  return number === null ? null : { verb, repo, number };
}

/**
 * Decision 342: whether pr-monitor's own merged/closed row answers the line. A line that names its
 * repo needs that PR's row; a bare number needs exactly one PR with that number settled that way
 * within `windowMs` of the line, in either order (the hook writes after the turn, `--auto` merges later).
 * Anything else answers nothing, so the row stays.
 */
export function settledByFact(events: readonly StoredEvent[], act: string, ts: string, windowMs: number): boolean {
  const p = actPr(act);
  if (!p) return false;
  const type = p.verb === "merge" ? "pr_merged" : "pr_closed";
  const near = new Set<string>();
  for (const e of events) {
    if (e.type !== type) continue;
    const pr = String(e.payload.pr);
    const [repo, n] = pr.split("#");
    if (Number(n) !== p.number || (p.repo !== null && repo !== p.repo)) continue;
    // A bare number names no repo, so only a merge pr-monitor tied to the owner (actor owner:<login>) can be theirs.
    if (p.repo === null && !(e.actor ?? "").startsWith("owner:")) continue;
    const at = Date.parse(typeof e.payload.merged_at === "string" ? e.payload.merged_at : e.ts);
    if (Math.abs(at - Date.parse(ts)) <= windowMs) near.add(pr);
  }
  return p.repo !== null ? near.size > 0 : near.size === 1;
}
