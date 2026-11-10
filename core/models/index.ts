import { CATALOG, type CatalogRow, CLASS_KIND, EFFORTS, type Effort, KINDS, type Kind, POLICY, TIERS, type Tier, UNIT_CLASSES, type UnitClass } from "./table.ts";

export * from "./table.ts";

/** Days after `verified` when doctor asks for the guide pages to be read again (decision 165). */
export const STALE_DAYS = 60;

export function catalogRow(tier: Tier): CatalogRow {
  const row = CATALOG.find((r) => r.tier === tier);
  if (!row) throw new Error(`no catalog row for tier ${tier}`);
  return row;
}

export const isKind = (s: string): s is Kind => (KINDS as readonly string[]).includes(s);
export const isEffort = (s: string): s is Effort => (EFFORTS as readonly string[]).includes(s);
export const isUnitClass = (s: string): s is UnitClass => (UNIT_CLASSES as readonly string[]).includes(s);
export const classKind = (c: UnitClass): Kind => CLASS_KIND[c];

/**
 * Null when `advisor` may advise `main`, else why not (decision 187). Claude Code's own rule is that
 * the advisor ranks at or above the main model, and a lower one is dropped without an error, so
 * this check is the only refusal a bad pair gets. The fast tier never advises.
 */
export function pairing(main: Tier, advisor: Tier): string | null {
  if (advisor === "fast") return `the ${advisor} tier does not advise`;
  if (TIERS.indexOf(advisor) > TIERS.indexOf(main)) return `advisor tier ${advisor} ranks below main tier ${main}`;
  return null;
}

/** A starter's escalation: a higher effort from the row's ladder, or the row's next tier with a reason. */
export type Raise = { effort?: Effort; tier?: Tier; reason?: string };

export type Choice = {
  kind: Kind;
  tier: Tier;
  /** What `--model` gets: a pinned dated ID when the catalog row has one, else the alias. */
  model: string;
  effort: Effort;
  /** What `--advisor` gets, the same way as `model`; absent when the row asks for none. */
  advisor?: string;
  advisorTier?: Tier;
  /** Set when the choice left the row's default; the start records it as `model_changed`. */
  escalated?: { from: string; reason: string };
};

const aliasOf = (tier: Tier) => {
  const row = catalogRow(tier);
  return row.pin?.id ?? row.alias;
};

export type Resolved = { ok: true; value: Choice } | { ok: false; reason: string };

/**
 * The model and effort for one kind of work. Effort goes up the row's ladder first; the tier moves
 * only to the row's `thenTier`, only from the ladder's last effort, and only with a reason, and
 * then runs at that tier's `apiDefaultEffort` (decision 172).
 */
export function resolve(kind: Kind, raise: Raise = {}): Resolved {
  const row = POLICY[kind];
  const base = catalogRow(row.tier);
  let tier = row.tier;
  let effort = row.effort;
  if (raise.effort && raise.effort !== row.effort) {
    if (!row.raiseEffort.includes(raise.effort)) {
      return { ok: false, reason: `${kind}: effort ${raise.effort} is not on its ladder (${[row.effort, ...row.raiseEffort].join(" → ")})` };
    }
    effort = raise.effort;
  }
  if (raise.tier && raise.tier !== row.tier) {
    if (raise.tier !== row.thenTier) return { ok: false, reason: `${kind}: may move only to ${row.thenTier ?? "no other tier"}` };
    const top = row.raiseEffort.at(-1) ?? row.effort;
    if (effort !== top) return { ok: false, reason: `${kind}: raise effort to ${top} before changing tier` };
    tier = raise.tier;
    // The new tier starts at its own starting effort, not at the ladder top that earned the move.
    effort = catalogRow(tier).apiDefaultEffort;
  }
  const changed = tier !== row.tier || effort !== row.effort;
  const reason = raise.reason?.trim();
  if (changed && !reason) return { ok: false, reason: `${kind}: an escalation needs a reason` };
  const advisorTier = tier !== row.tier ? (row.thenAdvisor ?? row.advisor) : row.advisor;
  const bad = advisorTier ? pairing(tier, advisorTier) : null;
  if (bad) return { ok: false, reason: `${kind}: ${bad}` };
  const value: Choice = { kind, tier, model: aliasOf(tier), effort };
  if (advisorTier) Object.assign(value, { advisor: aliasOf(advisorTier), advisorTier });
  if (changed && reason) value.escalated = { from: `${base.pin?.id ?? base.alias}/${row.effort}`, reason };
  return { ok: true, value };
}

/** How an advisor can reach a new session: Orca's launch option, or the owner's own setting. */
export type AdvisorPath = { orcaFlag: boolean; ownerSetting: boolean };

export type Launch = {
  model: string;
  effort: Effort;
  /** Passed as `--advisor` only when Orca's worker-start takes it. */
  advisor?: string;
  /** What the start tells its caller about the advisor. */
  note?: string;
  /** Set when the main model moved because no advisor could be attached; recorded as `model_changed`. */
  fallback?: { from: string; reason: string };
};

export const ADVISOR_FROM_SETTING =
  "advisor from the owner's advisorModel setting: sangsoe does not know its tier, and Claude Code drops one ranked below the main model";
export const ADVISOR_NOT_APPLIED = "advisor not applied: Orca worker-start has no advisor flag and no advisorModel setting";

/**
 * The launch for one choice (decision 187). A row with `withoutAdvisor` never runs its main tier
 * without an advisor: with neither path it runs on that tier at its starting effort instead.
 */
export function launch(choice: Choice, path: AdvisorPath): Launch {
  const out: Launch = { model: choice.model, effort: choice.effort };
  if (!choice.advisor) return out;
  if (path.orcaFlag) return { ...out, advisor: choice.advisor };
  if (path.ownerSetting) return { ...out, note: ADVISOR_FROM_SETTING };
  const floor = POLICY[choice.kind].withoutAdvisor;
  if (!floor || TIERS.indexOf(choice.tier) <= TIERS.indexOf(floor)) return { ...out, note: ADVISOR_NOT_APPLIED };
  return {
    model: aliasOf(floor),
    effort: catalogRow(floor).apiDefaultEffort,
    note: ADVISOR_NOT_APPLIED,
    fallback: { from: `${choice.model}/${choice.effort}`, reason: ADVISOR_NOT_APPLIED },
  };
}

/** Days from `verified` to `now`; the oldest row counts. */
export function catalogAgeDays(now: Date): number {
  const oldest = Math.min(...CATALOG.map((r) => Date.parse(`${r.verified}T00:00:00Z`)));
  return Math.floor((now.getTime() - oldest) / 86_400_000);
}

/** -1, 0 or 1 for dotted numeric versions; a missing part counts as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Environment keys that move what an alias or a subagent resolves to, outside sangsoe. */
export const PIN_KEYS = [
  "ANTHROPIC_DEFAULT_FABLE_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "CLAUDE_CODE_EFFORT_LEVEL",
] as const;
