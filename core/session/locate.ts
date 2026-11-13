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
 * The unsettled Dispatch on this worktree in one worker-list scope; null when a read failed. `bound`:
 * Orca read only the caller's bound Run, so a miss says nothing about the other Runs.
 */
async function dispatchIn(orca: OrcaAdapter, worktree: string, run?: string): Promise<{ hit: string | null | undefined; bound: boolean }> {
  let cursor: string | undefined;
  let bound = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await orca.workerList({ limit: 100, ...(run ? { run } : {}), ...(cursor ? { cursor } : {}) });
    if (!r.ok) return { hit: null, bound };
    bound ||= r.value.scopeSource === "bound";
    const hit = r.value.rows.find((w) => w.workspace === worktree && !settled(w))?.dispatchId;
    if (hit) return { hit, bound };
    cursor = r.value.nextCursor;
    if (!cursor) break;
  }
  return { hit: undefined, bound };
}

/**
 * Decision 232: Orca's path-free id of the innermost worktree holding cwd, only while Orca shows a live
 * terminal there; undefined when ps fails or nothing matches. The id is a reference, not a copy.
 */
export async function liveWorktree(orca: OrcaAdapter, cwd: string | undefined): Promise<string | undefined> {
  if (!cwd) return undefined;
  const ps = await orca.worktreePs({});
  // A partial list may hold an enclosing worktree and miss the session's own.
  if (!ps.ok || ps.value.truncated || ps.value.omittedHostIds.includes("local")) return undefined;
  const here = real(cwd);
  const tree = ps.value.rows.filter((t) => within(here, real(t.path))).sort((a, b) => b.path.length - a.path.length)[0];
  return tree && tree.liveTerminalCount > 0 ? tree.worktreeInstanceId : undefined;
}

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
  // Without --run, worker-list holds only the bound Run's Dispatches; a lead bound to its own Run is
  // dispatched in its parent's, so each Run is read in turn (decision 207). A list over every Run that
  // missed has already said there is none.
  const first = await dispatchIn(orca, tree.id);
  let dispatch = first.hit;
  let runCursor: string | undefined;
  for (let page = 0; page < MAX_PAGES && dispatch === undefined && first.bound; page++) {
    const runs = await orca.runList({ limit: 100, ...(runCursor ? { cursor: runCursor } : {}) });
    if (!runs.ok) return undefined;
    for (const r of runs.value.runs) {
      dispatch = (await dispatchIn(orca, tree.id, r.id)).hit;
      if (dispatch !== undefined) break;
    }
    runCursor = runs.value.nextCursor;
    if (!runCursor) break;
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
