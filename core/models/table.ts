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
    source: "overview",
    verified: "2026-11-10",
  },
];

/** The Claude Code release the catalog was checked against; doctor notices a newer one. */
export const VERIFIED_WITH_CLAUDE_CODE = "2.1.322";

/**
 * What a session's work is. `orchestrator`, `lead` and `worker` are the roles' defaults; the rest
 * are kinds a starter names when the work is not plain implementation.
 */
export const KINDS = ["orchestrator", "lead", "worker", "design", "review", "release-review", "sweep"] as const;
export type Kind = (typeof KINDS)[number];

export type PolicyRow = {
  what: string;
  tier: Tier;
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
    what: "the owner's session: intake, placement, judgment over every Run",
    tier: "primary",
    effort: "medium",
    raiseEffort: ["high", "xhigh"],
    thenTier: "frontier",
    trigger: "a hard root-cause or design call it cannot hand down",
    cite: "choosing",
    quote: "Most workloads start with Claude Opus 5.5.",
  },
  lead: {
    what: "one program's lead",
    tier: "primary",
    effort: "medium",
    raiseEffort: ["high", "xhigh"],
    thenTier: "frontier",
    trigger: "the same step failed twice, or review found a real defect the lead missed",
    cite: "choosing",
    quote: "Tuning effort is often a better lever than switching models.",
  },
  worker: {
    what: "one Task: implementation",
    tier: "primary",
    effort: "medium",
    raiseEffort: ["high", "xhigh"],
    thenTier: "frontier",
    trigger: "the same step failed twice, or review found a real defect",
    cite: "choosing",
    quote: "Most workloads start with Claude Opus 5.5.",
  },
  design: {
    what: "a hard root-cause or a one-way-door design call",
    tier: "primary",
    effort: "high",
    raiseEffort: ["xhigh", "max"],
    thenTier: "frontier",
    trigger: "xhigh or max still falls short on the reasoning",
    cite: "choosing",
    quote:
      "If your evals at `xhigh` or `max` effort still fall short on demanding reasoning or long-horizon agentic work, move to Claude Fable 5.2.",
  },
  review: {
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
    what: "the final independent review before a stable tag",
    tier: "frontier",
    effort: "high",
    raiseEffort: ["xhigh", "max"],
    trigger: "never lowered for cost; raise effort when the release is large",
    cite: "choosing",
    quote:
      "Claude Fable 5.2 (`claude-fable-5-2`) is Anthropic's most capable model open to all customers. It's built for demanding reasoning and long-horizon agentic work.",
  },
  sweep: {
    what: "mechanical sweeps: listing, measuring, searching past sessions, subagent fan-out",
    tier: "fast",
    effort: "medium",
    raiseEffort: ["high"],
    thenTier: "everyday",
    trigger: "the sweep needs judgment it gets wrong at high",
    cite: "choosing",
    quote:
      "The lowest latency and price / Claude Haiku 5.5 / Real-time applications, high-volume intelligent processing, cost-sensitive deployments needing strong reasoning, subagent tasks",
  },
};

/** Guidance changes, newest first: readable without git. Each line also gets a decision. */
export const CHANGELOG: readonly { date: string; change: string; source: Source; decision: number }[] = [
  {
    date: "2026-11-10",
    change:
      "First table: tiers frontier/primary/everyday/fast; every role starts on primary at medium, raises effort first, moves to frontier only with a recorded reason; sweeps on fast; the stable-release review on frontier. Replaces decision 13's deep/standard/light/wait profiles.",
    source: "choosing",
    decision: 164,
  },
];
