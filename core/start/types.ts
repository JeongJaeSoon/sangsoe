import type { OrcaAdapter } from "../contract/orca.ts";
import type { AdvisorRoute, Choice, WorktreeSettings } from "../models/index.ts";
import type { Store } from "../store/store.ts";

export type Role = "orchestrator" | "lead" | "worker";

/**
 * The session asking for a start. The role is declared by the caller (MCP tool, CLI); the start
 * function checks it against what Orca says: an orchestrator has no Dispatch, a lead or worker has
 * one, and a lead's sits at depth 1.
 */
export type Requester = {
  role: Role;
  /**
   * The requester's own worktree: the new worktree is created as its child. Only an orchestrator
   * running in no Orca worktree (a plain folder or a folder context) leaves it out (decision 197).
   */
  worktreeId?: string;
  /** The requester's own Task; required for a lead or worker, absent for the orchestrator. */
  taskId?: string;
  /** The Run the Task lives in: the requester's own. */
  runId: string;
};

export type NewTask = {
  spec: string;
  title?: string;
  deps?: string[];
  /** Late answers (decision 91 ④(i)): appended to the first prompt, once. */
  lateAnswers?: string[];
};

export type StartRequest = {
  requester: Requester;
  childRole: "lead" | "worker";
  task: { id: string } | NewTask;
  agent: string;
  /** Orca's nested-worker depth setting when one was read; undefined means unread (decision 59). */
  maxDepth?: number;
  /** `티켓:` URLs attached to the new worktree with `reference add` (decision 93 (마)); failure does not stop the start. */
  references?: string[];
  /** From `resolveModel` (decision 164); absent means the child role's own row. */
  model?: Choice;
  /** How the caller picked `model`'s row, recorded on `unit_started` (decision 200); default role. */
  pickedBy?: "kind" | "class" | "role";
  /**
   * The Orca repo selector (`id:`, `name:` or `path:`) the new worktree goes in; absent means the
   * requester's own repo. Required when the requester names no worktree (decision 197).
   */
  repo?: string;
};

/** Orca's repo selector forms that `worker-start --repo` takes. */
export const REPO_SELECTOR = /^(id|name|path):\S/;

export const REFUSAL_REASONS = [
  "capability_missing",
  "lineage_invalid",
  "depth_exceeded",
  "orca_error",
  "no_dispatch",
  "model_invalid",
] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

export type StartRefusal = {
  kind: "refused";
  reason: RefusalReason;
  detail: string;
  taskId?: string;
  /** Who the escalation went to: the parent's terminal handle, "owner" for the orchestrator (an `escalation` row), or null when the parent is unknown. */
  escalatedTo: string | null;
};

export type StartOutcome =
  | {
      kind: "started";
      taskId: string;
      /** The iNNN alias of a Task this call created; decisions name it as `item:iNNN` (decision 197). */
      alias?: string;
      dispatchId: string;
      worktreeId?: string;
      launch: { model: string; effort: string; advisor?: string; route: AdvisorRoute };
      notes: string[];
    }
  /** Not a refusal (decision 94): the Task stays as it is and the caller tries again later. */
  | { kind: "waiting"; taskId: string; why: "not_ready" | "already_dispatched" | "no_capacity"; detail: string }
  /** T5: three failed starts on one Task; worker-start is not called again. */
  | { kind: "stopped"; taskId: string; why: "start_failed_3x" }
  | StartRefusal;

export type StartPorts = {
  orca: OrcaAdapter;
  store: Pick<Store, "append" | "events" | "allocate">;
  /** Free worker slots now (core/capacity). Throws when they cannot be read: that is not "no room". */
  slots: () => number | Promise<number>;
  /** The `source` written on events. */
  source?: string;
  /**
   * The calling session's working directory; the declared worktree must contain it. The core runs
   * as a child of that session (MCP server or CLI), so this is not the caller's word. Default process.cwd().
   */
  cwd?: () => string;
  /** Whether the owner's settings name an advisor (key presence only). Default reads the user settings. */
  advisorSetting?: () => boolean;
  /** Writes the new worktree's local settings before its session starts (decision 200); throws when it cannot. */
  writeSettings?: (worktreePath: string, s: WorktreeSettings) => void;
};
