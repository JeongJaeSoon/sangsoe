import { realpathSync } from "node:fs";
import type { OrcaAdapter } from "../contract/orca.ts";
import { settled } from "../recover/recover.ts";
import { ROLE_LINE_PREFIX } from "../start/start.ts";
import type { Role } from "../start/types.ts";

const ROLES: readonly Role[] = ["orchestrator", "lead", "worker"];

/**
 * The role U10's startUnit wrote as the spec's first line (`sangsoe-role: <role>`). Read from the Task
 * spec, where Orca keeps it; undefined when the first line is anything else.
 */
export function readRoleLine(spec: string | undefined): Role | undefined {
  const first = spec?.split("\n", 1)[0]?.trim() ?? "";
  if (!first.startsWith(ROLE_LINE_PREFIX)) return undefined;
  const role = first.slice(ROLE_LINE_PREFIX.length).trim();
  return (ROLES as readonly string[]).includes(role) ? (role as Role) : undefined;
}

/** `--agent sangsoe:<role>` names the role without a Task (an orchestrator the owner opened). */
export function agentRole(agentType: string | undefined): Role | undefined {
  const m = /^sangsoe:(orchestrator|lead|worker)$/.exec(agentType ?? "");
  return m ? (m[1] as Role) : undefined;
}

export interface Located {
  readonly worktree: string;
  readonly dispatch: string;
  readonly task: string;
  /** The Run the Task lives in: its owning lead's (or the orchestrator's) Run. */
  readonly run: string;
  readonly spec: string | undefined;
}

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
const within = (dir: string, root: string) => dir === root || dir.startsWith(`${root.replace(/\/+$/, "")}/`);

const MAX_PAGES = 10;

/**
 * The Dispatch working in cwd's worktree, read from Orca alone (no copy in sqlite): the worktree whose
 * path holds cwd, its unsettled Dispatch, that Dispatch's Run, and the Task's spec. undefined when any
 * read fails or nothing matches: the caller then does nothing.
 */
export async function locate(orca: OrcaAdapter, cwd: string): Promise<Located | undefined> {
  if (!cwd) return undefined;
  const here = real(cwd);
  const trees = await orca.worktreeList({ limit: 500 });
  if (!trees.ok) return undefined;
  const tree = trees.value.rows
    .filter((t) => !t.isMainWorktree && within(here, real(t.path)))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!tree) return undefined;
  let cursor: string | undefined;
  let dispatch: string | undefined;
  for (let page = 0; page < MAX_PAGES && !dispatch; page++) {
    const r = await orca.workerList({ limit: 100, ...(cursor ? { cursor } : {}) });
    if (!r.ok) return undefined;
    dispatch = r.value.rows.find((w) => w.workspace === tree.id && !settled(w))?.dispatchId;
    cursor = r.value.nextCursor;
    if (!cursor) break;
  }
  if (!dispatch) return undefined;
  const shown = await orca.workerShow({ dispatch });
  if (!shown.ok || !shown.value.taskId || !shown.value.runId) return undefined;
  const { taskId: task, runId: run } = shown.value;
  const tasks = await orca.taskList({ run, full: true });
  if (!tasks.ok) return undefined;
  const row = tasks.value.find((t) => t.id === task) as { spec?: unknown } | undefined;
  return { worktree: tree.id, dispatch, task, run, spec: typeof row?.spec === "string" ? row.spec : undefined };
}
