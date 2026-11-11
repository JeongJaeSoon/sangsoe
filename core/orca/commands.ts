import type { OrcaAdapter } from "../contract/orca.ts";

export type CommandSpec = {
  /** The words after `orca`. */
  path: readonly string[];
  /** Every flag the wrapper may pass, without `--`; `json` is always passed. */
  flags: readonly string[];
  /**
   * Flags a caller passes only after `orca agent-context --json` lists them; the `orca-commands`
   * check does not require them (decision 187: `--advisor`, which no Orca has yet).
   */
  optional?: readonly string[];
  /** A write whose lost response is recovered through `request-show` (decision 60). */
  write?: true;
};

/**
 * One row per adapter method: the wrappers build argv from it and the `orca-commands` start
 * check matches it against `orca agent-context --json` (decision 63), so a flag the installed
 * Orca dropped is caught before a wrapper uses it.
 */
export const ORCA_COMMANDS = {
  status: { path: ["status"], flags: ["json"] },
  hostList: { path: ["host", "list"], flags: ["json"] },
  agentHooksStatus: { path: ["agent", "hooks", "status"], flags: ["json"] },
  agentContext: { path: ["agent-context"], flags: ["json"] },
  diagnosticsMemory: { path: ["diagnostics", "memory"], flags: ["json"] },

  taskCreate: {
    path: ["orchestration", "task-create"],
    flags: ["json", "spec", "task-title", "deps", "parent", "run", "retry-request"],
    write: true,
  },
  taskList: { path: ["orchestration", "task-list"], flags: ["json", "run", "status", "ready", "full"] },
  taskUpdate: {
    path: ["orchestration", "task-update"],
    flags: ["json", "id", "status", "result", "run", "retry-request"],
    write: true,
  },

  runCurrent: { path: ["orchestration", "run-current"], flags: ["json"] },
  runShow: { path: ["orchestration", "run-show"], flags: ["json", "id", "full"] },

  gateCreate: {
    path: ["orchestration", "gate-create"],
    flags: ["json", "task", "question", "options", "retry-request"],
    write: true,
  },
  gateResolve: {
    path: ["orchestration", "gate-resolve"],
    flags: ["json", "id", "resolution", "retry-request"],
    write: true,
  },
  gateList: { path: ["orchestration", "gate-list"], flags: ["json", "run", "task", "status"] },

  send: {
    path: ["orchestration", "send"],
    flags: ["json", "to", "subject", "body", "type", "from", "task-id", "dispatch-id", "outcome", "retry-request"],
    write: true,
  },
  inbox: { path: ["orchestration", "inbox"], flags: ["json", "terminal", "limit", "full"] },

  workerStart: {
    path: ["orchestration", "worker-start"],
    flags: ["json", "task", "agent", "worktree", "run", "model", "effort", "keep-open", "repo", "retry-request"],
    optional: ["advisor"],
    write: true,
  },
  workerShow: { path: ["orchestration", "worker-show"], flags: ["json", "dispatch"] },
  workerList: { path: ["orchestration", "worker-list"], flags: ["json", "run", "limit", "cursor"] },
  dispatchShow: { path: ["orchestration", "dispatch-show"], flags: ["json", "task"] },
  requestShow: { path: ["orchestration", "request-show"], flags: ["json", "request"] },

  worktreeList: { path: ["worktree", "list"], flags: ["json", "repo", "limit"] },
  worktreePs: { path: ["worktree", "ps"], flags: ["json", "limit", "agent-wait"] },
  worktreeRm: { path: ["worktree", "rm"], flags: ["json", "worktree", "run-hooks", "delete-branch"] },
  terminalCloseAll: { path: ["terminal", "close"], flags: ["json", "worktree", "all"] },
  worktreeCreate: { path: ["worktree", "create"], flags: ["json", "name", "no-parent", "parent-worktree", "repo", "setup"] },
  ports: { path: ["ports"], flags: ["json", "worktree"] },

  referenceAdd: { path: ["reference", "add"], flags: ["json", "worktree"] },
  referenceFind: { path: ["reference", "find"], flags: ["json", "limit"] },

  pluginList: { path: ["plugin", "list"], flags: ["json"] },
  pluginInspect: { path: ["plugin", "inspect"], flags: ["json"] },
} as const satisfies Record<keyof OrcaAdapter, CommandSpec>;

export type CommandName = keyof typeof ORCA_COMMANDS;
