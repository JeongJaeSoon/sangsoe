// The one model-selection table (decision 164). Data only: core/models/index.ts reads it, the MCP
// resource `models` serves it, test/model-table.test.ts guards it. The update procedure is README.md.
// Policy rows name tiers, never models or versions; versions live only in CATALOG rows.

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export const TIERS = ["frontier", "primary", "everyday", "fast"] as const;
export type Tier = (typeof TIERS)[number];

/** The Claude Code aliases sangsoe passes; Claude Code resolves each to a version itself. */
export type Alias = "fable" | "opus" | "sonnet" | "haiku";

export const SOURCES = {
  choosing: "https://platform.claude.com/docs/en/about-claude/models/choosing-a-model",
  overview: "https://platform.claude.com/docs/en/about-claude/models/overview",
  modelConfig: "https://code.claude.com/docs/en/model-config",
  subAgents: "https://code.claude.com/docs/en/sub-agents",
  effort: "https://platform.claude.com/docs/en/build-with-claude/effort",
  advisor: "https://code.claude.com/docs/en/advisor",
  advisorTool: "https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool",
  settings: "https://code.claude.com/docs/en/settings",
  frontierNew: "https://platform.claude.com/docs/en/models/fable-5-2/whats-new-fable-5-2",
  frontierPrompting: "https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2",
} as const;
export type Source = keyof typeof SOURCES;

export type CatalogRow = {
  tier: Tier;
  alias: Alias;
  /** The version the alias resolved to on the Anthropic API when verified. Shown, never passed. */
  currentId: string;
  /** The guide's own words for what the model is for. */
  role: string;
  /** USD per million tokens. */
  price: { input: number; output: number };
  context: string;
  maxOutput: string;
  /** "The effort parameter's default on the Claude API" (overview); Claude Code may differ. */
  apiDefaultEffort: Effort;
  /**
   * The efforts Orca's worker-start takes with this alias (decision 209), from its launch catalog
   * (ORCA_LAUNCH_CATALOG). Empty: Orca refuses any `--effort`, so start_unit sends none and the
   * session runs at Claude Code's own setting for the model.
   */
  orcaEfforts: readonly Effort[];
  source: Source;
  verified: string;
  /** A dated ID that must not move (e.g. for a stable release's review); doctor reports it while set. */
  pin?: { id: string; reason: string; since: string };
};

/** The model catalog: a new release touches only these rows. */
export const CATALOG: readonly CatalogRow[] = [
  {
    tier: "frontier",
    alias: "fable",
    currentId: "claude-fable-5-2",
    role: "The highest available capability: demanding reasoning and long-horizon agentic work",
    price: { input: 8, output: 40 },
    context: "1M",
    maxOutput: "128K",
    apiDefaultEffort: "high",
    orcaEfforts: EFFORTS,
    source: "overview",
    verified: "2026-11-10",
  },
  {
    tier: "primary",
    alias: "opus",
    currentId: "claude-opus-5-5",
    role: "Complex agentic coding and enterprise work; most workloads start here",
    price: { input: 4, output: 20 },
    context: "1M",
    maxOutput: "128K",
    apiDefaultEffort: "medium",
    orcaEfforts: EFFORTS,
    source: "overview",
    verified: "2026-11-10",
  },
  {
    tier: "everyday",
    alias: "sonnet",
    currentId: "claude-sonnet-5-5",
    role: "Speed and capability for everyday coding, agent, and enterprise workloads",
    price: { input: 2, output: 10 },
    context: "1M",
    maxOutput: "128K",
    apiDefaultEffort: "high",
    orcaEfforts: EFFORTS,
    source: "overview",
    verified: "2026-11-10",
  },
  {
    tier: "fast",
    alias: "haiku",
    currentId: "claude-haiku-5-5",
    role: "The lowest latency and price: high-volume processing and subagent tasks",
    price: { input: 0.1, output: 0.5 },
    context: "1M",
    maxOutput: "128K",
    apiDefaultEffort: "medium",
    orcaEfforts: [],
    source: "overview",
    verified: "2026-11-10",
  },
];

/**
 * Where `orcaEfforts` comes from: Orca's own check, run read-only for every alias and effort on the
 * installed build (decision 209). Orca has no dry-run for worker-start and its agent-context has no
 * model list, so doctor cannot read this at run time.
 */
export const ORCA_LAUNCH_CATALOG = {
  orca: "1.4.250",
  check: "out/shared/agent-launch/choices/agent-launch-model-preferences.js",
  catalog: "out/shared/agent-session/options/agent-session-option-catalog-claude-codex.js",
} as const;

/** The Claude Code release the catalog was checked against; doctor notices a newer one. */
export const VERIFIED_WITH_CLAUDE_CODE = "2.1.322";

/**
 * What a session's work is. `orchestrator`, `lead` and `worker` are the roles' defaults; the rest
 * are kinds a starter names when the work is not plain implementation.
 */
export const KINDS = ["orchestrator", "lead", "worker", "hard", "design", "review", "release-review", "sweep", "docs"] as const;
export type Kind = (typeof KINDS)[number];

/** How a lead marks a worker unit (decisions 187, 200): each class is a worker kind's row. */
export const UNIT_CLASSES = ["default", "hard", "design", "mechanical", "docs"] as const;
export type UnitClass = (typeof UNIT_CLASSES)[number];
export const CLASS_KIND: Readonly<Record<UnitClass, Kind>> = {
  default: "worker",
  hard: "hard",
  design: "design",
  mechanical: "sweep",
  docs: "docs",
};

/**
 * Advisor calls a row's brief asks for (decision 200). Claude Code has no setting that caps them, so
 * the count is read from transcripts and an exhausted budget turns the advisor off at the next start.
 */
export type AdvisorBudget = { calls: number; per: "unit" | "day" };

export type PolicyRow = {
  /** The case's name on screen (`sangsoe models`, brief). */
  label: string;
  what: string;
  /** One line: why this tier, effort and advisor for this case. */
  why: string;
  /** Zero exactly when the row names no advisor. */
  budget: AdvisorBudget;
  tier: Tier;
  /**
   * The advisor tier passed as `--advisor` (decision 187). It ranks at or above `tier`, and the fast
   * tier never advises; resolve refuses any other pair. Absent: no advisor is asked for.
   */
  advisor?: Tier;
  /** The advisor after a move to `thenTier`; default `advisor`. */
  thenAdvisor?: Tier;
  /** The main tier when no advisor can be attached: a row whose main tier needs its advisor (decision 187). */
  withoutAdvisor?: Tier;
  effort: Effort;
  /** Raise effort through these, in order, before changing tier. */
  raiseEffort: readonly Effort[];
  /** The tier to move to once the last effort still falls short; needs a recorded reason. */
  thenTier?: Tier;
  /** When to escalate. */
  trigger: string;
  cite: Source;
  /** The guide sentence this row rests on, verbatim. */
  quote: string;
};

/** The selection policy: a guide wording change touches only these rows. */
export const POLICY: Readonly<Record<Kind, PolicyRow>> = {
  orchestrator: {
    label: "오케스트레이터",
    what: "the owner's session: intake, placement, judgment over every Run",
    why: "대부분의 일은 이 tier 에서 시작하고, 어려운 판단은 effort 를 먼저 올린다",
    budget: { calls: 0, per: "unit" },
    tier: "primary",
    effort: "medium",
    raiseEffort: ["high", "xhigh"],
    thenTier: "frontier",
    trigger: "a hard root-cause or design call it cannot hand down",
    cite: "choosing",
    quote: "Most workloads start with Claude Opus 5.5.",
  },
  lead: {
    label: "리드(묶음 진행)",
    what: "one program's lead",
    why: "묶음을 끝까지 끄는 세션: 막힐 때만 위 tier 의 조언을 받고 하루 예산 안에서 쓴다",
    budget: { calls: 6, per: "day" },
    tier: "primary",
    advisor: "frontier",
    effort: "medium",
    raiseEffort: ["high", "xhigh"],
    thenTier: "frontier",
    trigger: "the same step failed twice, or review found a real defect the lead missed",
    cite: "choosing",
    quote: "Tuning effort is often a better lever than switching models.",
  },
  worker: {
    label: "구현",
    what: "one Task: implementation (class default)",
    why: "낮은 tier 를 중간 effort 로 두고 위 tier advisor 를 붙이면 기본 effort 와 비슷한 결과를 더 싸게 낸다",
    budget: { calls: 3, per: "unit" },
    tier: "everyday",
    advisor: "primary",
    thenAdvisor: "frontier",
    withoutAdvisor: "primary",
    effort: "medium",
    raiseEffort: ["high"],
    thenTier: "primary",
    trigger: "the first Act-on finding raises effort back; a second failed review round moves to the next tier",
    cite: "advisorTool",
    quote:
      "For coding tasks, pairing a Sonnet executor at medium effort with an Opus advisor achieves intelligence comparable to Sonnet at default effort, at lower cost.",
  },
  hard: {
    label: "어려운 구현",
    what: "one Task the lead marked hard (class hard)",
    why: "검증이 중요하거나 경계 사례가 많은 일이라 effort 를 한 단계 올려 시작한다",
    budget: { calls: 3, per: "unit" },
    tier: "primary",
    advisor: "frontier",
    effort: "high",
    raiseEffort: ["xhigh"],
    thenTier: "frontier",
    trigger: "the same step failed twice at the ladder's top",
    cite: "modelConfig",
    quote: "Work where verification matters or edge cases are likely, such as fixing a bug in an existing codebase.",
  },
  docs: {
    label: "문서",
    what: "a docs-only unit (class docs): prose, READMEs, decision lines; no logic change",
    why: "범위가 분명한 평소 일이라 구현 tier 를 중간 effort 로, advisor 없이 쓴다",
    budget: { calls: 0, per: "unit" },
    tier: "everyday",
    effort: "medium",
    raiseEffort: ["high"],
    trigger: "review found Act-on twice",
    cite: "modelConfig",
    quote: "On Opus 5.5 and Sonnet 5.5, it fits day-to-day engineering work with a clear scope, such as implementing a new feature.",
  },
  design: {
    label: "근본 원인·설계",
    why: "되돌리기 어려운 판단이라 높은 effort 에 가장 높은 tier advisor 를 붙이고, xhigh 위는 측정한 이득이 있을 때만",
    budget: { calls: 3, per: "unit" },
    what: "a hard root-cause or a one-way-door design call (class design)",
    tier: "primary",
    advisor: "frontier",
    effort: "high",
    raiseEffort: ["xhigh", "max"],
    thenTier: "frontier",
    trigger: "xhigh or max still falls short on the reasoning",
    cite: "choosing",
    quote:
      "If your evals at `xhigh` or `max` effort still fall short on demanding reasoning or long-horizon agentic work, move to Claude Fable 5.2.",
  },
  review: {
    label: "리뷰",
    why: "독립 판정이라 조언자 없이 높은 effort 로 읽고, 놓친 것이 나오면 effort 부터 올린다",
    budget: { calls: 0, per: "unit" },
    what: "an independent review of one PR",
    tier: "primary",
    effort: "high",
    raiseEffort: ["xhigh"],
    thenTier: "frontier",
    trigger: "a later round found an Act-on finding an earlier round missed",
    cite: "choosing",
    quote: "Tuning effort is often a better lever than switching models.",
  },
  "release-review": {
    label: "안정 릴리스 마지막 리뷰",
    what: "the final independent review before a stable tag",
    why: "가장 높은 tier 를 실행자로 쓸 때는 high 에서 시작하고, 비용 때문에 내리지 않는다",
    budget: { calls: 0, per: "unit" },
    tier: "frontier",
    effort: "high",
    raiseEffort: ["xhigh", "max"],
    trigger: "never lowered for cost; raise effort when the release is large",
    cite: "frontierNew",
    quote: "The API default is `high`. Start there, because most of the gain in capability is already present at `high`.",
  },
  sweep: {
    label: "기계적 일",
    what: "mechanical units and sweeps (class mechanical): version bumps, link fixes, listing, measuring, collection; never implementation",
    why: "이름 바꾸기처럼 작은 일이라 가장 낮은 effort 로 하고, 브리프의 끝까지 하라는 줄이 일찍 멈추는 것을 막는다",
    budget: { calls: 0, per: "unit" },
    tier: "fast",
    effort: "low",
    raiseEffort: [],
    thenTier: "everyday",
    trigger: "the unit failed once, or needs judgment it gets wrong",
    cite: "modelConfig",
    quote: "Quick exchanges where you review each result, such as brainstorming, a first sketch, or a small change like a rename",
  },
};

/**
 * The tier a subagent spawned from skill or agent text runs on (decision 188): every spawn names
 * one, never the session's own model. `collect` searches, lists and gathers; `judge` reads and
 * weighs. A PR's independent review is the `review` row, not a subagent class.
 */
export const SUBAGENTS: Readonly<Record<"collect" | "judge", Tier>> = { collect: "fast", judge: "everyday" };

/** Guidance changes, newest first: readable without git. Each line also gets a decision. */
export const CHANGELOG: readonly { date: string; change: string; source: Source; decision: number }[] = [
  {
    date: "2026-11-11",
    change:
      "Rows per case with a label, a one-line why and an advisor call budget. Implementation drops to medium with its advisor (first Act-on raises effort back, a second failed round moves tier); hard implementation starts at high; mechanical runs at low; a new docs row runs the implementation tier at medium without an advisor. Rows below high carry a finish-the-whole-task line. sangsoe counts advisor calls from the transcript and shows them against the budget; the advisor still reaches a session through decision 187's route.",
    source: "advisorTool",
    decision: 200,
  },
  {
    date: "2026-11-11",
    change:
      "Advisor pairing: rows name an advisor tier that ranks at or above the main tier (the fast tier never advises). Implementation workers run on everyday with a primary advisor and move to primary after a PR fails review twice; class hard runs primary with a frontier advisor; mechanical units run fast and retry on everyday. Without an advisor (no Orca launch option and no advisorModel setting) the worker row runs on primary instead. Subagents name collect or judge. A deliberate deviation from choosing-a-model's start on primary, resting on the advisor-tool page.",
    source: "advisorTool",
    decision: 187,
  },
  {
    date: "2026-11-10",
    change:
      "A move to the next tier starts at that tier's apiDefaultEffort (frontier: high), not at the ladder's top effort that earned it: the effort guide starts the frontier tier at high, keeps xhigh for the hardest long-running work with a measured gain and max in reserve, and Claude Code's own default is lower, so start_unit always passes --effort.",
    source: "effort",
    decision: 172,
  },
  {
    date: "2026-11-10",
    change:
      "First table: tiers frontier/primary/everyday/fast; every role starts on primary at medium, raises effort first, moves to frontier only with a recorded reason; sweeps on fast; the stable-release review on frontier. Replaces decision 13's deep/standard/light/wait profiles.",
    source: "choosing",
    decision: 164,
  },
];
