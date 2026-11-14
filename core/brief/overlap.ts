import type { StoredEvent } from "../contract/index.ts";
import type { GhClient } from "../gh/client.ts";
import { foldFacts } from "../graph/facts.ts";
import { readDiff } from "../land/github.ts";

// Decision 252 (B5): open PRs on the same base that change the same path, computed each time the lead
// reads it. The PR set is pr-monitor's rows; the file lists are GitHub's, read now and kept nowhere.

export type Overlap = { readonly prs: readonly [string, string]; readonly files: readonly string[] };
export type Overlaps = { readonly overlaps: readonly Overlap[]; readonly unseen: readonly string[] };

const numberOf = (ref: string) => Number(ref.slice(ref.indexOf("#") + 1));

/**
 * Pairs among the open PRs that share a repository and base, with the paths both change (a rename
 * counts under its old and new path). Only a base with two or more open PRs reads its file lists; a
 * list not read whole leaves that PR's pairs unjudged and named in `unseen` (decision 201). A rate
 * limit or a GitHub that did not answer stops the reads, so a stalled read costs one timeout, not one
 * per PR. With `repos` given, a repository no longer in it is not read: its rows may never close.
 */
export async function prOverlaps(o: { events: readonly StoredEvent[]; gh: GhClient; repos?: readonly string[] }): Promise<Overlaps> {
  const watched = o.repos && o.repos.length > 0 ? new Set(o.repos.map((r) => r.toLowerCase())) : undefined;
  const groups = new Map<string, string[]>();
  for (const p of foldFacts(o.events).prs.values()) {
    if (!p.opened || p.merged || p.closed || p.base === undefined) continue;
    const repo = p.pr.slice(0, p.pr.indexOf("#"));
    if (watched && !watched.has(repo)) continue;
    const k = `${repo}\n${p.base}`;
    groups.set(k, [...(groups.get(k) ?? []), p.pr]);
  }
  let halted: string | undefined;
  const gh: GhClient = {
    get: async <T>(path: string, opts?: { conditional?: boolean }) => {
      const r = await o.gh.get<T>(path, opts);
      if (r.kind === "rate_limited") halted = `rate limited until ${new Date(r.resetAt * 1000).toISOString().replace(/\.\d+Z$/, "Z")}`;
      else if (r.kind === "error" && r.status === null) halted = `GitHub did not answer: ${r.message}`;
      return r;
    },
  };
  const overlaps: Overlap[] = [];
  const unseen: string[] = [];
  for (const [k, members] of groups) {
    if (members.length < 2) continue;
    const repo = k.slice(0, k.indexOf("\n"));
    // GitHub is asked under the spelling watch.repos gives (a fine-grained token 404s another case).
    const given = o.repos?.find((r) => r.toLowerCase() === repo) ?? repo;
    const prs = members.sort((a, b) => numberOf(a) - numberOf(b));
    const paths = new Map<string, Set<string>>();
    for (const pr of prs) {
      if (halted) {
        unseen.push(`${pr}: PR files not read (${halted})`);
        continue;
      }
      const d = await readDiff(gh, given, numberOf(pr));
      if (d.kind === "ok") paths.set(pr, new Set(d.data.flatMap((f) => (f.previousPath ? [f.path, f.previousPath] : [f.path]))));
      else unseen.push(`${pr}: ${halted ? `PR files not read (${halted})` : d.kind === "unreadable" ? d.why : "PR files not read"}`);
    }
    for (const [i, a] of prs.entries()) {
      for (const b of prs.slice(i + 1)) {
        const pa = paths.get(a);
        const pb = paths.get(b);
        if (!pa || !pb) continue;
        const files = [...pa].filter((f) => pb.has(f)).sort();
        if (files.length > 0) overlaps.push({ prs: [a, b], files });
      }
    }
  }
  return { overlaps, unseen };
}

/** The ready read's 겹침 section: one line per pair, then each PR whose pairs were not judged. */
export function overlapLines(r: Overlaps): string[] {
  if (r.overlaps.length === 0 && r.unseen.length === 0) return [];
  return [
    "겹침 (같은 파일을 바꾸는 열린 PR: 머지 순서를 정한다)",
    ...r.overlaps.map((o) => `- ${o.prs[0]} ↔ ${o.prs[1]}: ${o.files.join(", ")}`),
    ...r.unseen.map((u) => `- 판정하지 못함: ${u}`),
  ];
}
