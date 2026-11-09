import { matchesPath } from "../gh/merge-conditions.ts";

// Decision 85: the verify tier of a PR, from its base...head diff, its labels and the config.
// Pure: no I/O, no clock. Anything ambiguous goes up (fail closed).

export type Tier = "V0" | "V1" | "V2" | "V3";
export const TIERS: readonly Tier[] = ["V0", "V1", "V2", "V3"];

/** One changed file. `patch` is the unified diff GitHub returned; null when it returned none. */
export type DiffFile = { path: string; previousPath?: string; patch: string | null };
/** A label on the PR and who added it; actor null when that could not be read. */
export type TierLabel = { name: string; actor: string | null };

export type TierConfig = {
  docs_globs: string[];
  test_globs: string[];
  ui_globs: string[];
  /** External clients, dependency manifests and locks, CI/deploy/infra config, auth, migrations. */
  v3_globs: string[];
  protected_paths: string[];
  owners: string[];
};

/** What evidence a V3 file asks for: a screen shot and the lead's verdict, or a dev check. */
type V3Kind = "ui" | "dev";
export type FileTier = { path: string; tier: Tier; why: string; v3?: V3Kind };

/** The fields of `verify_tier_set` (minus pr, head_sha, actor) plus the per-file breakdown. */
export type TierVerdict = {
  computed: Tier;
  requested?: Tier;
  effective: Tier;
  accepted: boolean;
  reason: string;
  files: FileTier[];
};

const LISTS = ["docs_globs", "test_globs", "ui_globs", "v3_globs", "protected_paths"] as const;

/** null when the config is not an object or any list is missing or not a list of strings. */
export function parseTierConfig(raw: unknown): TierConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) && v.every((s) => typeof s === "string") ? (v as string[]) : null);
  const out: Partial<TierConfig> = {};
  for (const k of LISTS) {
    const v = list(r[k]);
    if (!v) return null;
    out[k] = v;
  }
  const owners = r.owners === undefined ? [] : list(r.owners);
  if (!owners) return null;
  return { ...(out as Omit<TierConfig, "owners">), owners: owners.map((o) => o.toLowerCase()) };
}

const rank = (t: Tier) => TIERS.indexOf(t);
const max = (a: Tier, b: Tier): Tier => (rank(a) >= rank(b) ? a : b);
const on = (globs: readonly string[], path: string) => globs.some((g) => matchesPath(g, path));

const C_LIKE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|java|kt|go|rs|c|h|cc|cpp|hpp|cs|swift|scala)$/;
const HASH = /\.(py|sh|bash|zsh|rb)$/;

function isCommentLine(line: string, lang: "c" | "hash"): boolean {
  if (lang === "hash") return line.startsWith("#");
  if (line.startsWith("//") || line === "*/" || line === "*" || line.startsWith("* ")) return true;
  if (line.startsWith("/*")) return !line.includes("*/") || line.endsWith("*/");
  return false;
}

/** true only when the language has a parser here and every changed non-blank line is a comment. */
function commentOnly(path: string, patch: string | null): boolean | "no_parser" {
  const lang = C_LIKE.test(path) ? "c" : HASH.test(path) ? "hash" : null;
  if (!lang) return "no_parser";
  if (patch === null) return false;
  const changed = patch
    .split("\n")
    .filter((l) => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---"))
    .map((l) => l.slice(1).trim())
    .filter((l) => l !== "");
  return changed.length > 0 && changed.every((l) => isCommentLine(l, lang));
}

function tierOfPath(path: string, file: DiffFile, c: TierConfig): FileTier {
  if (on(c.protected_paths, path)) return { path, tier: "V3", why: "protected_paths", v3: "dev" };
  if (on(c.ui_globs, path)) return { path, tier: "V3", why: "ui_globs", v3: "ui" };
  if (on(c.v3_globs, path)) return { path, tier: "V3", why: "v3_globs", v3: "dev" };
  if (on(c.test_globs, path)) return { path, tier: "V1", why: "test_globs" };
  if (on(c.docs_globs, path)) return { path, tier: "V0", why: "docs_globs" };
  const comments = commentOnly(path, file.patch);
  if (comments === true) return { path, tier: "V0", why: "comment-only" };
  if (comments === "no_parser") return { path, tier: "V2", why: "unclassified, no comment parser for this file type" };
  return { path, tier: "V2", why: file.patch === null ? "source, patch unreadable" : "source change" };
}

function tierOfFile(file: DiffFile, c: TierConfig): FileTier {
  const now = tierOfPath(file.path, file, c);
  if (!file.previousPath) return now;
  const before = tierOfPath(file.previousPath, file, c);
  return rank(before.tier) > rank(now.tier) ? { ...before, path: file.path, why: `renamed from ${file.previousPath}: ${before.why}` } : now;
}

const TIER_LABEL = /^verify-tier:([0-3])$/;

export function verifyTier(diff: readonly DiffFile[] | null, labels: readonly TierLabel[] | null, config: TierConfig | null): TierVerdict {
  const reasons: string[] = [];
  let files: FileTier[] = [];
  let computed: Tier;
  if (diff === null) {
    computed = "V3";
    reasons.push("diff unreadable");
  } else if (config === null) {
    computed = "V3";
    reasons.push("config unreadable");
  } else {
    files = diff.map((d) => tierOfFile(d, config));
    computed = files.reduce<Tier>((t, x) => max(t, x.tier), "V0");
    reasons.push(diff.length === 0 ? "no file changed" : `highest file tier ${computed}`);
    if (labels?.some((l) => l.name === "refactor")) {
      const broken =
        files.find((x) => x.why === "test_globs") ??
        files.find((x) => x.tier === "V3" && x.why !== "ui_globs");
      if (broken) {
        reasons.push(`refactor label void: ${broken.why === "test_globs" ? "test" : "dependency or config"} file ${broken.path} changed`);
        computed = max(computed, "V2");
      } else {
        files = files.map((x) => (x.tier === "V2" && x.why === "source change" ? { ...x, tier: "V1", why: "refactor" } : x));
        computed = files.reduce<Tier>((t, x) => max(t, x.tier), "V0");
        reasons.push("refactor label holds");
      }
    }
  }

  let effective = computed;
  let requested: Tier | undefined;
  let accepted = true;
  if (labels === null) {
    effective = "V3";
    accepted = false;
    reasons.push("labels unreadable");
  } else {
    const asked = labels.flatMap((l) => {
      const m = TIER_LABEL.exec(l.name);
      return m ? [{ tier: `V${m[1]}` as Tier, actor: l.actor?.toLowerCase() ?? null }] : [];
    });
    const raises = asked.filter((a) => rank(a.tier) >= rank(computed));
    const lowers = asked.filter((a) => rank(a.tier) < rank(computed));
    const owners = config?.owners ?? [];
    if (raises.length > 0) {
      requested = raises.reduce<Tier>((t, a) => max(t, a.tier), "V0");
      effective = requested;
      reasons.push(`label verify-tier:${requested.slice(1)} raises`);
    } else if (lowers.length > 0) {
      const byOwner = lowers.filter((a) => a.actor !== null && owners.includes(a.actor));
      if (byOwner.length > 0) {
        requested = byOwner.reduce<Tier>((t, a) => max(t, a.tier), "V0");
        effective = requested;
        reasons.push(`label verify-tier:${requested.slice(1)} lowered by an owner`);
      } else {
        const first = lowers[0] as { tier: Tier; actor: string | null };
        requested = first.tier;
        accepted = false;
        reasons.push(`lowering by ${first.actor ?? "an unknown author"} ignored: not in owners`);
      }
    }
  }

  if (rank(effective) < rank("V3") && files.some((x) => x.why.endsWith("protected_paths"))) {
    effective = "V3";
    accepted = false;
    reasons.push("protected_paths keep V3");
  }
  return { computed, ...(requested ? { requested } : {}), effective, accepted, reason: reasons.join("; "), files };
}

/** Evidence kinds a land needs at the head (decision 85's table; V0's CI is GitHub's to enforce). */
export function requiredEvidence(v: TierVerdict): string[] {
  const kinds: string[] = [];
  if (rank(v.effective) >= 1) kinds.push("test");
  if (rank(v.effective) >= 2) kinds.push("run");
  if (v.effective === "V3") {
    const ui = v.files.some((x) => x.v3 === "ui");
    const dev = v.files.some((x) => x.v3 === "dev");
    if (ui) kinds.push("ui");
    if (dev || !ui) kinds.push("dev");
  }
  return kinds;
}
