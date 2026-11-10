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

  runCreate: { path: ["orchestration", "run-create"], flags: ["json", "objective", "retry-request"], write: true },
  runUse: { path: ["orchestration", "run-use"], flags: ["json", "id", "retry-request"], write: true },
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
  ask: { path: ["orchestration", "ask"], flags: ["json", "question", "to", "options", "retry-request"], write: true },
  reply: { path: ["orchestration", "reply"], flags: ["json", "id", "body", "retry-request"], write: true },
  inbox: { path: ["orchestration", "inbox"], flags: ["json", "terminal", "limit", "full"] },

  workerStart: {
    path: ["orchestration", "worker-start"],
    flags: ["json", "task", "agent", "worktree", "run", "model", "effort", "retry-request"],
    optional: ["advisor"],
    write: true,
  },
  workerShow: { path: ["orchestration", "worker-show"], flags: ["json", "dispatch"] },
  workerList: { path: ["orchestration", "worker-list"], flags: ["json", "run", "limit", "cursor"] },
  workerRelease: {
    path: ["orchestration", "worker-release"],
    flags: ["json", "dispatch", "retry-request"],
    write: true,
  },
  dispatchShow: { path: ["orchestration", "dispatch-show"], flags: ["json", "task"] },
  requestShow: { path: ["orchestration", "request-show"], flags: ["json", "request"] },

  worktreeList: { path: ["worktree", "list"], flags: ["json", "repo", "limit"] },
  worktreePs: { path: ["worktree", "ps"], flags: ["json", "limit", "agent-wait"] },
  worktreeSet: {
    path: ["worktree", "set"],
    flags: ["json", "worktree", "display-name", "comment", "workspace-status"],
  },
  worktreeRm: { path: ["worktree", "rm"], flags: ["json", "worktree", "run-hooks", "delete-branch"] },

  referenceAdd: { path: ["reference", "add"], flags: ["json", "worktree"] },
  referenceList: { path: ["reference", "list"], flags: ["json", "worktree"] },
  referenceFind: { path: ["reference", "find"], flags: ["json", "limit"] },
  search: { path: ["search"], flags: ["json", "scope", "limit"] },
  terminalWaitIdle: { path: ["terminal", "wait"], flags: ["json", "terminal", "for", "timeout-ms"] },

  pluginList: { path: ["plugin", "list"], flags: ["json"] },
  pluginInspect: { path: ["plugin", "inspect"], flags: ["json"] },
} as const satisfies Record<keyof OrcaAdapter, CommandSpec>;

export type CommandName = keyof typeof ORCA_COMMANDS;
