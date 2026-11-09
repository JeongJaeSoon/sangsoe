import { createHash } from "node:crypto";
import type { GhClient, GhResponse } from "../gh/client.ts";
import type { DiffFile, TierLabel } from "../verify/verify-tier.ts";

// The GitHub reads land and verify-tier need, all through the one client (core/gh).

export type Pull = {
  state: string;
  draft?: boolean;
  merged?: boolean;
  merge_commit_sha?: string | null;
  mergeable_state?: string;
  head: { sha: string };
  base: { ref: string };
  user: { login: string };
  labels?: { name: string }[];
};

export type Read<T> = { kind: "ok"; data: T } | { kind: "unreadable"; why: string } | { kind: "rate_limited"; resetAt: number };

const MAX_PAGES = 30;

function lift<T>(r: GhResponse<unknown>, what: string): Read<T> {
  if (r.kind === "ok" && r.data !== null) return { kind: "ok", data: r.data as T };
  if (r.kind === "rate_limited") return { kind: "rate_limited", resetAt: r.resetAt };
  return { kind: "unreadable", why: `${what}: ${r.kind === "error" ? `${r.status ?? ""} ${r.message}`.trim() : r.kind}` };
}

export async function readPull(gh: GhClient, repo: string, pr: number): Promise<Read<Pull>> {
  const r = lift<Pull>(await gh.get(`repos/${repo}/pulls/${pr}`), `${repo}#${pr}`);
  if (r.kind === "ok" && (typeof r.data.head?.sha !== "string" || typeof r.data.user?.login !== "string")) {
    return { kind: "unreadable", why: `${repo}#${pr}: no head or author` };
  }
  return r;
}

async function pages<T>(gh: GhClient, path: (page: number) => string, what: string): Promise<Read<T[]>> {
  const all: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = lift<T[]>(await gh.get(path(page)), what);
    if (r.kind !== "ok") return r;
    if (!Array.isArray(r.data)) return { kind: "unreadable", why: `${what}: not a list` };
    all.push(...r.data);
    if (r.data.length < 100) return { kind: "ok", data: all };
  }
  return { kind: "unreadable", why: `${what}: more pages than GitHub returns` };
}

type PrFile = { filename: string; previous_filename?: string; patch?: string };

/** Unreadable unless every page came back; verify_tier then answers V3. */
export async function readDiff(gh: GhClient, repo: string, pr: number): Promise<Read<DiffFile[]>> {
  const r = await pages<PrFile>(gh, (p) => `repos/${repo}/pulls/${pr}/files?per_page=100&page=${p}`, "PR files");
  if (r.kind !== "ok") return r;
  return {
    kind: "ok",
    data: r.data.map((f) => ({
      path: f.filename,
      ...(f.previous_filename ? { previousPath: f.previous_filename } : {}),
      patch: typeof f.patch === "string" ? f.patch : null,
    })),
  };
}

type IssueEvent = { event: string; label?: { name: string }; actor?: { login: string } | null };

/** Each current label with the login that last added it (from the issue's timeline of events). */
export async function readLabels(gh: GhClient, repo: string, pr: number, pull: Pull): Promise<Read<TierLabel[]>> {
  const names = (pull.labels ?? []).map((l) => l.name);
  if (names.length === 0) return { kind: "ok", data: [] };
  const r = await pages<IssueEvent>(gh, (p) => `repos/${repo}/issues/${pr}/events?per_page=100&page=${p}`, "label events");
  if (r.kind !== "ok") return r;
  const actor = new Map<string, string | null>();
  for (const e of r.data) if (e.event === "labeled" && e.label) actor.set(e.label.name, e.actor?.login ?? null);
  return { kind: "ok", data: names.map((name) => ({ name, actor: actor.get(name) ?? null })) };
}

type Review = { user: { login: string } | null; state: string; commit_id: string };
type CheckRuns = { total_count: number; check_runs: { status: string; conclusion: string | null }[] };

/**
 * Decision 81's re-call after approval: someone other than the author approved this head, nobody's
 * latest review asks for changes, GitHub calls the PR clean, and every check run on the head passed.
 */
export async function approvedAndGreen(gh: GhClient, repo: string, pr: number, pull: Pull): Promise<Read<boolean>> {
  if (pull.mergeable_state !== "clean") return { kind: "ok", data: false };
  const reviews = await pages<Review>(gh, (p) => `repos/${repo}/pulls/${pr}/reviews?per_page=100&page=${p}`, "reviews");
  if (reviews.kind !== "ok") return reviews;
  const latest = new Map<string, Review>();
  for (const r of reviews.data) if (r.user && r.state !== "COMMENTED") latest.set(r.user.login.toLowerCase(), r);
  const author = pull.user.login.toLowerCase();
  const states = [...latest.entries()].filter(([who]) => who !== author).map(([, r]) => r);
  const approved = states.some((r) => r.state === "APPROVED" && r.commit_id === pull.head.sha);
  if (!approved || states.some((r) => r.state === "CHANGES_REQUESTED")) return { kind: "ok", data: false };
  const runs = lift<CheckRuns>(await gh.get(`repos/${repo}/commits/${pull.head.sha}/check-runs?per_page=100`), "check runs");
  if (runs.kind !== "ok") return runs;
  const all = runs.data.check_runs ?? [];
  const green =
    all.length > 0 &&
    all.length === runs.data.total_count &&
    all.every((c) => c.status === "completed" && ["success", "neutral", "skipped"].includes(c.conclusion ?? ""));
  return { kind: "ok", data: green };
}

type Compare = { status?: string; files?: PrFile[] };

/**
 * A head's patch-id: sha256 over its files' changed lines with whitespace removed and hunk line
 * numbers dropped, from GitHub's three-dot compare against `base`. null when any patch is missing.
 */
export async function patchId(gh: GhClient, repo: string, base: string, sha: string): Promise<string | null> {
  const r = await gh.get<Compare>(`repos/${repo}/compare/${encodeURIComponent(base)}...${sha}`);
  if (r.kind !== "ok" || !r.data || !Array.isArray(r.data.files) || r.data.files.length >= 300) return null;
  const hash = createHash("sha256");
  for (const f of [...r.data.files].sort((a, b) => a.filename.localeCompare(b.filename))) {
    if (typeof f.patch !== "string") return null;
    hash.update(`${f.filename}\n`);
    for (const line of f.patch.split("\n")) {
      if (line.startsWith("+") || line.startsWith("-")) hash.update(`${line[0]}${line.slice(1).replace(/\s+/g, "")}\n`);
    }
  }
  return hash.digest("hex");
}

/** Decision 84 ①: GitHub shows the PR merged and its merge commit is on the default branch. */
export async function mergeConfirm(gh: GhClient, repo: string, pr: number): Promise<{ merged: boolean; merge_sha: string | null; reason: string }> {
  const no = (reason: string, merge_sha: string | null = null) => ({ merged: false, merge_sha, reason });
  const pull = await readPull(gh, repo, pr);
  if (pull.kind !== "ok") return no(pull.kind === "unreadable" ? pull.why : "rate limited");
  const sha = pull.data.merge_commit_sha ?? null;
  if (pull.data.merged !== true || !sha) return no("GitHub does not show it merged");
  const meta = lift<{ default_branch: string }>(await gh.get(`repos/${repo}`), repo);
  if (meta.kind !== "ok" || typeof meta.data.default_branch !== "string") return no("default branch unreadable", sha);
  const main = meta.data.default_branch;
  const cmp = lift<Compare>(await gh.get(`repos/${repo}/compare/${encodeURIComponent(main)}...${sha}`), "compare");
  if (cmp.kind !== "ok") return no(`cannot compare ${sha} with ${main}`, sha);
  const onMain = cmp.data.status === "behind" || cmp.data.status === "identical";
  return onMain ? { merged: true, merge_sha: sha, reason: `merged as ${sha}, on ${main}` } : no(`${sha} is not on ${main}`, sha);
}
