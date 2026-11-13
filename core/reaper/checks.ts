import { existsSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import type { StoredEvent } from "../contract/index.ts";
import type { Exec, OrcaAdapter, TaskRow, WorkerRow, WorktreeRow } from "../contract/orca.ts";
import { isClosedTask } from "../detect/pr/judge.ts";
import type { GhClient } from "../gh/client.ts";
import { branchOf, type Finished, repoOf } from "./finished.ts";

export type BlockReason =
  | "uncommitted"
  | "unpushed"
  | "unpushed_other_patch"
  | "task_open"
  | "session_alive"
  | "evidence_in_worktree"
  | "listener"
  | "compose_running"
  | "docker_unreachable";
export type Check = { ok: true } | { ok: false; blocked: BlockReason } | { ok: false; unknown: string };

const OK: Check = { ok: true };
const ENDED = new Set(["gone", "exited"]);

/** Whether `path` is `root` or under it; `/a/u5` is not under `/a/u53`. */
export function inside(root: string, path: string): boolean {
  const r = resolve(root);
  const p = resolve(path);
  return p === r || p.startsWith(r.endsWith(sep) ? r : r + sep);
}

/**
 * Decision 194 ①, read fresh each time it is asked: a Dispatch that ran in the card whose session
 * Orca still calls live, or whose Task is not closed. The Task's Run comes from `worker-show`
 * (`task-list` needs `--run`); each Run is listed once. The round uses it as the open-Task root
 * (decision 177) and again just before the removal.
 */
export async function openWork(
  card: Pick<WorktreeRow, "id">,
  workers: readonly WorkerRow[],
  orca: Pick<OrcaAdapter, "workerShow" | "taskList">,
): Promise<Check> {
  const runs = new Map<string, TaskRow[]>();
  const asked = new Set<string>();
  for (const w of workers) {
    if (w.workspace !== card.id) continue;
    const show = await orca.workerShow({ dispatch: w.dispatchId });
    if (!show.ok) return { ok: false, unknown: `worker-show ${w.dispatchId}: ${show.error.code}` };
    if (show.value.liveness === "live") return { ok: false, blocked: "session_alive" };
    // `unverifiable` or no answer is Orca not knowing; only a session it calls ended lets the card go.
    if (!ENDED.has(show.value.liveness ?? "")) {
      return { ok: false, unknown: `worker-show ${w.dispatchId}: liveness ${show.value.liveness ?? "missing"}` };
    }
    const { taskId, runId } = show.value;
    if (asked.has(taskId)) continue;
    asked.add(taskId);
    if (!runId) return { ok: false, unknown: `worker-show ${w.dispatchId}: no Run` };
    let tasks = runs.get(runId);
    if (!tasks) {
      const l = await orca.taskList({ run: runId });
      if (!l.ok) return { ok: false, unknown: `task-list ${runId}: ${l.error.code}` };
      tasks = l.value;
      runs.set(runId, tasks);
    }
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return { ok: false, unknown: `task ${taskId} not in ${runId}` };
    if (!isClosedTask(t.status)) return { ok: false, blocked: "task_open" };
  }
  return OK;
}

/**
 * Decision 194 ②: an `evidence` row says where its file is; a file still inside the card would go
 * with it. Only the newest row per PR, head and kind counts, so recording the moved file clears the
 * block, and a file no longer at that path has nothing left to lose. A newer row without a path does
 * not clear an older file. A relative path is read against the card only when the row is the card's
 * own PR, which is a guess: the recorder is not the PR's author and may have meant its own checkout.
 */
export function evidenceInWorktree(
  card: Pick<WorktreeRow, "path" | "projectId">,
  finished: Extract<Finished, { state: "finished" }>,
  events: readonly StoredEvent[],
  exists: (path: string) => boolean = existsSync,
): Check {
  const repo = repoOf(card);
  const own = repo && finished.pr ? `${repo.toLowerCase()}#${finished.pr.number}` : null;
  const newest = new Map<string, { subject: string | null; path: string }>();
  for (const e of events) {
    const p = e.payload as { kind?: string; head_sha?: string; path?: string };
    const k = `${e.subject}\n${p.head_sha}\n${p.kind}`;
    if (typeof p.path === "string") newest.set(k, { subject: e.subject, path: p.path });
  }
  for (const { subject, path } of newest.values()) {
    const at = isAbsolute(path) ? path : subject === own ? join(card.path, path) : null;
    if (at && inside(card.path, at) && exists(at)) return { ok: false, blocked: "evidence_in_worktree" };
  }
  return OK;
}

/**
 * Decision 82 R4, the last gate before `worktree rm`: no uncommitted change (untracked files
 * included; git already leaves ignored ones out), and no commit only this machine has. "On the
 * remote" is asked of GitHub, never read from a local default branch that may be stale.
 */
export async function preDelete(
  card: WorktreeRow,
  finished: Extract<Finished, { state: "finished" }>,
  exec: Exec,
  gh: GhClient,
  checkoutGone = false,
): Promise<Check> {
  if (!checkoutGone) {
    const status = await exec("git", ["-C", card.path, "status", "--porcelain=v1", "--untracked-files=all"]);
    if (status.code !== 0) return { ok: false, unknown: "git status failed" };
    if (status.stdout.trim() !== "") return { ok: false, blocked: "uncommitted" };
  }

  // A squash merge leaves the card's own commits off every remote branch; the PR carrying HEAD is the proof.
  if (finished.carried) return OK;

  const repo = repoOf(card);
  const head = card.head;
  // With no checkout and no HEAD there is nothing left to read; Orca keeps a branch with unpushed commits (P6).
  if (checkoutGone && !head) return OK;
  if (!repo || !head) return { ok: false, unknown: "no repository or HEAD" };
  const known = await gh.get(`repos/${repo}/commits/${head}`);
  if (known.kind === "ok") return OK;
  if (known.kind !== "error" || (known.status !== 404 && known.status !== 422)) {
    return { ok: false, unknown: `commit lookup: ${known.kind}` };
  }
  if (checkoutGone) return { ok: false, blocked: "unpushed" };
  // Never pushed. Same message at the branch tip on GitHub but another sha: amended or rebased after the push.
  const local = await exec("git", ["-C", card.path, "log", "-1", "--format=%B", head]);
  const tip = await gh.get<{ commit?: { message?: string } }>(
    `repos/${repo}/commits/${encodeURIComponent(branchOf(card))}`,
  );
  const sameMessage =
    local.code === 0 && tip.kind === "ok" && (tip.data?.commit?.message ?? "").trim() === local.stdout.trim();
  return { ok: false, blocked: sameMessage ? "unpushed_other_patch" : "unpushed" };
}
