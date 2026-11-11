// The Orca side of the core contract: row shapes the adapter returns and the adapter interface
// every later unit calls. The adapter (core/orca/) is the only code that runs `orca`.
// Field lists are the subset the core reads; Orca sends more and the adapter passes it through.

/** One external command run. The real one is core/orca/exec.ts; tests pass test/fake-orca/. */
export type ExecResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Set when the process never produced an exit code we can trust. */
  failure?: "timeout" | "spawn";
};
export type Exec = (file: string, args: readonly string[]) => Promise<ExecResult>;

export type OrcaError = {
  /** Orca's own error code, or `response_lost` when no JSON envelope came back. */
  code: string;
  message: string;
  data?: unknown;
};

/**
 * Every wrapper returns this. `requestId` is whatever request id Orca reported for a write
 * (decision 60): keep it, and after `response_lost` hand it to `recoverWrite`.
 */
export type OrcaResult<T> =
  | { ok: true; value: T; requestId?: string }
  | { ok: false; error: OrcaError; requestId?: string };

/**
 * Options every write wrapper takes. Set only by `recoverWrite`, never on a first call.
 * `worktree rm` and `reference add` have no `--retry-request` in Orca:
 * after their `response_lost`, re-read the state they change instead of sending again.
 */
export type WriteOptions = { retryRequest?: string };

/**
 * Rows that carry a host. Only `hostId == "local"` rows come back (decision 88 ①); rows of
 * other hosts never leave the adapter, only their count does, for the start-check warning.
 */
export type LocalRows<T> = {
  rows: T[];
  /** `ids` only where the reader needs a non-local row by name (REAPER's `remote_host`, decision 88 ①). */
  nonLocal: { rows: number; hostIds: string[]; ids?: string[] };
  omittedHostIds: string[];
  /** More rows exist than this page holds. */
  truncated: boolean;
  /** Pass back as `cursor` for the next page (worker-list). */
  nextCursor?: string;
};

export type WorktreeRow = {
  /** `<repoId>::<path>`; `worktree rm --worktree id:<id>` selects the row by it. */
  id: string;
  /** The path-free id sqlite keeps for a card (a worktree `ref` may not hold a path). */
  instanceId?: string;
  head?: string;
  hostId?: string;
  repoId: string;
  /** `github:<owner>/<repo>` when the checkout's origin is on GitHub. */
  projectId?: string;
  path: string;
  branch: string;
  displayName: string;
  isMainWorktree: boolean;
  isArchived: boolean;
  parentWorktreeId: string | null;
  childWorktreeIds: string[];
  lastActivityAt: number;
  workspaceStatus?: string;
};

export type AgentWait = { state?: string; [key: string]: unknown } | null;

export type WorktreePsAgent = {
  paneKey: string;
  state: string;
  agentType: string;
  stateStartedAt?: number;
  agentWait?: AgentWait;
};

/** `terminal list --worktree` (measured 2026-11-11): an agent's terminal names its `agentIdentity`. */
export type TerminalRow = {
  handle: string;
  worktreeId?: string;
  executionHostId?: string;
  agentIdentity?: string;
};

export type WorktreePsRow = {
  worktreeId: string;
  hostId?: string;
  repo: string;
  path: string;
  branch: string;
  isMainWorktree: boolean;
  isArchived: boolean;
  liveTerminalCount: number;
  unverifiableTerminalCount: number;
  lastOutputAt?: number;
  status: string;
  terminalVerdict?: string;
  agents: WorktreePsAgent[];
};

export type HostRow = {
  kind: "local" | "ssh" | "environment" | string;
  id: string;
  name?: string;
  selector?: string;
  platform?: string;
  connected?: boolean;
};

export type OrcaStatus = {
  app: { running: boolean };
  runtime: {
    state: string;
    reachable: boolean;
    appVersion?: string;
    capabilities: string[];
  };
  caller?: { orcaSessionId?: string };
};

export type AgentHookStatus = {
  agent: string;
  state: string;
  managedHooksPresent: boolean;
  detail: string | null;
};
export type AgentHooksStatus = { enabled: boolean; statuses: AgentHookStatus[] };

export type OrcaPluginRow = {
  pluginKey: string;
  name: string;
  version: string;
  consentFingerprint: string;
  status: string;
  isDev: boolean;
  needsReconsent: boolean;
};

export type CommandSchema = { command: string; path: string[]; flags: string[] };
export type AgentContext = { schemaVersion: number; commands: CommandSchema[] };

export type TaskRow = {
  id: string;
  status: string;
  title: string;
  dispatchId?: string;
  assignee?: string;
  /** Only with `task-list --full`: `cancelled` on a `failed` Task is a cancellation (appendix #schema). */
  result?: string;
};

export type GateRow = {
  id: string;
  taskId?: string;
  status: string;
  question?: string;
  /** Orca sends a JSON array as text; the adapter parses it. Absent when Orca sent none or it did not parse. */
  options?: string[];
  resolution?: string | null;
};

/** The ids and stop reason Orca attaches to a message; only these are read. */
export type InboxPayload = {
  taskId?: string;
  dispatchId?: string;
  /** Orca's own stop escalations: `finished`, `errored`, `needs-input`. */
  stopReason?: string;
};

/**
 * One message as the adapter hands it on. `inbox --full` names the fields `from_handle`,
 * `to_handle` and `read` and sends `payload` as JSON text; the adapter maps them to these.
 */
export type InboxMessage = {
  id: string;
  type: string;
  from: string;
  to: string;
  subject: string;
  handled: boolean;
  body?: string;
  payload?: InboxPayload;
};

export type WorkerRow = {
  dispatchId: string;
  taskId: string;
  state: string;
  outcome?: string;
  liveness?: string;
  agent?: string;
  terminal?: string;
  terminalState?: string;
  workspace?: string;
  /** worker-list names the host `host`, not `hostId`; the same local filter applies. */
  host?: string;
};

export type WorkerShow = {
  dispatchId: string;
  taskId: string;
  runId: string;
  state: string;
  stage?: string;
  liveness?: string;
  terminal?: string;
  terminalState?: string;
  workspace?: string;
};

export type DispatchRow = {
  id: string;
  run_id: string;
  task_id: string;
  status: string;
  depth: number;
  failure_count: number;
  dispatched_at: string | null;
  completed_at: string | null;
};

/** `coordinatorHandle`: the terminal bound to the Run (`run-show --full`'s `run.coordinator_handle`). */
export type RunShow = { runId: string; objective: string; coordinatorHandle?: string };
export type RunCurrent = { runId: string | null };

export type RequestShow = {
  requestId: string;
  state: "completed" | "pending" | "absent";
  interpretation?: string;
};

/** One listener `orca ports --worktree` tied to the worktree; `owner` is absent when Orca tied it to none. */
export type PortRow = {
  id: string;
  port: number;
  pid?: number;
  processName?: string;
  bindHost?: string;
  protocol?: string;
  kind?: string;
  owner?: { worktreeId?: string; path?: string; confidence?: string };
};

/** The receipt shape of a write is Orca's; the core reads ids from it and keeps the rest opaque. */
export type Receipt = Record<string, unknown>;

/** `new-top-level` only for an orchestrator in no Orca worktree, with `repo` (decision 197). */
export type WorkerPlacement = "current" | "new-child" | "new-top-level" | { existing: string };

/**
 * The only path from the core to Orca (design §2, first-slot table). Not here on purpose:
 * a consuming mail read (decision 60: scripts read mail with `inbox`), the fallback start
 * (owner d125), `dispatch`, `automations`, and anything else the table marks "쓰지 않음".
 */
export interface OrcaAdapter {
  // Runtime and host
  status(): Promise<OrcaResult<OrcaStatus>>;
  hostList(): Promise<OrcaResult<HostRow[]>>;
  agentHooksStatus(): Promise<OrcaResult<AgentHooksStatus>>;
  agentContext(): Promise<OrcaResult<AgentContext>>;
  diagnosticsMemory(): Promise<OrcaResult<Receipt>>;

  // Task
  taskCreate(
    a: { spec: string; title?: string; deps?: string[]; parent?: string; run?: string },
    o?: WriteOptions,
  ): Promise<OrcaResult<Receipt>>;
  /** `full` adds each Task's spec and result; the result separates cancelled from failed. */
  taskList(a: { run: string; status?: string; ready?: boolean; full?: boolean }): Promise<OrcaResult<TaskRow[]>>;
  taskUpdate(
    a: { id: string; status: string; result?: string; run?: string },
    o?: WriteOptions,
  ): Promise<OrcaResult<Receipt>>;

  // Run (`run-create`·`run-use` are the sessions' own verbs, decision 193)
  runCurrent(): Promise<OrcaResult<RunCurrent>>;
  runShow(a: { id: string }): Promise<OrcaResult<RunShow>>;

  // Gate
  gateCreate(
    a: { task: string; question: string; options?: string[] },
    o?: WriteOptions,
  ): Promise<OrcaResult<Receipt>>;
  gateResolve(a: { id: string; resolution: string }, o?: WriteOptions): Promise<OrcaResult<Receipt>>;
  gateList(a: { run: string; task?: string; status?: string }): Promise<OrcaResult<GateRow[]>>;

  // Message (reads go through `inbox`, which never marks mail handled; `ask`·`reply` are the sessions' own verbs)
  send(
    a: {
      to: string;
      subject: string;
      body?: string;
      type?: string;
      from?: string;
      taskId?: string;
      dispatchId?: string;
      outcome?: "succeeded" | "failed";
    },
    o?: WriteOptions,
  ): Promise<OrcaResult<Receipt>>;
  inbox(a: { terminal?: string; limit: number }): Promise<OrcaResult<InboxMessage[]>>;

  // Worker and Dispatch (`worker-release` is the orchestrator's own verb for a kept-open lead, decision 193)
  workerStart(
    /**
     * `advisor` is sent only when Orca's agent-context lists it on worker-start (decision 187).
     * `keepOpen` keeps the terminal after `worker_done`; `repo` is an Orca repo selector for a new worktree.
     */
    a: {
      task: string;
      agent: string;
      worktree: WorkerPlacement;
      run?: string;
      model?: string;
      effort?: string;
      advisor?: string;
      keepOpen?: boolean;
      repo?: string;
    },
    o?: WriteOptions,
  ): Promise<OrcaResult<Receipt>>;
  workerShow(a: { dispatch: string }): Promise<OrcaResult<WorkerShow>>;
  workerList(a: { run?: string; limit?: number; cursor?: string }): Promise<OrcaResult<LocalRows<WorkerRow>>>;
  dispatchShow(a: { task: string }): Promise<OrcaResult<DispatchRow>>;
  requestShow(a: { request: string }): Promise<OrcaResult<RequestShow>>;

  // Worktree (cards)
  worktreeList(a: { repo?: string; limit?: number }): Promise<OrcaResult<LocalRows<WorktreeRow>>>;
  worktreePs(a: { limit?: number; agentWait?: boolean }): Promise<OrcaResult<LocalRows<WorktreePsRow>>>;
  /** Always `--run-hooks --delete-branch`, never `--force` (decision 86). */
  worktreeRm(a: { worktree: string }): Promise<OrcaResult<Receipt>>;
  /**
   * A worktree with no agent yet (decisions 200, 202): start_unit writes its local settings, then
   * starts the worker in it. `parent` keeps new-child's lineage; without it Orca records none.
   */
  worktreeCreate(a: { name: string; parent?: string; repo?: string }): Promise<OrcaResult<{ id: string; path: string; repoId?: string }>>;
  /** Live terminals of one worktree; an agent's carries `agentIdentity`, the plain shell create opens does not. */
  terminalList(a: { worktree: string }): Promise<OrcaResult<LocalRows<TerminalRow>>>;
  /** One terminal by its handle, never `--all` (decision 202): only a handle start_unit recorded. */
  terminalClose(a: { terminal: string }): Promise<OrcaResult<Receipt>>;
  /** The repo's setup script as Orca holds it (`hookSettings.scripts.setup`); "" when none. */
  repoShow(a: { repo: string }): Promise<OrcaResult<{ setup: string }>>;
  /** Listeners tied to one worktree; `non_local_host` when Orca scanned another host (decision 88). */
  ports(a: { worktree: string }): Promise<OrcaResult<PortRow[]>>;

  // Reference
  referenceAdd(a: { worktree: string; urls: string[] }): Promise<OrcaResult<Receipt>>;
  referenceFind(a: { query: string; limit?: number }): Promise<OrcaResult<Receipt>>;

  // Plugin
  pluginList(): Promise<OrcaResult<OrcaPluginRow[]>>;
  pluginInspect(a: { dir: string }): Promise<OrcaResult<Receipt>>;
  // Turning a plugin on is `sangsoe plugin approve`'s alone (core/approve/, decision 77): no wrapper here.
}
