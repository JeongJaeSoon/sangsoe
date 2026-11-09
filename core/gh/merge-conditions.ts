import type { GhClient } from "./client.ts";

export type MergeConditionId =
  | "required_review_and_ci"
  | "up_to_date_or_queue"
  | "stale_approvals_dismissed"
  | "no_protected_paths";

export type MergeCondition = { id: MergeConditionId; ok: boolean; reason: string };

export type MergeConditions =
  | { kind: "read"; autoMerge: boolean; conditions: MergeCondition[] }
  | { kind: "rate_limited"; resetAt: number };

type Rule = { type: string; parameters?: Record<string, unknown> };
type Protection = {
  required_pull_request_reviews?: { required_approving_review_count?: number; dismiss_stale_reviews?: boolean };
  required_status_checks?: { strict?: boolean; contexts?: string[]; checks?: unknown[] };
};
type PrFile = { filename: string; previous_filename?: string };

const MAX_FILE_PAGES = 30; // GitHub lists at most 3000 files of a PR.

// `dir/` covers a subtree, `*` stays inside one segment, `**` crosses segments, and `**/` also matches no directory.
export function matchesPath(pattern: string, file: string): boolean {
  if (pattern.endsWith("/")) return file.startsWith(pattern);
  const re = pattern
    .split(/(\*\*\/|\*\*|\*)/)
    .map((part) => {
      if (part === "**/") return "(?:.*/)?";
      if (part === "**") return ".*";
      if (part === "*") return "[^/]*";
      return part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return new RegExp(`^${re}$`).test(file);
}

/**
 * Decision 81: the land function may schedule `gh pr merge --auto` only when all four hold.
 * A setting that cannot be read counts as false; nothing here writes.
 */
export async function readMergeConditions(
  gh: GhClient,
  /** `protectedPaths: null` means the `protected_paths` setting could not be read. */
  a: { repo: string; base: string; pr: number; protectedPaths: readonly string[] | null },
): Promise<MergeConditions> {
  const branch = encodeURIComponent(a.base);
  const rulesRes = await gh.get<Rule[]>(`repos/${a.repo}/rules/branches/${branch}`);
  if (rulesRes.kind === "rate_limited") return { kind: "rate_limited", resetAt: rulesRes.resetAt };
  const protRes = await gh.get<Protection>(`repos/${a.repo}/branches/${branch}/protection`);
  if (protRes.kind === "rate_limited") return { kind: "rate_limited", resetAt: protRes.resetAt };

  const rules = rulesRes.kind === "ok" && Array.isArray(rulesRes.data) ? rulesRes.data : undefined;
  // 404 means the branch has no classic protection: read, and empty.
  const prot = protRes.kind === "ok" ? protRes.data : protRes.kind === "error" && protRes.status === 404 ? {} : undefined;
  const unreadable = [rules ? "" : "rulesets", prot ? "" : "branch protection"].filter(Boolean).join(" and ");

  const rule = (type: string) => {
    const found = rules?.find((r) => r.type === type);
    return found ? (found.parameters ?? {}) : undefined;
  };
  const pr = rule("pull_request");
  const checks = rule("required_status_checks");
  const queue = rules?.some((r) => r.type === "merge_queue") ?? false;
  const reviews = prot?.required_pull_request_reviews;
  const status = prot?.required_status_checks;

  const reviewRequired = Number(pr?.required_approving_review_count ?? 0) > 0 || Number(reviews?.required_approving_review_count ?? 0) > 0;
  const ciRequired =
    (Array.isArray(checks?.required_status_checks) && checks.required_status_checks.length > 0) ||
    (status?.contexts?.length ?? 0) > 0 ||
    (status?.checks?.length ?? 0) > 0;
  const upToDate = queue || checks?.strict_required_status_checks_policy === true || status?.strict === true;
  const dismissStale = pr?.dismiss_stale_reviews_on_push === true || reviews?.dismiss_stale_reviews === true;

  const settings = (ok: boolean, yes: string, no: string): { ok: boolean; reason: string } =>
    ok ? { ok, reason: yes } : { ok, reason: unreadable ? `${no} (unreadable: ${unreadable})` : no };

  const conditions: MergeCondition[] = [
    {
      id: "required_review_and_ci",
      ...settings(reviewRequired && ciRequired, "review and CI are required", "review or CI is not required"),
    },
    {
      id: "up_to_date_or_queue",
      ...settings(upToDate, queue ? "merge queue" : "branch must be up to date", "neither up-to-date nor merge queue"),
    },
    {
      id: "stale_approvals_dismissed",
      ...settings(dismissStale, "a new push dismisses approvals", "a new push keeps approvals"),
    },
  ];
  const paths = await protectedPathsCondition(gh, a);
  if ("kind" in paths) return paths;
  conditions.push(paths);
  return { kind: "read", autoMerge: conditions.every((c) => c.ok), conditions };
}

async function protectedPathsCondition(
  gh: GhClient,
  a: { repo: string; pr: number; protectedPaths: readonly string[] | null },
): Promise<MergeCondition | { kind: "rate_limited"; resetAt: number }> {
  const id = "no_protected_paths";
  const protectedPaths = a.protectedPaths;
  if (protectedPaths === null) return { id, ok: false, reason: "protected_paths unreadable" };
  if (protectedPaths.length === 0) return { id, ok: true, reason: "protected_paths is empty" };
  const files: string[] = [];
  let complete = false;
  for (let page = 1; page <= MAX_FILE_PAGES && !complete; page++) {
    const res = await gh.get<PrFile[]>(`repos/${a.repo}/pulls/${a.pr}/files?per_page=100&page=${page}`);
    if (res.kind === "rate_limited") return { kind: "rate_limited", resetAt: res.resetAt };
    if (res.kind !== "ok" || !Array.isArray(res.data)) return { id, ok: false, reason: "PR files unreadable" };
    for (const f of res.data) files.push(f.filename, ...(f.previous_filename ? [f.previous_filename] : []));
    complete = res.data.length < 100;
  }
  if (!complete) return { id, ok: false, reason: "PR lists more files than GitHub returns" };
  const hit = files.find((f) => protectedPaths.some((p) => matchesPath(p, f)));
  return hit ? { id, ok: false, reason: `touches protected path ${hit}` } : { id, ok: true, reason: "no protected path touched" };
}
