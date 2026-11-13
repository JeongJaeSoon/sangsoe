/** The shape of core/capacity's judgeLoad result; the caller passes that one judgment in (decision 83). */
export type LoadVerdict = { level: "ok" | "warn" | "danger"; reasons: readonly string[] };

export type Decision = "allow" | "ask" | "deny";

/** The four gates of appendix #gates, the start guard (decision 94 (마)) and the report-address shape check (N8). */
export type GateName = "pressure" | "sleep-loop" | "delegate" | "self-land" | "start" | "report-address" | "done-blockers";

export type Verdict = { decision: Decision; gate: GateName; reason: string };

export type Role = "orchestrator" | "lead" | "worker" | "general";

/** One PreToolUse call as Claude Code hands it over. */
export type ToolCall = {
  tool: string;
  input: Readonly<Record<string, unknown>>;
  cwd: string;
  /** The call came from a subagent (the hook input carries an agent_id). */
  subagent: boolean;
};

export type OpenPr = { pr: string; landRequested: boolean };

/**
 * What a gate may need beyond the call. Each is read only when a gate asks, so a plain `ls` costs no
 * load sample, no transcript read and no gh call. `undefined` means "could not be read".
 */
export type Facts = {
  role(): Role;
  load(): LoadVerdict;
  /** Open PRs from this worktree's branch, with whether a land request exists for each. */
  ownOpenPrs(): readonly OpenPr[] | undefined;
  /** A script file a command runs, so a start wrapped in a script is read too. */
  readScript(path: string): string | undefined;
  /** done_blockers of a Task over the store and its Run's task list (the bound Run without `run`). */
  doneBlockers(task: string, run?: string): readonly string[] | undefined;
  /** The session is sangsoe's (decision 239): a sangsoe agent, started by sangsoe, or on a Task sangsoe made. */
  sangsoe(): boolean | undefined;
};

/** null is "no opinion": the call goes on to Claude Code's own permission check. */
export type Gate = (call: ToolCall, facts: Facts) => Verdict | null;
