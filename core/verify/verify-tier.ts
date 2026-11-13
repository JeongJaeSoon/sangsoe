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
  /** Decision 238: per repository (lowercase owner/name), where a `ui` row is taken and what it measures. */
  ui_evidence?: Record<string, UiEvidenceRule>;
};

export type UiEvidenceRule = { surface: string[]; measures: string[] };

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

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

/** `ui_evidence` read, absent (undefined) or malformed (null): each repo needs a non-empty surface and measures list. */
function uiEvidence(v: unknown): Record<string, UiEvidenceRule> | undefined | null {
  if (v === undefined) return undefined;
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const out: Record<string, UiEvidenceRule> = {};
  for (const [repo, rule] of Object.entries(v)) {
    const r = typeof rule === "object" && rule !== null ? (rule as Record<string, unknown>) : {};
    if (!strings(r.surface) || !strings(r.measures) || r.surface.length === 0 || r.measures.length === 0) return null;
    out[repo.toLowerCase()] = { surface: r.surface, measures: r.measures };
  }
  return out;
}

/** The lists `parseTierConfig` needs that `raw` lacks or holds as something other than strings. */
export function tierConfigGaps(raw: unknown): string[] {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return [
    ...LISTS.filter((k) => !strings(r[k])),
    ...(r.owners === undefined || strings(r.owners) ? [] : ["owners"]),
    ...(uiEvidence(r.ui_evidence) === null ? ["ui_evidence"] : []),
  ];
}

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
  const ui = uiEvidence(r.ui_evidence);
  if (ui === null) return null;
  return { ...(out as Omit<TierConfig, "owners">), owners: owners.map((o) => o.toLowerCase()), ...(ui ? { ui_evidence: ui } : {}) };
}

const rank = (t: Tier) => TIERS.indexOf(t);
const max = (a: Tier, b: Tier): Tier => (rank(a) >= rank(b) ? a : b);
const on = (globs: readonly string[], path: string) => globs.some((g) => matchesPath(g, path));

function tierOfPath(path: string, file: DiffFile, c: TierConfig): FileTier {
  if (on(c.protected_paths, path)) return { path, tier: "V3", why: "protected_paths", v3: "dev" };
  if (on(c.ui_globs, path)) return { path, tier: "V3", why: "ui_globs", v3: "ui" };
  if (on(c.v3_globs, path)) return { path, tier: "V3", why: "v3_globs", v3: "dev" };
  if (on(c.test_globs, path)) return { path, tier: "V1", why: "test_globs" };
  if (on(c.docs_globs, path)) return { path, tier: "V0", why: "docs_globs" };
  // Decision 85's comment-only V0 needs a parser; a diff hunk is not enough to tell a comment
  // from code (an added `*/` reopens code, `//` inside a template literal is data), and no
  // file is tokenized here, so every language takes the no-parser V2.
  return { path, tier: "V2", why: file.patch === null ? "source, patch unreadable" : "source change" };
}

function tierOfFile(file: DiffFile, c: TierConfig): FileTier {
  const now = tierOfPath(file.path, file, c);
  if (!file.previousPath) return now;
  const before = tierOfPath(file.previousPath, file, c);
  return rank(before.tier) > rank(now.tier) ? { ...before, path: file.path, why: `renamed from ${file.previousPath}: ${before.why}` } : now;
}

const TIER_LABEL = /^verify-tier:([0-3])$/;

/** `unreadable` is the reason given when `config` is null; land names the lists it lacked there. */
export function verifyTier(
  diff: readonly DiffFile[] | null,
  labels: readonly TierLabel[] | null,
  config: TierConfig | null,
  unreadable = "config unreadable",
): TierVerdict {
  const reasons: string[] = [];
  let files: FileTier[] = [];
  let computed: Tier;
  if (diff === null) {
    computed = "V3";
    reasons.push("diff unreadable");
  } else if (config === null) {
    computed = "V3";
    reasons.push(unreadable);
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
