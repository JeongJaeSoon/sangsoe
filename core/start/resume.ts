import type { OrcaAdapter, Receipt, TaskRow } from "../contract/orca.ts";
import { settled } from "../recover/recover.ts";
import type { RefusalReason, ResumeTarget, StartOutcome, StartPorts, StartRefusal } from "./types.ts";

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResumeContext = {
  orca: OrcaAdapter;
  store: StartPorts["store"];
  source: string;
  taskId: string;
  /** The requester's Run, where the Task must live. */
  run: string;
  childRole: "lead" | "worker";
  target: ResumeTarget;
  /** The spec's role line as start_unit reads it. */
  specRole: (spec: unknown) => { first: string; role: string };
  /** The Dispatch id in a worker-start receipt, read as a first start reads it. */
  dispatchOf: (receipt: Receipt) => string | undefined;
  refuse: (reason: RefusalReason, detail: string) => Promise<StartRefusal>;
  /** A refusal that counts toward T5, as a failed worker-start does. */
  failed: (reason: RefusalReason, detail: string) => Promise<StartRefusal>;
};

/**
 * Decision 322: the session someone re-opened with `claude --resume` in a new terminal goes back on
 * its own Task. Everything that can refuse is read before anything changes; then the old Dispatch is
 * abandoned (Orca's fence for a session it cannot see), the Task reopened, and the terminal bound with
 * `worker-start --terminal`. A second call after a partial one finds the old Dispatch settled and goes on.
 */
export async function resumeUnit(c: ResumeContext): Promise<StartOutcome> {
  const { orca, store, taskId, target } = c;
  const tree = target.worktreeId;
  const no = (detail: string) => c.refuse("lineage_invalid", detail);

  if (!SESSION_ID.test(target.sessionId)) return no(`세션 id "${target.sessionId.slice(0, 60)}" 가 Claude Code 세션 id 꼴이 아니다`);

  const listed = await orca.taskList({ run: c.run, full: true });
  if (!listed.ok) return c.refuse("orca_error", `task-list 실패 (${listed.error.code})`);
  const task = listed.value.find((t) => t.id === taskId) as (TaskRow & { spec?: unknown }) | undefined;
  if (!task) return no(`Task ${taskId} 가 요청자의 Run(${c.run})에 없다`);
  if (task.status === "completed") return no(`Task ${taskId} 는 끝났다(completed): 이어 갈 세션이 없다`);
  const { first, role } = c.specRole(task.spec);
  if (role !== c.childRole) return no(`Task ${taskId} 의 spec 첫 줄이 "${first.slice(0, 60)}" 라 ${c.childRole} 로 이어 가지 않는다`);

  // The Task's worktree is the one start_unit made for it, and Orca's old worker must agree.
  const own = store.events({ type: "unit_started" }).filter((e) => e.entity_id === taskId).at(-1)?.payload.worktree;
  if (own !== tree) return no(`worktree ${tree} 는 Task ${taskId} 의 worktree${own ? `(${own})` : ""} 가 아니다`);
  const seen = store.events({ type: "session_started" }).filter((e) => e.payload.session === target.sessionId);
  const elsewhere = seen.find((e) => e.entity_id && e.entity_id !== taskId);
  if (elsewhere) return no(`세션 ${target.sessionId} 는 다른 Task(${elsewhere.entity_id})의 세션이다`);
  if (!seen.some((e) => e.entity_id === taskId)) return no(`세션 ${target.sessionId} 가 Task ${taskId} 의 세션으로 기록된 적이 없다`);

  const d = await orca.dispatchShow({ task: taskId });
  if (!d.ok || typeof d.value.id !== "string") return no(`Task ${taskId} 의 옛 Dispatch 를 읽지 못했다 (${d.ok ? "id 없음" : d.error.code})`);
  const from = d.value.id;
  const old = await orca.workerShow({ dispatch: from });
  if (!old.ok) return no(`옛 Dispatch ${from} 의 워커를 읽지 못했다 (${old.error.code})`);
  if (old.value.workspace !== tree) return no(`옛 Dispatch ${from} 의 worktree(${old.value.workspace ?? "없음"})가 ${tree} 가 아니다`);
  const wasSettled = settled(old.value);
  if (!wasSettled && old.value.liveness === "live") return no(`옛 Dispatch ${from} 의 세션이 아직 살아 있다(liveness live): 같은 세션을 두 터미널에 두지 않는다`);

  const terms = await orca.terminalList({ worktree: `id:${tree}` });
  if (!terms.ok || terms.value.truncated || terms.value.nonLocal.rows > 0) return no(`worktree ${tree} 의 터미널을 다 읽지 못했다`);
  if (!terms.value.rows.some((t) => t.handle === target.terminal)) return no(`터미널 ${target.terminal} 이 worktree ${tree} 에 없다`);

  const notes: string[] = [];
  if (!wasSettled) {
    const fenced = await orca.workerAbandon({ dispatch: from });
    if (!fenced.ok) return c.refuse("orca_error", `옛 Dispatch ${from} 를 abandon 하지 못했다 (${fenced.error.code}): 아무것도 바꾸지 않았다`);
    const after = await orca.workerShow({ dispatch: from });
    if (!after.ok || !settled(after.value)) return c.refuse("orca_error", `옛 Dispatch ${from} 가 abandon 뒤에도 끝나지 않았다 (${after.ok ? after.value.state : after.error.code})`);
    notes.push(`abandon: ${from}`);
  }
  const left = `옛 Dispatch ${from} 는 abandon 되었다. 터미널 ${target.terminal} 은 그대로 둔다`;
  const now = await orca.taskList({ run: c.run });
  const status = now.ok ? now.value.find((t) => t.id === taskId)?.status : undefined;
  if (status !== "ready") {
    const reopened = await orca.taskUpdate({ id: taskId, status: "ready", run: c.run });
    if (!reopened.ok) return c.refuse("orca_error", `Task ${taskId} 를 ready 로 되돌리지 못했다 (${reopened.error.code}). ${left}`);
  }

  // No agent, model or effort: Orca takes none of them with --terminal, and the session keeps its own.
  const started = await orca.workerStart({ task: taskId, worktree: { existing: `id:${tree}` }, run: c.run, terminal: target.terminal });
  if (!started.ok) {
    return c.failed("orca_error", `worker-start --terminal 실패 (${started.error.code}: ${started.error.message}). ${left}, Task 는 ready 라 resume 없는 start_unit 으로도 시작할 수 있다`);
  }
  let dispatch = c.dispatchOf(started.value);
  if (!dispatch) {
    const shown = await orca.dispatchShow({ task: taskId });
    if (shown.ok && typeof shown.value.id === "string" && shown.value.id !== from) dispatch = shown.value.id;
  }
  if (!dispatch) return c.failed("no_dispatch", `worker-start --terminal 은 끝났지만 새 Dispatch 가 없다. ${left}`);

  store.append({
    type: "unit_resumed",
    source: c.source,
    entity: "task",
    entity_id: taskId,
    payload: { dispatch, from, session: target.sessionId, terminal: target.terminal, worktree: tree, run: c.run },
  });
  return { kind: "resumed", taskId, dispatchId: dispatch, from, worktreeId: tree, terminal: target.terminal, notes };
}
