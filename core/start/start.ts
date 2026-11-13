import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { advisorSetting } from "../checks/model-table.ts";
import { REQUIRED_CAPABILITIES } from "../checks/orca-capabilities.ts";
import type { OrcaAdapter, OrcaResult, Receipt, TaskRow, WriteOptions } from "../contract/orca.ts";
import type { ViewInput, ViewTask } from "../contract/views.ts";
import { foldFacts } from "../graph/facts.ts";
import { itemRef } from "../graph/nodes.ts";
import { whyFrom } from "../graph/ready.ts";
import { type FullTaskRow, snapshotTasks } from "../graph/snapshot.ts";
import { type Choice, launch, localDay, POLICY, pairing, resolve, spend } from "../models/index.ts";
import { recoverWrite } from "../orca/adapter.ts";
import { settled } from "../recover/recover.ts";
import { writeLocalSettings } from "./local-settings.ts";
import { type NewTask, REPO_SELECTOR, type RefusalReason, type Role, type StartOutcome, type StartPorts, type StartRefusal, type StartRequest } from "./types.ts";

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

function defaultChoice(childRole: "lead" | "worker"): Choice {
  const r = resolve(childRole);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
}

/**
 * Whether this Orca's worker-start takes `--advisor` (decision 187), read from its own command
 * schema. No Orca does yet; an unreadable schema counts as no.
 */
async function orcaTakesAdvisor(orca: OrcaAdapter): Promise<boolean> {
  const ctx = await orca.agentContext();
  if (!ctx.ok) return false;
  const ws = ctx.value.commands.find((c) => c.path.join(" ") === "orchestration worker-start");
  return ws?.flags.includes("advisor") ?? false;
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
  const replayed = await recoverWrite(orca, r.requestId, again);
  // The first request reached Orca: a refused replay must not read as a definite failure (decision 202).
  return replayed.ok || replayed.requestId ? replayed : { ...replayed, requestId: r.requestId };
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
 * A session holding its Run with no Task (the orchestrator, or a lead started outside start_unit,
 * decision 243) has no Dispatch in its worktree; one that has is a lead or worker dropping its Task.
 * worker-list spans every Run, newest first; an unreadable or unfinished scan is a problem, never a pass.
 */
async function liveDispatchIn(orca: OrcaAdapter, worktreeId: string, role: Role): Promise<string | null> {
  const who = role === "lead" ? "Task 없는 리드" : "오케스트레이터";
  let cursor: string | undefined;
  for (let page = 0; page < MAX_WORKER_PAGES; page++) {
    const r = await orca.workerList({ limit: 100, ...(cursor ? { cursor } : {}) });
    if (!r.ok) return `${who} worktree 의 Dispatch 를 확인하지 못했다 (${r.error.code})`;
    // Not settled is enough: a Dispatch whose liveness Orca cannot tell (after a restart) still counts.
    const own = r.value.rows.find((w) => w.workspace === worktreeId && !settled(w));
    if (own) return `${who}라고 밝혔지만 이 worktree 에 끝나지 않은 Dispatch ${own.dispatchId} 가 있다(Task 를 가진 리드·워커 세션)`;
    cursor = r.value.nextCursor;
    if (!cursor) return null;
  }
  return `${who} worktree 의 Dispatch 확인이 페이지 상한에서 끝나지 않았다`;
}

/** The role a spec's first line names, read as SessionStart's readRoleLine reads it; "" when it names none. */
function specRole(spec: unknown): { first: string; role: string } {
  const first = typeof spec === "string" ? (spec.split("\n", 1)[0] ?? "").trim() : "";
  return { first, role: first.startsWith(ROLE_LINE_PREFIX) ? first.slice(ROLE_LINE_PREFIX.length).trim() : "" };
}

/**
 * Decision 243 (다): a depth-1 worker holding a Run of its own would pass every Dispatch check as a
 * lead, so a lead's own Task must carry the lead role line. Unreadable is a problem, never a pass.
 */
async function leadTaskProblem(orca: OrcaAdapter, taskId: string, run: string): Promise<string | null> {
  const r = await orca.taskList({ run, full: true });
  if (!r.ok) return `요청자의 Task 를 읽지 못했다 (${r.error.code})`;
  const own = r.value.find((t) => t.id === taskId) as (TaskRow & { spec?: unknown }) | undefined;
  if (!own) return `요청자의 Task ${taskId} 가 그 Dispatch 의 Run(${run})에 없다`;
  const { first, role } = specRole(own.spec);
  return role === "lead" ? null : `요청자의 Task ${taskId} spec 첫 줄이 "${first.slice(0, 60)}" 라 리드가 아니다(${roleLine("lead")} 가 아니다)`;
}

/** Why GRAPH holds a Task Orca calls ready, or null when it does not. */
function graphHold(rows: readonly FullTaskRow[], run: string, events: ViewInput["events"], taskId: string): string | null {
  let tasks: ViewTask[];
  try {
    tasks = snapshotTasks(rows, run);
  } catch (err) {
    return `task-list 의 deps 를 읽지 못했다 (${(err as Error).message})`;
  }
  // Only decision 178's merge wait: a completed predecessor in this Run. Another Run's predecessor
  // is not in this snapshot, and holds and triggers stay queue-monitor's call as before.
  const done = new Set(tasks.filter((t) => t.status === "completed").map((t) => itemRef(t.id)));
  const report = whyFrom({ orca: { tasks, gates: [] }, events, now: new Date().toISOString() }, foldFacts(events), taskId);
  const held = report.rows.filter((r) => (r.kind === "blocks" || r.kind === "after") && done.has(r.pred));
  return held.length === 0 ? null : held.map((r) => `${r.pred} (${r.kind}): ${r.predState}`).join("; ");
}

function firstPrompt(role: Role, t: NewTask): string {
  const lines = [roleLine(role), t.spec];
  if (t.lateAnswers?.length) lines.push("", "늦게 도착한 답(결정 91 ④):", ...t.lateAnswers.map((a) => `- ${a}`));
  return lines.join("\n");
}

/**
 * The one path that opens a session (decision 94): lineage and depth → task-create --deps →
 * ready and capacity → worktree create (the parent's child) → its setup shell and local settings →
 * `unit_started` (decisions 200, 202) → worker-start --task <id> --worktree id:<it> --keep-open →
 * Dispatch read back.
 * A refusal writes one `signal{start_refused}` and escalates to whoever handed the requester its work.
 */
export async function startUnit(ports: StartPorts, req: StartRequest): Promise<StartOutcome> {
  const { orca, store } = ports;
  const source = ports.source ?? "core:start";
  let { requester } = req;
  let parentHandle: string | null = null;
  let requesterDispatch: string | undefined;
  let requesterActive = false;

  const refuse = async (reason: RefusalReason, detail: string, taskId?: string, attempt = false): Promise<StartRefusal> => {
    store.append({
      type: "signal",
      source,
      payload: { kind: "start_refused", reason },
      subject: detail.slice(0, 500),
      entity: "task",
      entity_id: taskId ?? requester.taskId ?? requester.worktreeId ?? requester.runId,
      actor: requester.role,
      ...(attempt ? { target: START_ATTEMPT } : {}),
    });
    let escalatedTo: string | null = null;
    if (requester.role === "orchestrator" || (requester.role === "lead" && !requester.taskId)) {
      // Nobody above it in Orca: the escalation ends at the owner (decisions 94 (다), 243).
      store.append({
        type: "escalation",
        source,
        payload: { to: "owner", reason: `start_refused:${reason}` },
        entity: "task",
        entity_id: taskId ?? requester.worktreeId ?? requester.runId,
      });
      escalatedTo = "owner";
    } else if (parentHandle) {
      // Orca takes an escalation only from a sender whose Dispatch is still active (sender_not_assignee).
      const sent = await orca.send({
        to: parentHandle,
        type: requesterActive ? "escalation" : "status",
        subject: `start_refused: ${reason}`,
        body: `시작 거부(${reason}): ${detail}. Task 는 열린 채 남는다. 부모는 같은 일을 자기 Run 에서 다시 시작하지 않는다(결정 94 (라)).`,
        ...(requester.taskId ? { taskId: requester.taskId } : {}),
        ...(requesterDispatch && requesterActive ? { dispatchId: requesterDispatch } : {}),
      });
      escalatedTo = sent.ok ? parentHandle : null;
    }
    return { kind: "refused", reason, detail, ...(taskId ? { taskId } : {}), escalatedTo };
  };

  // Read who is asking before judging anything, so every refusal knows whom to tell.
  let lineageProblem: string | null = null;
  let requesterDepth = 0;
  if (requester.role !== "orchestrator" && requester.taskId) {
    const d = await orca.dispatchShow({ task: requester.taskId });
    if (!d.ok) lineageProblem = `요청자의 Dispatch 를 읽지 못했다 (${d.error.code})`;
    else {
      const row = d.value as unknown as Json;
      requesterDispatch = typeof row.id === "string" ? row.id : undefined;
      requesterActive = row.status === "dispatched" && (row.completed_at ?? null) === null;
      parentHandle = typeof row.creator_handle === "string" ? row.creator_handle : null;
      requesterDepth = typeof row.depth === "number" ? row.depth : Number.NaN;
      if (!requesterDispatch || Number.isNaN(requesterDepth)) lineageProblem = "요청자의 Dispatch 에 id·depth 가 없다";
      else if (row.run_id === requester.runId) lineageProblem = "요청자의 Dispatch 가 시작하려는 Run 안에 있다(그 Run 을 쥔 쪽이 아니다)";
      else if (requester.role === "lead") {
        lineageProblem =
          typeof row.run_id === "string" && row.run_id !== ""
            ? await leadTaskProblem(orca, requester.taskId, row.run_id)
            : "요청자의 Dispatch 에 Run 이 없다";
      }
    }
  } else if (requester.role === "worker") {
    lineageProblem = "worker 의 Task id 가 없어 Dispatch 를 읽을 수 없다";
  } else if (requester.taskId) {
    lineageProblem = "오케스트레이터는 Dispatch 를 가진 세션이 아니다";
  } else if (requester.worktreeId) {
    // Decision 243: a lead with no Task holds its Run as the orchestrator does and gets the same check.
    lineageProblem = await liveDispatchIn(orca, requester.worktreeId, requester.role);
  }
  if (!lineageProblem && !requester.worktreeId && requester.role !== "orchestrator") {
    lineageProblem = `${requester.role} 는 자기 worktree 를 밝힌다(worktree 없이 시작하는 것은 오케스트레이터뿐이다)`;
  }
  if (!lineageProblem && req.repo !== undefined && !REPO_SELECTOR.test(req.repo)) {
    lineageProblem = `대상 저장소 "${req.repo}" 가 Orca 저장소 선택자(id:·name:·path:)가 아니다`;
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
  if (requester.role === "lead" && requester.taskId && requesterDepth !== 1) {
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
  const trees = await orca.worktreeList({ limit: 1000 });
  if (!trees.ok) return refuse("lineage_invalid", `worktree 목록을 읽지 못했다 (${trees.error.code})`);
  // A partial list could hide the caller's own worktree, so the check below fails closed on one.
  if (trees.value.truncated || trees.value.omittedHostIds.includes("local")) {
    return refuse("lineage_invalid", "worktree 목록이 다 오지 않았다: 부르는 세션의 worktree 를 가리지 못한다");
  }
  // The declared worktree is the caller's own only if it is the innermost one the calling session
  // runs in: with worktrees nested under a checkout, the outer one also contains the cwd.
  const cwd = real((ports.cwd ?? (() => process.cwd()))());
  const innermost = trees.value.rows
    .filter((w) => within(cwd, real(w.path)))
    .sort((a, b) => real(b.path).length - real(a.path).length)[0];
  if (requester.worktreeId) {
    const tree = trees.value.rows.find((w) => w.id === requester.worktreeId);
    if (!tree) return refuse("lineage_invalid", "부모 worktree 를 읽지 못했다(로컬 worktree 목록에 없다)");
    if (innermost?.id !== tree.id) {
      return refuse("lineage_invalid", `밝힌 worktree(${tree.path})가 부르는 세션의 작업 폴더(${cwd})가 있는 worktree 가 아니다`);
    }
  } else if (innermost) {
    // Decision 217: [gate:delegate] keeps the orchestrator from asking Orca which worktree it is in, so
    // start_unit takes the one its folder is in, under the same live-Dispatch check a declared one gets.
    const live = await liveDispatchIn(orca, innermost.id, requester.role);
    if (live) return refuse("lineage_invalid", live);
    requester = { ...requester, worktreeId: innermost.id };
  } else {
    // Orca refuses new-child outside a managed worktree, so one outside every worktree names a repo (decision 197).
    if (!(req.repo ?? ("id" in req.task ? storedRepo(store, req.task.id) : undefined))) return refuse("lineage_invalid", "worktree 밖의 오케스트레이터는 대상 저장소(repo)를 밝힌다: 새 worktree 를 둘 곳이 없다");
  }

  // ③ depth_exceeded: only when the setting was read; otherwise the receipt decides (⑤).
  const childDepth = requesterDepth + 1;
  if (req.maxDepth !== undefined) {
    if (childDepth > req.maxDepth) return refuse("depth_exceeded", `새 세션 깊이 ${childDepth} > 설정 ${req.maxDepth}`);
    if (req.childRole === "lead" && childDepth + 1 > req.maxDepth) {
      return refuse("depth_exceeded", `리드 아래 워커 깊이 ${childDepth + 1} > 설정 ${req.maxDepth}: 이 프로그램은 자기 Run 의 워커로 돌린다`);
    }
  }

  // A choice built outside resolve still gets the pairing check: Claude Code drops a lower advisor silently.
  const choice = req.model ?? defaultChoice(req.childRole);
  const badPair = choice.advisorTier
    ? pairing(choice.tier, choice.advisorTier)
    : choice.advisor
      ? "an advisor without its tier cannot be checked"
      : null;
  if (badPair) return refuse("model_invalid", `${choice.kind}: ${badPair}`);

  // The Task: an existing one, or a new one with its deps and the child's role line first.
  let taskId: string;
  let alias: string | undefined;
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
    // Bound like item_create's, so a decision on this Task has its `item:iNNN` subject (decision 197).
    alias = store.allocate("i");
    store.append({
      type: "item_created",
      source,
      payload: { task: id, alias, who: requester.role === "orchestrator" ? "orchestrator" : `${requester.role}:${requester.runId}`, done_when: "spec 의 완료 조건", owner_action: 0, run: requester.runId },
      entity: "task",
      entity_id: id,
    });
  }
  const repo = req.repo ?? storedRepo(store, taskId);

  // T5: count this Task's failed start attempts; stop at the third.
  const failures = store
    .events({ type: "signal" })
    .filter((e) => e.entity_id === taskId && e.target === START_ATTEMPT && e.payload.kind === "start_refused").length;
  if (failures >= LOOP_LIMIT) return { kind: "stopped", taskId, why: "start_failed_3x" };
  const failedAttempt = async (reason: RefusalReason, detail: string) => {
    const out = await refuse(reason, detail, taskId, true);
    // On the third failure only (README T5): two starts racing past the count share this key.
    if (failures + 1 === LOOP_LIMIT) {
      store.append({
        type: "loop_detected",
        source,
        payload: { reason: "start_failed_3x" },
        entity: "task",
        entity_id: taskId,
        dedupe_key: `loop_detected:start_failed_3x:${taskId}`,
      });
    }
    return out;
  };

  // Ready and capacity: not refusals, the caller waits. An unreadable one is not "no room".
  const tasks = await orca.taskList({ run: requester.runId, full: true });
  if (!tasks.ok) return refuse("orca_error", `task-list 실패 (${tasks.error.code})`, taskId);
  const task = tasks.value.find((t) => t.id === taskId) as (TaskRow & { spec?: unknown }) | undefined;
  if (task?.status === "dispatched") {
    return { kind: "waiting", taskId, why: "already_dispatched", detail: "이미 Dispatch 된 Task 는 다시 시작하지 않는다(T5)" };
  }
  if (task?.status !== "ready") {
    return { kind: "waiting", taskId, why: "not_ready", detail: task ? `Task 상태 ${task.status}` : "Run 의 Task 목록에 없다" };
  }
  // Orca releases deps at the predecessor's worker_done, before its PR merges: GRAPH has the last word (decision 178).
  const held = graphHold(tasks.value as FullTaskRow[], requester.runId, store.events(), taskId);
  if (held) return { kind: "waiting", taskId, why: "not_ready", detail: held };
  // SessionStart takes the role from the spec's first line, and Orca cannot rewrite a spec: an
  // existing Task written for another role would start this child as that role.
  // Read as SessionStart's readRoleLine reads it (core/session imports this module, so not shared).
  const { first, role } = specRole(task.spec);
  if ("id" in req.task && role !== req.childRole) {
    return refuse(
      "lineage_invalid",
      `Task ${taskId} 의 spec 첫 줄이 "${first.slice(0, 60)}" 라 ${req.childRole} 로 시작하지 않는다. ${req.childRole} 항목은 role 을 밝혀 다시 만든다(item_create role)`,
      taskId,
    );
  }
  let free: number;
  try {
    free = await ports.slots();
  } catch (err) {
    return refuse("orca_error", `capacity 를 읽지 못했다 (${(err as Error).message})`, taskId);
  }
  if (free <= 0) return { kind: "waiting", taskId, why: "no_capacity", detail: `빈 자리 ${free}` };

  // ④ orca_error
  const orcaFlag = choice.advisor ? await orcaTakesAdvisor(orca) : false;
  const ownerSetting = () => (ports.advisorSetting ?? (() => advisorSetting(process.env, homedir())))();
  const row = POLICY[choice.kind];
  const used = spend(store.events({ type: "advisor_used" }), {
    task: taskId,
    ...(row.budget.per === "day" ? { day: localDay(new Date()) } : {}),
  }).calls;
  const spent = row.budget.calls > 0 && used >= row.budget.calls;
  // Decision 202: the worktree first, with no agent, so its local settings exist before the session
  // reads them. --parent-worktree keeps new-child's parentWorktreeId; without a worktree the lineage
  // is the Run alone (decision 197).
  const name = `${alias ?? taskId}-${Date.now().toString(36)}`;
  const made = await orca.worktreeCreate({
    name,
    ...(requester.worktreeId ? { parent: `id:${requester.worktreeId}` } : {}),
    ...(repo ? { repo } : {}),
  });
  // A lost answer may still have made it: the name lets the starter find it in `worktree list`.
  if (!made.ok) return failedAttempt("orca_error", `worktree create 실패 (${made.error.code}: ${made.error.message}), 요청한 이름: ${name}`);
  const tree = made.value;
  const notes: string[] = [];
  const shell = await setupShell(orca, tree, ports.hookFile ?? ((p) => existsSync(join(p, "orca.yaml"))));
  if (shell.note) notes.push(shell.note);
  let plan = launch(choice, { orcaFlag, ownerSetting: false, worktreeFile: true, spent });
  if (plan.settings) {
    try {
      (ports.writeSettings ?? writeLocalSettings)(tree.path, plan.settings);
    } catch (err) {
      notes.push(`worktree 설정 파일을 쓰지 못했다 (${(err as Error).message}): 오너 설정 경로로 시작한다`);
      const owner = ownerSetting();
      plan = launch(choice, { orcaFlag, ownerSetting: choice.advisor && !orcaFlag ? owner : false, spent });
      // Without the file sangsoe cannot turn off an advisor the owner's own setting attaches.
      // That note replaces the plan's "advisor off" one, which would no longer be true.
      if ((spent || !choice.advisor) && owner) plan = { ...plan, note: "advisor 를 끄지 못했다: 오너 설정의 advisorModel 이 이 세션에 붙는다" };
    }
  }
  // Before worker-start: the new session's SessionStart reads this row for its budget and finish lines.
  store.append({
    type: "unit_started",
    source,
    entity: "task",
    entity_id: taskId,
    payload: {
      kind: choice.kind,
      picked_by: req.pickedBy ?? "role",
      model: plan.model,
      // The row's effort even when Orca takes none for this model (decision 209): SessionStart's finish line keys on it.
      effort: plan.effort ?? choice.effort,
      ...(plan.route !== "none" && choice.advisor ? { advisor: choice.advisor } : {}),
      route: plan.route,
      budget: row.budget.calls,
      budget_per: row.budget.per,
      used,
      worktree: tree.id,
      ...(shell.handle ? { shell: shell.handle } : {}),
      setup: shell.setup,
      run: requester.runId,
    },
  });
  // Every start keeps its terminal open, the lifetime Orca gives a new-child worker: in an existing
  // worktree Orca would close it at worker_done, before the starter reads it. The starter releases it.
  const startArgs = {
    task: taskId,
    agent: req.agent,
    worktree: { existing: `id:${tree.id}` },
    run: requester.runId,
    model: plan.model,
    ...(plan.effort ? { effort: plan.effort } : {}),
    keepOpen: true,
    ...(plan.advisor ? { advisor: plan.advisor } : {}),
  };
  const started = await write(orca, orca.workerStart(startArgs), (o) => orca.workerStart(startArgs, o));
  if (!started.ok) {
    const dead = findKey(started.error.data, DISPATCH_KEYS);
    if (dead) store.append({ type: "worker_dead", source, payload: { reason: "start_failed" }, entity: "dispatch", entity_id: dead, target: taskId });
    // Only Orca's own refusal (JSON ok:false, no request id, no Dispatch) is a definite failure: a lost
    // answer, a recovery that could not prove nothing ran, or a non-zero exit may still own a live
    // agent (Orca's recovery guide). A setup that may still be running is not cut short either.
    const code = started.error.code;
    const unknown = dead || started.requestId !== undefined || ["response_lost", "request_absent", "unexpected_shape"].includes(code) || code.startsWith("exit_");
    const left = unknown
      ? `남은 worktree: ${tree.id}${shell.handle ? `, 셸 ${shell.handle}` : ""} (시작 결과를 알 수 없다: ${dead ? `Dispatch ${dead}` : code})`
      : shell.setup !== "none"
        ? `남은 worktree: ${tree.id}${shell.handle ? `, 셸 ${shell.handle}` : ""} (setup ${shell.setup}: 끝났는지 알 수 없어 닫지 않는다)`
        : await removeFailed(orca, tree.id, shell.handle);
    return failedAttempt("orca_error", `worker-start 실패 (${started.error.code}: ${started.error.message})${left ? `, ${left}` : ""}`);
  }

  // ⑤ no_dispatch: the receipt first, then dispatch-show (decision 94 (나)⑤).
  let dispatchId = findKey(started.value, DISPATCH_KEYS);
  if (!dispatchId) {
    const d = await orca.dispatchShow({ task: taskId });
    if (d.ok && typeof d.value.id === "string") dispatchId = d.value.id;
  }
  const worktreeId = tree.id;
  if (!dispatchId) {
    const left = [findKey(started.value, ["terminal", "handle"]), worktreeId].filter(Boolean).join(" · ");
    return failedAttempt("no_dispatch", `worker-start 는 끝났지만 Dispatch 가 없다${left ? ` (남은 것: ${left})` : ""}`);
  }

  for (const moved of [choice.escalated, plan.fallback]) {
    if (!moved) continue;
    const to = moved === plan.fallback ? `${plan.model}/${plan.effort}` : `${choice.model}/${choice.effort}`;
    store.append({ type: "model_changed", source, payload: { from: moved.from, to, reason: moved.reason }, entity: "task", entity_id: taskId });
  }

  if (plan.note) notes.unshift(plan.note);
  if (req.references?.length) {
    const ref = await orca.referenceAdd({ worktree: worktreeId, urls: req.references });
    if (!ref.ok) notes.push(`reference add 실패 (${ref.error.code}), 시작은 계속`);
  }
  if (!plan.effort) notes.push(`effort ${choice.effort} 은 넘기지 않았다: Orca 가 ${plan.model} 에 effort 를 받지 않는다(결정 209)`);
  const launched = { model: plan.model, ...(plan.effort ? { effort: plan.effort } : {}), ...(plan.advisor ? { advisor: plan.advisor } : {}), route: plan.route };
  return {
    kind: "started",
    taskId,
    ...(alias ? { alias } : {}),
    dispatchId,
    worktreeId,
    ...(shell.handle ? { shell: shell.handle } : {}),
    launch: launched,
    notes,
  };
}

type SetupShell = { handle?: string; setup: "none" | "script" | "unknown"; note?: string };

/**
 * Decision 202: the plain shell `worktree create` opened, read right after create: the worktree's
 * one terminal, with no agent in it. Anything else is not recorded, so nothing will close it.
 * Orca gives no setup-done signal, so `none` needs both an empty setup script and no `orca.yaml`.
 */
async function setupShell(orca: OrcaAdapter, tree: { id: string; path: string; repoId?: string }, hookFile: (path: string) => boolean): Promise<SetupShell> {
  let setup: SetupShell["setup"] = "unknown";
  if (tree.repoId) {
    const r = await orca.repoShow({ repo: `id:${tree.repoId}` });
    if (r.ok) setup = r.value.setup.trim() === "" && !hookFile(tree.path) ? "none" : "script";
  }
  const list = await orca.terminalList({ worktree: `id:${tree.id}` });
  const rows = list.ok && !list.value.truncated && list.value.nonLocal.rows === 0 ? list.value.rows : [];
  const only = rows.length === 1 ? rows[0] : undefined;
  if (!only || only.agentIdentity) {
    const why = list.ok ? `터미널 ${rows.length}개` : `terminal list 실패 (${list.error.code})`;
    return { setup, note: `새 worktree 의 setup 셸을 기록하지 못했다(${why}): 아무 터미널도 닫지 않는다` };
  }
  if (setup !== "none") {
    return { handle: only.handle, setup, note: `setup 셸 ${only.handle} 은 닫지 않는다(setup ${setup}: Orca 는 setup 이 끝났는지 알리지 않는다). 오너가 확인하고 닫는다` };
  }
  return { handle: only.handle, setup };
}

/**
 * A definite failed start (decision 202): the recorded shell is closed and the worktree removed only
 * when that shell is its one terminal; anything else stays, named for the starter.
 */
async function removeFailed(orca: OrcaAdapter, tree: string, shell: string | undefined): Promise<string | null> {
  const list = await orca.terminalList({ worktree: `id:${tree}` });
  if (!list.ok || list.value.truncated || list.value.nonLocal.rows > 0) return `남은 worktree: ${tree} (터미널을 다 읽지 못했다)`;
  const others = list.value.rows.filter((t) => t.handle !== shell);
  if (others.length > 0) return `남은 worktree: ${tree} (기록하지 않은 터미널 ${others.map((t) => t.handle).join(" · ")})`;
  if (shell && list.value.rows.length > 0) {
    const closed = await orca.terminalClose({ terminal: shell });
    if (!closed.ok) return `남은 worktree: ${tree} (셸 ${shell} 을 닫지 못했다: ${closed.error.code})`;
  }
  const rm = await orca.worktreeRm({ worktree: `id:${tree}` });
  return rm.ok ? null : `남은 worktree: ${tree} (worktree rm 실패: ${rm.error.code})`;
}

/** The target repo item_create recorded for this Task, the latest one. */
export function storedRepo(store: Pick<StartPorts["store"], "events">, task: string): string | undefined {
  const last = store
    .events({ type: "item_extra_set" })
    .filter((e) => e.payload.task === task && typeof e.payload.repo === "string")
    .at(-1)?.payload.repo;
  return typeof last === "string" ? last : undefined;
}
