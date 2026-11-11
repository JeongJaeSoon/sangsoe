import { CATALOG, type CatalogRow, CLASS_KIND, EFFORTS, type Effort, KINDS, type Kind, POLICY, TIERS, type Tier, UNIT_CLASSES, type UnitClass } from "./table.ts";

export * from "./spend.ts";
export * from "./table.ts";
export * from "./view.ts";

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

/**
 * How an advisor can reach a new session: Orca's launch option, the new worktree's own
 * `.claude/settings.local.json` (decision 200), or the owner's user setting (decision 187).
 * `spent`: the row's advisor budget is used up, so this start turns the advisor off.
 */
export type AdvisorPath = { orcaFlag: boolean; ownerSetting: boolean; worktreeFile?: boolean; spent?: boolean };

/** What start_unit writes into the new worktree's local settings before its session starts. */
export type WorktreeSettings = { advisorModel?: string; disableAdvisor?: true };

export type AdvisorRoute = "orca_flag" | "worktree_file" | "owner_setting" | "none";

export type Launch = {
  model: string;
  effort: Effort;
  /** Passed as `--advisor` only when Orca's worker-start takes it. */
  advisor?: string;
  /** Written to the new worktree's local settings; absent when sangsoe cannot write there. */
  settings?: WorktreeSettings;
  route: AdvisorRoute;
  /** What the start tells its caller about the advisor. */
  note?: string;
  /** Set when the main model moved because no advisor could be attached; recorded as `model_changed`. */
  fallback?: { from: string; reason: string };
};

export const ADVISOR_FROM_SETTING =
  "advisor from the owner's advisorModel setting: sangsoe does not know its tier, and Claude Code drops one ranked below the main model";
export const ADVISOR_NOT_APPLIED = "advisor not applied: Orca worker-start has no advisor flag and no advisorModel setting";
export const ADVISOR_FROM_WORKTREE = "advisor from the new worktree's .claude/settings.local.json (decision 200)";
export const ADVISOR_SPENT = "advisor off: this row's advisor budget is spent; it stays off for this start (decision 200)";

/**
 * The launch for one choice (decisions 187, 200). A row with `withoutAdvisor` never runs its main
 * tier without an advisor: with no path, or a spent budget, it runs on that tier at its starting
 * effort instead. With the worktree file, a row that names no advisor (or a spent one) also turns
 * off an advisor the owner's own setting would add.
 */
export function launch(choice: Choice, path: AdvisorPath): Launch {
  const off = path.worktreeFile ? { settings: { disableAdvisor: true as const } } : {};
  const out: Launch = { model: choice.model, effort: choice.effort, route: "none" };
  if (!choice.advisor) return { ...out, ...off };
  if (!path.spent) {
    if (path.orcaFlag) return { ...out, advisor: choice.advisor, route: "orca_flag" };
    if (path.worktreeFile) return { ...out, settings: { advisorModel: choice.advisor }, route: "worktree_file", note: ADVISOR_FROM_WORKTREE };
    if (path.ownerSetting) return { ...out, route: "owner_setting", note: ADVISOR_FROM_SETTING };
  }
  const why = path.spent ? ADVISOR_SPENT : ADVISOR_NOT_APPLIED;
  const floor = POLICY[choice.kind].withoutAdvisor;
  if (!floor || TIERS.indexOf(choice.tier) <= TIERS.indexOf(floor)) return { ...out, ...off, note: why };
  // The floor tier starts at its API default, but never below an effort the lead already raised to.
  const base = catalogRow(floor).apiDefaultEffort;
  return {
    model: aliasOf(floor),
    effort: EFFORTS.indexOf(choice.effort) > EFFORTS.indexOf(base) ? choice.effort : base,
    route: "none",
    ...off,
    note: why,
    fallback: { from: `${choice.model}/${choice.effort}`, reason: why },
  };
}

/**
 * The first lines a session of this row reads (decision 200): the advisor budget and, below high
 * effort, the guide's finish-the-whole-task advice. SessionStart prints them; nothing stores them.
 */
export function rowLines(started: { effort: Effort; route: AdvisorRoute; budget: number; budget_per: "unit" | "day" }): string[] {
  const lines: string[] = [];
  if (started.budget > 0 && started.route !== "none") {
    const per = started.budget_per === "day" ? "하루" : "이 단위에서";
    lines.push(
      `advisor 는 ${per} 약 ${started.budget}회: 접근을 정하기 전, 끝났다고 말하기 전, 막혔을 때. sangsoe 가 transcript 에서 세고, 다 쓰면 다음 시작부터 끈다.`,
    );
  }
  if (EFFORTS.indexOf(started.effort) < EFFORTS.indexOf("high")) {
    lines.push("일 전체를 끝까지 한다: 남은 일 목록이나 계속할지 묻는 말로 턴을 닫지 않고, 평범한 장애는 진단해 넘어간다. 답이 필요한 결정만 묻고 나머지는 계속한다.");
  }
  return lines;
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
