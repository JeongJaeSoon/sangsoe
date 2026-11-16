import type { OrcaAdapter, OrcaResult, Receipt, TaskRow, WriteOptions } from "../contract/orca.ts";
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
  /** Decision 60's write: a lost response is replayed through request-show, as a first start's is. */
  write: (first: Promise<OrcaResult<Receipt>>, again: (o: WriteOptions) => Promise<OrcaResult<Receipt>>) => Promise<OrcaResult<Receipt>>;
  refuse: (reason: RefusalReason, detail: string) => Promise<StartRefusal>;
  /** A refusal that counts toward T5, as a failed worker-start does. */
  failed: (reason: RefusalReason, detail: string) => Promise<StartRefusal>;
};

/** Orca's own refusal is definite; a lost answer or an unparsed exit may still have taken effect (Orca's recovery guide). */
function unknownOutcome(r: OrcaResult<Receipt>): boolean {
  if (r.ok) return false;
  const code = r.error.code;
  return r.requestId !== undefined || ["response_lost", "request_absent", "unexpected_shape"].includes(code) || code.startsWith("exit_");
}

/**
 * Decision 322: the session someone re-opened with `claude --resume` in a new terminal goes back on
 * its own Task. Everything that can refuse is read before anything changes; then the old Dispatch is
 * abandoned (Orca's fence for a session it cannot see), the Task reopened, and the terminal bound with
 * `worker-start --terminal`. A second call after a partial one finds the old Dispatch settled and goes on;
 * one after a bind that went through finds the Task's Dispatch on this terminal and changes nothing.
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
  if (!wasSettled && old.value.terminal === target.terminal) {
    // The Task's Dispatch already holds this terminal: an earlier resume bound it, or the caller named the old one.
    const done = store.events({ type: "unit_resumed" }).findLast((e) => e.entity_id === taskId && e.payload.dispatch === from);
    if (done && done.payload.terminal === target.terminal && done.payload.session === target.sessionId) {
      return { kind: "resumed", taskId, dispatchId: from, from: String(done.payload.from), worktreeId: tree, terminal: target.terminal, notes: ["이미 묶였다"] };
    }
    // A bind whose answer was lost left only its intent row: this is that bind, so it is recorded now.
    const intent = store
      .events({ type: "signal" })
      .findLast((e) => e.entity_id === taskId && e.payload.kind === "resume_bind" && e.target === target.terminal && e.subject === target.sessionId);
    if (intent && typeof intent.payload.reason === "string" && intent.payload.reason !== from) {
      const before = intent.payload.reason;
      store.append({
        type: "unit_resumed",
        source: c.source,
        entity: "task",
        entity_id: taskId,
        payload: { dispatch: from, from: before, session: target.sessionId, terminal: target.terminal, worktree: tree, run: c.run },
      });
      return { kind: "resumed", taskId, dispatchId: from, from: before, worktreeId: tree, terminal: target.terminal, notes: ["이미 묶였다"] };
    }
    return no(`터미널 ${target.terminal} 은 Task ${taskId} 의 옛 Dispatch ${from} 가 쥔 것이다: resume 한 세션이 도는 새 터미널의 handle 을 준다`);
  }
  if (!wasSettled && old.value.liveness === "live") return no(`옛 Dispatch ${from} 의 세션이 아직 살아 있다(liveness live): 같은 세션을 두 터미널에 두지 않는다`);

  const terms = await orca.terminalList({ worktree: `id:${tree}` });
  if (!terms.ok || terms.value.truncated || terms.value.nonLocal.rows > 0) return no(`worktree ${tree} 의 터미널을 다 읽지 못했다`);
  if (!terms.value.rows.some((t) => t.handle === target.terminal)) return no(`터미널 ${target.terminal} 이 worktree ${tree} 에 없다`);

  const notes: string[] = [];
  if (!wasSettled) {
    const fenced = await c.write(orca.workerAbandon({ dispatch: from }), (o) => orca.workerAbandon({ dispatch: from }, o));
    if (!fenced.ok) {
      const what = unknownOutcome(fenced) ? "결과를 알 수 없다: worker-show 로 그 Dispatch 를 읽고 같은 resume 을 다시 부른다" : "아무것도 바꾸지 않았다";
      return c.refuse("orca_error", `옛 Dispatch ${from} 를 abandon 하지 못했다 (${fenced.error.code}): ${what}`);
    }
    const after = await orca.workerShow({ dispatch: from });
    if (!after.ok || !settled(after.value)) {
      return c.refuse("orca_error", `옛 Dispatch ${from} 를 abandon 했지만 끝난 것으로 읽히지 않는다 (${after.ok ? after.value.state : after.error.code}): Task 는 건드리지 않았다`);
    }
    notes.push(`abandon: ${from}`);
  }
  const left = `옛 Dispatch ${from} 는 abandon 되었다. 터미널 ${target.terminal} 은 그대로 둔다`;
  const now = await orca.taskList({ run: c.run });
  if (!now.ok) return c.refuse("orca_error", `Task ${taskId} 의 상태를 다시 읽지 못했다 (${now.error.code}). ${left}`);
  if (now.value.find((t) => t.id === taskId)?.status !== "ready") {
    const reopened = await orca.taskUpdate({ id: taskId, status: "ready", run: c.run });
    if (!reopened.ok) return c.refuse("orca_error", `Task ${taskId} 를 ready 로 되돌리지 못했다 (${reopened.error.code}). ${left}`);
  }

  // No agent, model or effort: Orca takes none of them with --terminal, and the session keeps its own.
  // --keep-open as on every start: in an existing worktree Orca would release the terminal at worker_done.
  const args = { task: taskId, worktree: { existing: `id:${tree}` }, run: c.run, terminal: target.terminal, keepOpen: true } as const;
  store.append({
    type: "signal",
    source: c.source,
    payload: { kind: "resume_bind", reason: from },
    subject: target.sessionId,
    entity: "task",
    entity_id: taskId,
    target: target.terminal,
  });
  const started = await c.write(orca.workerStart(args), (o) => orca.workerStart(args, o));
  if (!started.ok) {
    const next = unknownOutcome(started)
      ? "묶였는지 알 수 없다: 같은 resume 을 다시 부르면 이 터미널을 쥔 Dispatch 를 찾는다. resume 없는 start_unit 은 부르지 않는다"
      : "Task 는 ready 다";
    return c.failed("orca_error", `worker-start --terminal 실패 (${started.error.code}: ${started.error.message}). ${left}. ${next}`);
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
