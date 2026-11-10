import { CATALOG, type CatalogRow, EFFORTS, type Effort, KINDS, type Kind, POLICY, type Tier } from "./table.ts";

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

/** A starter's escalation: a higher effort from the row's ladder, or the row's next tier with a reason. */
export type Raise = { effort?: Effort; tier?: Tier; reason?: string };

export type Choice = {
  kind: Kind;
  tier: Tier;
  /** What `--model` gets: a pinned dated ID when the catalog row has one, else the alias. */
  model: string;
  effort: Effort;
  /** Set when the choice left the row's default; the start records it as `model_changed`. */
  escalated?: { from: string; reason: string };
};

export type Resolved = { ok: true; value: Choice } | { ok: false; reason: string };

/**
 * The model and effort for one kind of work. Effort goes up the row's ladder first; the tier moves
 * only to the row's `thenTier`, only from the ladder's last effort, and only with a reason.
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
  }
  const changed = tier !== row.tier || effort !== row.effort;
  const reason = raise.reason?.trim();
  if (changed && !reason) return { ok: false, reason: `${kind}: an escalation needs a reason` };
  const target = catalogRow(tier);
  const value: Choice = { kind, tier, model: target.pin?.id ?? target.alias, effort };
  if (changed && reason) value.escalated = { from: `${base.pin?.id ?? base.alias}/${row.effort}`, reason };
  return { ok: true, value };
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
