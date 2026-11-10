import { realpathSync } from "node:fs";
import { REQUIRED_CAPABILITIES } from "../checks/orca-capabilities.ts";
import type { OrcaAdapter, OrcaResult, Receipt, WriteOptions } from "../contract/orca.ts";
import { type Choice, resolve } from "../models/index.ts";
import { recoverWrite } from "../orca/adapter.ts";
import { settled } from "../recover/recover.ts";
import type { NewTask, RefusalReason, Role, StartOutcome, StartPorts, StartRefusal, StartRequest } from "./types.ts";

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

function defaultChoice(childRole: "lead" | "worker"): Choice {
  const r = resolve(childRole);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
}

const LOOP_LIMIT = 3;
/** `target` of a refusal that came from a start attempt itself; only these count toward T5. */
const START_ATTEMPT = "worker-start";

/**
 * The role line every session sangsoe starts carries as its Task spec's first line (decision 46).
 * The SessionStart hook reads it back from the spec; Orca stays the only store of it.
 */
export const ROLE_LINE_PREFIX = "sangsoe-role:";
export const roleLine = (role: Role) => `${ROLE_LINE_PREFIX} ${role}`;

/** Decision 60: a write whose response was lost is replayed only through request-show. */
async function write(orca: OrcaAdapter, first: Promise<OrcaResult<Receipt>>, again: (o: WriteOptions) => Promise<OrcaResult<Receipt>>) {
  const r = await first;
  if (r.ok || r.error.code !== "response_lost" || !r.requestId) return r;
  return recoverWrite(orca, r.requestId, again);
}

const MAX_WORKER_PAGES = 50;

/** Physical path, so a symlinked workspace root (/var vs /private/var) compares equal; as given when it does not exist. */
const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

const within = (dir: string, root: string) => {
  const r = root.replace(/\/+$/, "");
  return r !== "" && (dir === r || dir.startsWith(`${r}/`));
};

/**
 * A lead also holds its own Run, so "no taskId" and run-current alone cannot tell it from the
 * orchestrator. What can: the orchestrator's worktree carries no unsettled Dispatch. worker-list spans
 * every Run, newest first; an unreadable or unfinished scan is a problem, never a pass.
 */
async function liveDispatchIn(orca: OrcaAdapter, worktreeId: string): Promise<string | null> {
  let cursor: string | undefined;
  for (let page = 0; page < MAX_WORKER_PAGES; page++) {
    const r = await orca.workerList({ limit: 100, ...(cursor ? { cursor } : {}) });
    if (!r.ok) return `오케스트레이터 worktree 의 Dispatch 를 확인하지 못했다 (${r.error.code})`;
    // Not settled is enough: a Dispatch whose liveness Orca cannot tell (after a restart) still counts.
    const own = r.value.rows.find((w) => w.workspace === worktreeId && !settled(w));
    if (own) return `오케스트레이터라고 밝혔지만 이 worktree 에 끝나지 않은 Dispatch ${own.dispatchId} 가 있다(리드·워커 세션)`;
    cursor = r.value.nextCursor;
    if (!cursor) return null;
  }
  return "오케스트레이터 worktree 의 Dispatch 확인이 페이지 상한에서 끝나지 않았다";
}

function firstPrompt(role: Role, t: NewTask): string {
  const lines = [roleLine(role), t.spec];
  if (t.lateAnswers?.length) lines.push("", "늦게 도착한 답(결정 91 ④):", ...t.lateAnswers.map((a) => `- ${a}`));
  return lines.join("\n");
}

/**
 * The one path that opens a session (decision 94): lineage and depth → task-create --deps →
 * ready and capacity → worker-start --task <id> --worktree new-child → Dispatch read back.
 * A refusal writes one `signal{start_refused}` and escalates to whoever handed the requester its work.
 */
export async function startUnit(ports: StartPorts, req: StartRequest): Promise<StartOutcome> {
  const { orca, store } = ports;
  const source = ports.source ?? "core:start";
  const { requester } = req;
  let parentHandle: string | null = null;
  let requesterDispatch: string | undefined;

  const refuse = async (reason: RefusalReason, detail: string, taskId?: string, attempt = false): Promise<StartRefusal> => {
    store.append({
      type: "signal",
      source,
      payload: { kind: "start_refused", reason },
      subject: detail.slice(0, 500),
      entity: "task",
      entity_id: taskId ?? requester.taskId ?? requester.worktreeId,
      actor: requester.role,
      ...(attempt ? { target: START_ATTEMPT } : {}),
    });
    let escalatedTo: string | null = null;
    if (requester.role === "orchestrator") {
      // Nobody above the orchestrator: the escalation ends at the owner (decision 94 (다)).
      store.append({ type: "escalation", source, payload: { to: "owner", reason: `start_refused:${reason}` }, entity: "task", entity_id: taskId ?? requester.worktreeId });
      escalatedTo = "owner";
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

  // Read who is asking before judging anything, so every refusal knows whom to tell.
  let lineageProblem: string | null = null;
  let requesterDepth = 0;
  if (requester.role !== "orchestrator") {
    if (!requester.taskId) lineageProblem = `${requester.role} 의 Task id 가 없어 Dispatch 를 읽을 수 없다`;
    else {
      const d = await orca.dispatchShow({ task: requester.taskId });
      if (!d.ok) lineageProblem = `요청자의 Dispatch 를 읽지 못했다 (${d.error.code})`;
      else {
        const row = d.value as unknown as Json;
        requesterDispatch = typeof row.id === "string" ? row.id : undefined;
        parentHandle = typeof row.creator_handle === "string" ? row.creator_handle : null;
        requesterDepth = typeof row.depth === "number" ? row.depth : Number.NaN;
        if (!requesterDispatch || Number.isNaN(requesterDepth)) lineageProblem = "요청자의 Dispatch 에 id·depth 가 없다";
        else if (row.run_id === requester.runId) lineageProblem = "요청자의 Dispatch 가 시작하려는 Run 안에 있다(그 Run 을 쥔 쪽이 아니다)";
      }
    }
  } else if (requester.taskId) {
    lineageProblem = "오케스트레이터는 Dispatch 를 가진 세션이 아니다";
  } else {
    lineageProblem = await liveDispatchIn(orca, requester.worktreeId);
  }

  // ① capability_missing
  const status = await orca.status();
  if (!status.ok) return refuse("capability_missing", `orca status 를 읽지 못했다 (${status.error.code})`);
  const have = new Set(status.value.runtime.capabilities);
  const missing = REQUIRED_CAPABILITIES.filter((c) => !have.has(c));
  if (missing.length > 0) return refuse("capability_missing", `없는 기능: ${missing.join(", ")}`);

  // ② lineage_invalid. The declared role is checked against Orca: the caller must hold the Run it
  // starts in (run-current answers for the calling session), and a lead's Dispatch must be its own.
  if (lineageProblem) return refuse("lineage_invalid", lineageProblem);
  if (requester.role === "worker") return refuse("lineage_invalid", "워커는 세션을 시작하지 않는다");
  if (requester.role === "lead" && req.childRole === "lead") return refuse("lineage_invalid", "리드는 리드를 시작하지 않는다");
  if (requester.role === "lead" && requesterDepth !== 1) {
    return refuse("lineage_invalid", `리드의 Dispatch 깊이가 ${requesterDepth} 이다(오케스트레이터의 자식은 1)`);
  }
  const current = await orca.runCurrent();
  if (!current.ok) return refuse("lineage_invalid", `이 세션이 쥔 Run 을 읽지 못했다 (${current.error.code})`);
  if (current.value.runId !== requester.runId) {
    return refuse("lineage_invalid", `이 세션이 쥔 Run(${current.value.runId ?? "없음"})이 요청한 Run 이 아니다`);
  }
  if (requesterDispatch) {
    const w = await orca.workerShow({ dispatch: requesterDispatch });
    if (!w.ok) return refuse("lineage_invalid", `요청자의 워커를 읽지 못했다 (${w.error.code})`);
    if (w.value.workspace !== requester.worktreeId) return refuse("lineage_invalid", "요청자의 Dispatch 가 밝힌 worktree 의 것이 아니다");
  }
  const trees = await orca.worktreeList({});
  if (!trees.ok) return refuse("lineage_invalid", `worktree 목록을 읽지 못했다 (${trees.error.code})`);
  const tree = trees.value.rows.find((w) => w.id === requester.worktreeId);
  if (!tree) return refuse("lineage_invalid", "부모 worktree 를 읽지 못했다(로컬 worktree 목록에 없다)");
  // The declared worktree is the caller's own only if it is the innermost one the calling session
  // runs in: with worktrees nested under a checkout, the outer one also contains the cwd.
  const cwd = real((ports.cwd ?? (() => process.cwd()))());
  const innermost = trees.value.rows
    .filter((w) => within(cwd, real(w.path)))
    .sort((a, b) => real(b.path).length - real(a.path).length)[0];
  if (innermost?.id !== tree.id) {
    return refuse("lineage_invalid", `밝힌 worktree(${tree.path})가 부르는 세션의 작업 폴더(${cwd})가 있는 worktree 가 아니다`);
  }

  // ③ depth_exceeded: only when the setting was read; otherwise the receipt decides (⑤).
  const childDepth = requesterDepth + 1;
  if (req.maxDepth !== undefined) {
    if (childDepth > req.maxDepth) return refuse("depth_exceeded", `새 세션 깊이 ${childDepth} > 설정 ${req.maxDepth}`);
    if (req.childRole === "lead" && childDepth + 1 > req.maxDepth) {
      return refuse("depth_exceeded", `리드 아래 워커 깊이 ${childDepth + 1} > 설정 ${req.maxDepth}: 이 프로그램은 자기 Run 의 워커로 돌린다`);
    }
  }

  // The Task: an existing one, or a new one with its deps and the child's role line first.
  let taskId: string;
  if ("id" in req.task) {
    taskId = req.task.id;
  } else {
    const t = req.task;
    const args = {
      spec: firstPrompt(req.childRole, t),
      run: requester.runId,
      ...(t.title ? { title: t.title } : {}),
      ...(t.deps ? { deps: t.deps } : {}),
    };
    const made = await write(orca, orca.taskCreate(args), (o) => orca.taskCreate(args, o));
    if (!made.ok) return refuse("orca_error", `task-create 실패 (${made.error.code}: ${made.error.message})`);
    const id = findKey(made.value, TASK_KEYS) ?? (isObject(made.value.task) ? findKey(made.value.task, ["id"]) : undefined);
    if (!id) return refuse("orca_error", "task-create 영수증에 Task id 가 없다");
    taskId = id;
  }

  // T5: count this Task's failed start attempts; stop at the third.
  const failures = store
    .events({ type: "signal" })
    .filter((e) => e.entity_id === taskId && e.target === START_ATTEMPT && e.payload.kind === "start_refused").length;
  if (failures >= LOOP_LIMIT) return { kind: "stopped", taskId, why: "start_failed_3x" };
  const failedAttempt = async (reason: RefusalReason, detail: string) => {
    const out = await refuse(reason, detail, taskId, true);
    if (failures + 1 >= LOOP_LIMIT) {
      store.append({ type: "loop_detected", source, payload: { reason: "start_failed_3x" }, entity: "task", entity_id: taskId });
    }
    return out;
  };

  // Ready and capacity: not refusals, the caller waits. An unreadable one is not "no room".
  const tasks = await orca.taskList({ run: requester.runId });
  if (!tasks.ok) return refuse("orca_error", `task-list 실패 (${tasks.error.code})`, taskId);
  const task = tasks.value.find((t) => t.id === taskId);
  if (task?.status === "dispatched") {
    return { kind: "waiting", taskId, why: "already_dispatched", detail: "이미 Dispatch 된 Task 는 다시 시작하지 않는다(T5)" };
  }
  if (task?.status !== "ready") {
    return { kind: "waiting", taskId, why: "not_ready", detail: task ? `Task 상태 ${task.status}` : "Run 의 Task 목록에 없다" };
  }
  let free: number;
  try {
    free = await ports.slots();
  } catch (err) {
    return refuse("orca_error", `capacity 를 읽지 못했다 (${(err as Error).message})`, taskId);
  }
  if (free <= 0) return { kind: "waiting", taskId, why: "no_capacity", detail: `빈 자리 ${free}` };

  // ④ orca_error
  const choice = req.model ?? defaultChoice(req.childRole);
  const startArgs = {
    task: taskId,
    agent: req.agent,
    worktree: "new-child" as const,
    run: requester.runId,
    model: choice.model,
    effort: choice.effort,
  };
  const started = await write(orca, orca.workerStart(startArgs), (o) => orca.workerStart(startArgs, o));
  if (!started.ok) {
    const dead = findKey(started.error.data, DISPATCH_KEYS);
    if (dead) store.append({ type: "worker_dead", source, payload: { reason: "start_failed" }, entity: "dispatch", entity_id: dead });
    return failedAttempt("orca_error", `worker-start 실패 (${started.error.code}: ${started.error.message})`);
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
    return failedAttempt("no_dispatch", `worker-start 는 끝났지만 Dispatch 가 없다${left ? ` (남은 것: ${left})` : ""}`);
  }

  if (choice.escalated) {
    store.append({
      type: "model_changed",
      source,
      payload: { from: choice.escalated.from, to: `${choice.model}/${choice.effort}`, reason: choice.escalated.reason },
      entity: "task",
      entity_id: taskId,
    });
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
