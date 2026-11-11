import { createHash } from "node:crypto";
import type { Exec } from "../contract/orca.ts";
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
  base: { ref: string; repo?: { default_branch?: string } };
  user: { login: string };
  labels?: { name: string }[];
};

/** A PR whose head branch is `branch` in the same repo, open or closed (decision 216). */
export type BranchPull = { number: number; state: string; merged_at?: string | null; base: { ref: string } };

export async function readBranchPulls(gh: GhClient, repo: string, branch: string): Promise<Read<BranchPull[]>> {
  const owner = repo.slice(0, repo.indexOf("/"));
  return lift<BranchPull[]>(await gh.get(`repos/${repo}/pulls?head=${owner}:${encodeURIComponent(branch)}&state=all&per_page=100`), `${repo} PRs from ${branch}`);
}

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

type Review = { user: { login: string } | null; state: string; commit_id: string; author_association?: string };

const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
type CheckRuns = { total_count: number; check_runs: { status: string; conclusion: string | null }[] };

/**
 * Decision 81's re-call after approval: someone other than the author approved this head, nobody's
 * latest review asks for changes, GitHub calls the PR clean, and every check run on the head passed.
 */
export async function approvedAndGreen(
  gh: GhClient,
  repo: string,
  pr: number,
  pull: Pull,
  owners: readonly string[],
): Promise<Read<boolean>> {
  if (pull.mergeable_state !== "clean") return { kind: "ok", data: false };
  const reviews = await pages<Review>(gh, (p) => `repos/${repo}/pulls/${pr}/reviews?per_page=100&page=${p}`, "reviews");
  if (reviews.kind !== "ok") return reviews;
  const latest = new Map<string, Review>();
  for (const r of reviews.data) if (r.user && r.state !== "COMMENTED") latest.set(r.user.login.toLowerCase(), r);
  const author = pull.user.login.toLowerCase();
  const states = [...latest.entries()].filter(([who]) => who !== author).map(([, r]) => r);
  const trusted = (r: Review) =>
    TRUSTED.has(r.author_association ?? "") || owners.includes(r.user?.login.toLowerCase() ?? "");
  const approved = states.some((r) => r.state === "APPROVED" && r.commit_id === pull.head.sha && trusted(r));
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

export type CheckState = "pass" | "pending" | "fail";
export type MergeMethod = "squash" | "merge" | "rebase";
export type PrGate = {
  headSha: string;
  unresolvedThreads: number;
  checks: { name: string; required: boolean; state: CheckState }[];
  /** The repo's allowed methods in the order land prefers them. */
  methods: MergeMethod[];
};

// One page each; a second page is unreadable rather than half-read. The merge methods come from
// here, not REST `repos/<r>`: that answers null for them when the owner is spelled lowercase.
const GATE_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    squashMergeAllowed mergeCommitAllowed rebaseMergeAllowed
    pullRequest(number: $number) {
      headRefOid
      reviewThreads(first: 100) { pageInfo { hasNextPage } nodes { isResolved } }
      commits(last: 1) { nodes { commit { oid statusCheckRollup { contexts(first: 100) {
        pageInfo { hasNextPage }
        nodes {
          __typename
          ... on CheckRun { name status conclusion isRequired(pullRequestNumber: $number) }
          ... on StatusContext { context state isRequired(pullRequestNumber: $number) }
        }
      } } } } }
    }
  }
}`;

const PASS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

/**
 * Decision 158's GraphQL read: `isRequired` answers which checks are required without the
 * Administration permission branch protection needs (it reads 403 with a plain token).
 */
export function parsePrGate(stdout: string): Read<PrGate> {
  const no = (why: string): Read<PrGate> => ({ kind: "unreadable", why: `PR gate: ${why}` });
  let doc: unknown;
  try {
    doc = JSON.parse(stdout);
  } catch {
    return no("not JSON");
  }
  // biome-ignore lint/suspicious/noExplicitAny: walked field by field below, each one checked
  const repository = (doc as any)?.data?.repository;
  const allowed: [MergeMethod, unknown][] = [
    ["squash", repository?.squashMergeAllowed],
    ["merge", repository?.mergeCommitAllowed],
    ["rebase", repository?.rebaseMergeAllowed],
  ];
  if (!allowed.every(([, v]) => typeof v === "boolean")) return no("merge methods unreadable");
  const methods = allowed.filter(([, v]) => v === true).map(([m]) => m);
  const pull = repository.pullRequest;
  if (typeof pull?.headRefOid !== "string") return no("no head");
  const threads = pull.reviewThreads;
  if (!Array.isArray(threads?.nodes) || threads.pageInfo?.hasNextPage !== false) return no("review threads unreadable or paged");
  if (!threads.nodes.every((t: { isResolved?: unknown }) => typeof t?.isResolved === "boolean")) return no("a thread without isResolved");
  const commit = pull.commits?.nodes?.[0]?.commit;
  if (commit?.oid !== pull.headRefOid) return no("last commit is not the head");
  const checks: PrGate["checks"] = [];
  const contexts = commit.statusCheckRollup?.contexts;
  if (commit.statusCheckRollup != null) {
    if (!Array.isArray(contexts?.nodes) || contexts.pageInfo?.hasNextPage !== false) return no("checks unreadable or paged");
    for (const c of contexts.nodes) {
      if (typeof c?.isRequired !== "boolean") return no("a check without isRequired");
      if (c.__typename === "CheckRun" && typeof c.name === "string" && typeof c.status === "string") {
        const state: CheckState = c.status !== "COMPLETED" ? "pending" : PASS.has(String(c.conclusion)) ? "pass" : "fail";
        checks.push({ name: c.name, required: c.isRequired, state });
      } else if (c?.__typename === "StatusContext" && typeof c.context === "string" && typeof c.state === "string") {
        const state: CheckState = c.state === "SUCCESS" ? "pass" : c.state === "PENDING" || c.state === "EXPECTED" ? "pending" : "fail";
        checks.push({ name: c.context, required: c.isRequired, state });
      } else {
        return no(`unknown check ${String(c?.__typename)}`);
      }
    }
  }
  const unresolvedThreads = threads.nodes.filter((t: { isResolved: boolean }) => !t.isResolved).length;
  return { kind: "ok", data: { headSha: pull.headRefOid, unresolvedThreads, checks, methods } };
}

export function readPrGate(exec: Exec): (a: { repo: string; pr: number }) => Promise<Read<PrGate>> {
  return async ({ repo, pr }) => {
    const [owner = "", name = ""] = repo.split("/");
    const r = await exec("gh", ["api", "graphql", "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `number=${pr}`, "-f", `query=${GATE_QUERY}`]);
    if (r.code !== 0) return { kind: "unreadable", why: `PR gate: gh exited ${r.code ?? r.failure}: ${r.stderr.trim().slice(0, 200)}` };
    return parsePrGate(r.stdout);
  };
}

type Compare = { status?: string; files?: PrFile[] };

/** Decision 204: whether `head` contains `base`'s tip (compare base...head is ahead or identical). */
export async function containsBase(gh: GhClient, repo: string, base: string, head: string): Promise<Read<boolean>> {
  const r = lift<Compare>(await gh.get(`repos/${repo}/compare/${encodeURIComponent(base)}...${head}`), `compare ${base}...${head}`);
  if (r.kind !== "ok") return r;
  const status = r.data.status;
  if (status === "ahead" || status === "identical") return { kind: "ok", data: true };
  if (status === "behind" || status === "diverged") return { kind: "ok", data: false };
  return { kind: "unreadable", why: `compare ${base}...${head}: status ${String(status)}` };
}

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
