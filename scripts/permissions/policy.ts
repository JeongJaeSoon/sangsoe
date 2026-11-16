// Decision 265: what each command sangsoe's sources run is worth in permissions.allow. The scanner
// (derive.ts) finds the commands; this table only says what to do with each one, so a command the
// scanner finds that is not here fails the generator and test/permissions-derived.test.ts.

export type Entry =
  /** `Bash(orca <path>:*)`. */
  | { kind: "allow"; declared?: string }
  /** `Bash(orca <path> <flag> <prefix>*)`: only the call that names one handle. */
  | { kind: "handle"; flag: string; prefix: string; declared?: string }
  /** Sources mention it, no rule may cover it. */
  | { kind: "deny"; why: string }
  /** sangsoe's own process runs it, not a session's Bash tool: no rule. */
  | { kind: "inprocess"; why: string };

/**
 * `declared` is the source for a rule no sangsoe file names (Orca's own worker preamble tells a
 * session to run it, or the owner asked for it): the reason stands in for the file the scanner
 * cannot find.
 */
const OWNER = "owner order d142 (2026-11-15) names it; no sangsoe file runs it yet";

export const ORCA_POLICY: Readonly<Record<string, Entry>> = {
  // The rules decision 221 and 263 wrote by hand, now kept only because a source runs them.
  "orchestration ask": { kind: "allow" },
  "orchestration send": { kind: "allow" },
  "orchestration reply": { kind: "allow" },
  "orchestration inbox": { kind: "allow" },
  "orchestration check": { kind: "allow" },
  "orchestration run-create": { kind: "allow" },
  "orchestration run-use": { kind: "allow" },
  "orchestration task-list": { kind: "allow" },
  "orchestration task-update": { kind: "allow" },
  "orchestration worker-list": { kind: "allow" },
  "orchestration worker-release": { kind: "allow" },
  "worktree set": { kind: "allow" },
  "worktree show": { kind: "allow" },
  "worktree list": { kind: "allow" },
  "reference list": { kind: "allow" },
  search: { kind: "allow" },
  "terminal close": { kind: "handle", flag: "--terminal", prefix: "term_" },

  // Read-only calls a session makes by hand to look at what the ORCA_COMMANDS wrappers read.
  status: { kind: "allow" },
  "agent-context": { kind: "allow" },
  "agent hooks status": { kind: "allow" },
  "host list": { kind: "allow" },
  "diagnostics memory": { kind: "allow" },
  ports: { kind: "allow" },
  "repo show": { kind: "allow" },
  "reference find": { kind: "allow" },
  "plugin list": { kind: "allow" },
  "plugin inspect": { kind: "allow" },
  "orchestration run-current": { kind: "allow" },
  "orchestration run-show": { kind: "allow" },
  "orchestration run-list": { kind: "allow" },
  "orchestration gate-list": { kind: "allow" },
  "orchestration worker-show": { kind: "allow" },
  "orchestration dispatch-show": { kind: "allow" },
  "orchestration request-show": { kind: "allow" },
  "worktree ps": { kind: "allow" },
  "terminal list": { kind: "allow" },

  // The owner's order: look into and type into another session's terminal, by handle only.
  "terminal send": { kind: "handle", flag: "--terminal", prefix: "term_" },
  "terminal read": { kind: "handle", flag: "--terminal", prefix: "term_", declared: OWNER },

  // Starts belong to the start gate (decision 94); a session opens another session through start_unit only.
  "orchestration worker-start": { kind: "deny", why: "starts go through start_unit and its gate (decision 94)" },
  "worktree create": { kind: "deny", why: "starts go through start_unit and its gate (decision 94)" },
  "agent launch": { kind: "deny", why: "launch agents are forbidden; start_unit is the only start (decision 94)" },
  // Deletes, resets and close-alls.
  "worktree rm": { kind: "deny", why: "deletes a worktree; the REAPER checks first (decisions 62, 86)" },
  // The wrappers and gates sangsoe runs itself; a session writes these through MCP tools, not by hand.
  "orchestration task-create": { kind: "deny", why: "a session creates Tasks through item_create, which writes the item too" },
  "orchestration gate-create": { kind: "deny", why: "a session opens a decision through decision_open" },
  "orchestration gate-resolve": { kind: "deny", why: "a decision is answered through decision_answer" },
  "reference add": { kind: "deny", why: "pr-monitor attaches the reference (decision 193)" },
  // Calls the sangsoe process makes; a session never types them.
  "account list": { kind: "inprocess", why: "install reads Orca's selected profile (core/install/host.ts)" },
  "plugin dev load": { kind: "inprocess", why: "sangsoe install registers the Orca plugin" },
  "plugin dev unload": { kind: "inprocess", why: "sangsoe uninstall unregisters the Orca plugin" },
  "plugin dev reload": { kind: "inprocess", why: "sangsoe plugin approve reloads the Orca plugin" },
  "plugin open": { kind: "inprocess", why: "the Orca plugin opens its own panel" },
};

/** `gh` commands the skills tell a session to run, keyed by the words after `gh`. Read-only verbs only; every write form stays unruled. */
export const GH_POLICY: Readonly<Record<string, Entry>> = {
  "pr view": { kind: "allow" },
  api: { kind: "deny", why: "gh api reaches merge and write endpoints; sangsoe's own calls run in its process" },
};

/**
 * `sangsoe` commands the skills, agents and gates tell a session to run, keyed by the words after
 * `sangsoe`. Read-only verbs only (decision 265): what installs, lands, approves or writes an item
 * runs from the owner's hand or an MCP tool, never from a rule.
 */
export const SANGSOE_POLICY: Readonly<Record<string, Entry>> = {
  "pressure wait": { kind: "allow" },
  brief: { kind: "allow" },
  todo: { kind: "allow" },
  doctor: { kind: "allow" },
  install: { kind: "deny", why: "writes settings and registers the plugin; the owner runs it" },
  uninstall: { kind: "deny", why: "removes registrations and the rules sangsoe added; the owner runs it" },
  "plugin approve": { kind: "deny", why: "approval is the owner's act" },
  land: { kind: "deny", why: "merges; sessions land through the land MCP tool, which checks the verdict first" },
  "item new": { kind: "deny", why: "writes an item; sessions use the item_create MCP tool" },
};

/** Literal `exec("gh"|"git", [...])` calls in sangsoe's code, keyed by command and first non-flag word. */
export const OTHER_EXEC: Readonly<Record<string, string>> = {
  "gh api": "land, doctor and the monitors read GitHub in sangsoe's process",
  "gh pr": "land merges in sangsoe's process after its own checks",
  "gh repo": "the start gate reads the repository in sangsoe's process",
  "git branch": "the start gate reads the branch in sangsoe's process",
  "git remote": "the start gate reads the remote in sangsoe's process",
  "git rev-parse": "land and doctor read a checkout in sangsoe's process",
  "git cat-file": "doctor reads a checkout in sangsoe's process",
  "git status": "approve and the REAPER read a worktree in sangsoe's process",
  "git ls-files": "approve and the model-table check list tracked files in sangsoe's process",
  "git log": "the REAPER reads a branch's history in sangsoe's process",
};

/** sangsoe's own state, read by sessions: the generated file keeps `{HOME}`, install resolves it. */
export const STATE_PATHS: readonly { root: string; rule: string }[] = [
  { root: "~/.config/sangsoe", rule: "Read(//{HOME}/.config/sangsoe/**)" },
  { root: "~/.local/share/sangsoe", rule: "Read(//{HOME}/.local/share/sangsoe/**)" },
];
