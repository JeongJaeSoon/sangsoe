import { REQUIRED_CAPABILITIES } from "../checks/orca-capabilities.ts";
import type { OrcaAdapter, OrcaResult, Receipt, WriteOptions } from "../contract/orca.ts";
import { recoverWrite } from "../orca/adapter.ts";
import type { NewTask, RefusalReason, StartOutcome, StartPorts, StartRefusal, StartRequest } from "./types.ts";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** The first non-empty string under any of `keys`, searched depth-first; receipt shapes are Orca's. */
export function findKey(v: unknown, keys: readonly string[], depth = 0): string | undefined {
  if (depth > 5 || !isObject(v)) return undefined;
  for (const k of keys) {
    const x = v[k];
    if (typeof x === "string" && x !== "") return x;
  }
  for (const x of Object.values(v)) {
    const inner = findKey(x, keys, depth + 1);
    if (inner) return inner;
  }
  return undefined;
}

const DISPATCH_KEYS = ["dispatchId", "dispatch_id"] as const;
const TASK_KEYS = ["taskId", "task_id"] as const;
const WORKTREE_KEYS = ["worktreeId", "worktree_id", "workspace"] as const;

const LOOP_LIMIT = 3;

/** Decision 60: a write whose response was lost is replayed only through request-show. */
async function write(orca: OrcaAdapter, first: Promise<OrcaResult<Receipt>>, again: (o: WriteOptions) => Promise<OrcaResult<Receipt>>) {
  const r = await first;
  if (r.ok || r.error.code !== "response_lost" || !r.requestId) return r;
  return recoverWrite(orca, r.requestId, again);
}

function firstPrompt(t: NewTask): string {
  if (!t.lateAnswers?.length) return t.spec;
  return [t.spec, "", "늦게 도착한 답(결정 91 ④):", ...t.lateAnswers.map((a) => `- ${a}`)].join("\n");
}

/**
 * The one path that opens a session (decision 94): task-create --deps → lineage and depth →
 * ready and capacity → worker-start --task <id> --worktree new-child → Dispatch read back.
 * A refusal writes one `signal{start_refused}` and escalates to whoever handed the requester its work.
 */
export async function startUnit(ports: StartPorts, req: StartRequest): Promise<StartOutcome> {
  const { orca, store } = ports;
  const source = ports.source ?? "core:start";
  const { requester } = req;
  let parentHandle: string | null = null;
  let requesterDispatch: string | undefined;

  const refuse = async (reason: RefusalReason, detail: string, taskId?: string): Promise<StartRefusal> => {
    store.append({
      type: "signal",
      source,
      payload: { kind: "start_refused", reason },
      subject: detail.slice(0, 500),
      entity: "task",
      entity_id: taskId ?? requester.taskId ?? requester.worktreeId,
      actor: requester.role,
    });
    let escalatedTo: string | null = null;
    if (requester.role === "orchestrator") {
      escalatedTo = "owner_todo";
    } else if (parentHandle) {
      const sent = await orca.send({
        to: parentHandle,
        type: "escalation",
        subject: `start_refused: ${reason}`,
        body: `시작 거부(${reason}): ${detail}. Task 는 열린 채 남는다. 부모는 같은 일을 자기 Run 에서 다시 시작하지 않는다(결정 94 (라)).`,
        ...(requester.taskId ? { taskId: requester.taskId } : {}),
        ...(requesterDispatch ? { dispatchId: requesterDispatch } : {}),
      });
      escalatedTo = sent.ok ? parentHandle : null;
    }
    return { kind: "refused", reason, detail, ...(taskId ? { taskId } : {}), escalatedTo };
  };

  // ① capability_missing
  const status = await orca.status();
  if (!status.ok) return refuse("capability_missing", `orca status 를 읽지 못했다 (${status.error.code})`);
  const have = new Set(status.value.runtime.capabilities);
  const missing = REQUIRED_CAPABILITIES.filter((c) => !have.has(c));
  if (missing.length > 0) return refuse("capability_missing", `없는 기능: ${missing.join(", ")}`);

  // ② lineage_invalid: the requester's own Dispatch first, so a refusal knows whom to tell.
  let requesterDepth = 0;
  if (requester.role !== "orchestrator") {
    if (!requester.taskId) return refuse("lineage_invalid", `${requester.role} 의 Task id 가 없어 Dispatch 를 읽을 수 없다`);
    const d = await orca.dispatchShow({ task: requester.taskId });
    if (!d.ok) return refuse("lineage_invalid", `요청자의 Dispatch 를 읽지 못했다 (${d.error.code})`);
    const row = d.value as unknown as Json;
    requesterDispatch = typeof row.id === "string" ? row.id : undefined;
    parentHandle = typeof row.creator_handle === "string" ? row.creator_handle : null;
    requesterDepth = typeof row.depth === "number" ? row.depth : Number.NaN;
    if (!requesterDispatch || Number.isNaN(requesterDepth)) return refuse("lineage_invalid", "요청자의 Dispatch 에 id·depth 가 없다");
  } else if (requester.taskId) {
    return refuse("lineage_invalid", "오케스트레이터는 Dispatch 를 가진 세션이 아니다");
  }
  if (requester.role === "worker") return refuse("lineage_invalid", "워커는 세션을 시작하지 않는다");
  if (requester.role === "lead" && req.childRole === "lead") return refuse("lineage_invalid", "리드는 리드를 시작하지 않는다");
  if (requester.role === "lead" && requesterDepth !== 1) {
    return refuse("lineage_invalid", `리드의 Dispatch 깊이가 ${requesterDepth} 이다(오케스트레이터의 자식은 1)`);
  }
  const trees = await orca.worktreeList({});
  if (!trees.ok) return refuse("lineage_invalid", `worktree 목록을 읽지 못했다 (${trees.error.code})`);
  if (!trees.value.rows.some((w) => w.id === requester.worktreeId)) {
    return refuse("lineage_invalid", "부모 worktree 를 읽지 못했다(로컬 worktree 목록에 없다)");
  }

  // ③ depth_exceeded: only when the setting was read; otherwise the receipt decides (⑤).
  const childDepth = requesterDepth + 1;
  if (req.maxDepth !== undefined) {
    if (childDepth > req.maxDepth) return refuse("depth_exceeded", `새 세션 깊이 ${childDepth} > 설정 ${req.maxDepth}`);
    if (req.childRole === "lead" && childDepth + 1 > req.maxDepth) {
      return refuse("depth_exceeded", `리드 아래 워커 깊이 ${childDepth + 1} > 설정 ${req.maxDepth}: 이 프로그램은 자기 Run 의 워커로 돌린다`);
    }
  }

  // The Task: an existing one, or a new one with its deps.
  let taskId: string;
  if ("id" in req.task) {
    taskId = req.task.id;
  } else {
    const t = req.task;
    const args = { spec: firstPrompt(t), run: requester.runId, ...(t.title ? { title: t.title } : {}), ...(t.deps ? { deps: t.deps } : {}) };
    const made = await write(orca, orca.taskCreate(args), (o) => orca.taskCreate(args, o));
    if (!made.ok) return refuse("orca_error", `task-create 실패 (${made.error.code}: ${made.error.message})`);
    const id = findKey(made.value, TASK_KEYS) ?? (isObject(made.value.task) ? findKey(made.value.task, ["id"]) : undefined);
    if (!id) return refuse("orca_error", "task-create 영수증에 Task id 가 없다");
    taskId = id;
  }

  // T5: count this Task's failed starts; stop at the third.
  const failures = store
    .events({ type: "signal" })
    .filter((e) => e.entity_id === taskId && e.payload.kind === "start_refused" && e.payload.reason === "orca_error").length;
  if (failures >= LOOP_LIMIT) return { kind: "stopped", taskId, why: "start_failed_3x" };

  // Ready and capacity: not refusals, the caller waits.
  const tasks = await orca.taskList({ run: requester.runId });
  if (!tasks.ok) return refuse("orca_error", `task-list 실패 (${tasks.error.code})`, taskId);
  const task = tasks.value.find((t) => t.id === taskId);
  if (task?.status === "dispatched") {
    return { kind: "waiting", taskId, why: "already_dispatched", detail: "이미 Dispatch 된 Task 는 다시 시작하지 않는다(T5)" };
  }
  if (task?.status !== "ready") {
    return { kind: "waiting", taskId, why: "not_ready", detail: task ? `Task 상태 ${task.status}` : "Run 의 Task 목록에 없다" };
  }
  const free = await ports.slots();
  if (free <= 0) return { kind: "waiting", taskId, why: "no_capacity", detail: `빈 자리 ${free}` };

  // ④ orca_error
  const startArgs = { task: taskId, agent: req.agent, worktree: "new-child" as const, run: requester.runId };
  const started = await write(orca, orca.workerStart(startArgs), (o) => orca.workerStart(startArgs, o));
  if (!started.ok) {
    const outcome = await refuse("orca_error", `worker-start 실패 (${started.error.code}: ${started.error.message})`, taskId);
    const dead = findKey(started.error.data, DISPATCH_KEYS);
    if (dead) store.append({ type: "worker_dead", source, payload: { reason: "start_failed" }, entity: "dispatch", entity_id: dead });
    if (failures + 1 >= LOOP_LIMIT) {
      store.append({ type: "loop_detected", source, payload: { reason: "start_failed_3x" }, entity: "task", entity_id: taskId });
    }
    return outcome;
  }

  // ⑤ no_dispatch: the receipt first, then dispatch-show (decision 94 (나)⑤).
  let dispatchId = findKey(started.value, DISPATCH_KEYS);
  if (!dispatchId) {
    const d = await orca.dispatchShow({ task: taskId });
    if (d.ok && typeof d.value.id === "string") dispatchId = d.value.id;
  }
  const worktreeId = findKey(started.value, WORKTREE_KEYS);
  if (!dispatchId) {
    const left = [findKey(started.value, ["terminal", "handle"]), worktreeId].filter(Boolean).join(" · ");
    return refuse("no_dispatch", `worker-start 는 끝났지만 Dispatch 가 없다${left ? ` (남은 것: ${left})` : ""}`, taskId);
  }

  const notes: string[] = [];
  if (req.references?.length) {
    if (!worktreeId) notes.push("reference add 건너뜀: 새 worktree id 를 영수증에서 찾지 못했다");
    else {
      const ref = await orca.referenceAdd({ worktree: worktreeId, urls: req.references });
      if (!ref.ok) notes.push(`reference add 실패 (${ref.error.code}), 시작은 계속`);
    }
  }
  return { kind: "started", taskId, dispatchId, ...(worktreeId ? { worktreeId } : {}), notes };
}
