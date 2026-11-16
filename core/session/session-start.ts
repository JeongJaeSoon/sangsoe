import { answerNotifiedKey, dedupeKey, dedupeSegment, EVENTS } from "../contract/index.ts";
import { type AdvisorRoute, isEffort, rowLines } from "../models/index.ts";
import type { CoreDeps } from "../notify/result.ts";
import { decision as decisionView } from "../store/views/decision.ts";
import { roleLine } from "../start/start.ts";
import type { Role } from "../start/types.ts";
import { VERSION } from "../version.ts";
import { handoffSubject } from "./handoff.ts";
import { agentRole, type Located, liveWorktree, locate, readRoleLine } from "./locate.ts";
import { type SessionHookInput, type SessionRow, toSessionRow } from "./session.ts";

const SOURCE = "SessionStart";

export interface SessionStartOptions {
  /** The version in this plugin's plugin.json; undefined when it could not be read. */
  readonly pluginVersion?: string | undefined;
  /** The session's own Orca terminal handle (`ORCA_TERMINAL_HANDLE`), read by UserPromptSubmit (decision 280). */
  readonly terminal?: string | undefined;
  /** The plugin's agent definition body for a role, injected when the role was taken without --agent (decision 333). */
  readonly agentDefinition?: ((role: Role) => string | undefined) | undefined;
  /** false: a later hook registers the session and prints nothing, so no handoff or answer is marked delivered. */
  readonly deliver?: boolean;
  /** The hook that writes the row when it is not SessionStart, so the row says which hook ran. */
  readonly writer?: string;
}

/** Decision 333: the starts that carry on a session that ran before; `startup` is a new one (decision 192). */
const CARRY_ON = new Set(["resume", "clear", "compact"]);

/**
 * The SessionStart hook: finds out whether this is a session sangsoe started, records it, and returns
 * the lines to inject, in order: role line, Run, the Run's last handoff (once), a version mismatch, late
 * answers (once per Task). A session the owner opened by hand gets nothing (#485). Without MCP: the
 * server is not up yet at SessionStart (decision 75 나).
 */
export async function sessionStart(deps: CoreDeps, input: SessionHookInput, opts: SessionStartOptions = {}): Promise<string[]> {
  const { store, orca } = deps;
  const declared = agentRole(input.agent_type);
  const loc = await locate(orca, input.cwd ?? "");
  let role = declared ?? readRoleLine(loc?.spec);
  let worktree: Promise<string | undefined> | undefined;
  const liveHere = () => (worktree ??= liveWorktree(orca, input.cwd));
  let took: Took | undefined;
  if (!role && !loc && CARRY_ON.has(input.source ?? "")) {
    const t = await carriedOn(store, input.session_id, opts.terminal, liveHere);
    if (t && "roles" in t) {
      return [`sangsoe: 이 worktree 에서 앞서 돈 세션의 역할이 여럿(${t.roles.join(", ")})이라 역할을 잇지 않았다. --agent sangsoe:<role> 로 다시 띄운다.`];
    }
    if (t) {
      role = t.role;
      took = t;
    }
  }
  if (!role) {
    // Only a Task sangsoe made is its to flag; a Dispatch another tool started is left alone (decisions 46, 192).
    if (!loc || !store.events({ type: "item_created" }).some((e) => e.entity_id === loc.task)) return [];
    store.append({
      type: "worker_stuck",
      source: SOURCE,
      entity: "task",
      entity_id: loc.task,
      dedupe_key: dedupeKey(EVENTS.worker_stuck, loc.task, "no_role_line"),
      payload: { reason: "no_role_line" },
    });
    return [`sangsoe: Task ${loc.task} 의 spec 첫 줄에 역할 줄이 없다(worker_stuck no_role_line). 리드에게 알리고 기다린다.`];
  }

  const current = await orca.runCurrent();
  const held = current.ok && typeof current.value.runId === "string" && current.value.runId !== "" ? current.value.runId : undefined;
  // A session with no Task is told apart from another of its role by where it runs (decision 273).
  const here = !loc && role !== "worker" ? await liveHere() : undefined;
  const before = previous(deps, role, loc, here, took ? [input.session_id, took.from] : [input.session_id]);
  store.append({
    type: "session_started",
    source: opts.writer ?? SOURCE,
    ...(loc ? { entity: "task", entity_id: loc.task, subject: `run:${loc.run}` } : {}),
    ...(held ? { target: `run:${held}` } : {}),
    dedupe_key: dedupeKey(EVENTS.session_started, input.session_id, input.source ?? "startup"),
    payload: {
      session: input.session_id,
      role,
      model: input.model ?? "unknown",
      ...(here ? { worktree: here } : {}),
      ...(opts.terminal ? { terminal: opts.terminal } : {}),
    },
  });
  if (took && took.by !== "session") {
    store.append({
      type: "session_continued",
      source: SOURCE,
      dedupe_key: dedupeKey(EVENTS.session_continued, input.session_id, input.source ?? "startup"),
      payload: { from: took.from, to: input.session_id, by: took.by },
    });
  }

  const lines = [`${roleLine(role)}${loc ? ` · Task ${loc.task} · Dispatch ${loc.dispatch} · Run ${loc.run}` : ""}`];
  const definition = took ? opts.agentDefinition?.(role) : undefined;
  if (definition) lines.push(definition);
  if (loc) lines.push(...unitRowLines(store, loc.task));
  const run = held ?? before;
  if (held) lines.push(`Run ${held} 을 쥐고 있다(run-current).`);
  else if (before && role !== "worker") lines.push(`run-current 가 비었다. 자기 Run 을 다시 쥔다: orca orchestration run-use --id ${before}`);
  // Every read comes before the first `notified` row, so a failure while reading marks nothing delivered.
  // A session with a Dispatch saved its handoff in that Dispatch's Run under its Task (handoff_save).
  const deliver = opts.deliver !== false;
  const handoff = !deliver
    ? undefined
    : loc
      ? await lastHandoff(deps, loc.run, input.session_id, handoffSubject(loc.task))
      : run
        ? await lastHandoff(deps, run, input.session_id, "handoff")
        : undefined;
  const late = loc && deliver ? lateAnswers(deps, loc.task, input.session_id) : [];
  if (handoff) lines.push(...handoff());
  if (opts.pluginVersion && opts.pluginVersion !== VERSION) {
    lines.push(`sangsoe 버전 어긋남: Claude Code plugin ${opts.pluginVersion} ≠ 코어 ${VERSION}. 오너에게 sangsoe install 을 알린다.`);
  }
  for (const deliver of late) lines.push(...deliver());
  return lines;
}

/**
 * Decision 200: the row start_unit recorded for this start (before worker-start), as the budget and
 * finish lines it asks for. The recorded route and budget, not the table: an advisor that did not
 * attach (route none) gets no budget line.
 */
function unitRowLines(store: CoreDeps["store"], task: string): string[] {
  const p = store.events({ type: "unit_started" }).filter((e) => e.entity_id === task).at(-1)?.payload;
  const effort = String(p?.effort ?? "");
  if (!p || !isEffort(effort)) return [];
  return rowLines({ effort, route: p.route as AdvisorRoute, budget: Number(p.budget), budget_per: p.budget_per === "day" ? "day" : "unit" });
}

/** A line to inject, written as `notified` only when it is taken; empty when it already rode once. */
type Delivery = () => string[];

/**
 * The Run an earlier session of the same Task held. Without a Task: the Run this same session held
 * last (a resume keeps the session id, also in a folder Orca does not list, decision 303), else the
 * Run an earlier session of the same role held in the same Orca worktree (decision 273). The role
 * alone would hand a new orchestrator in another worktree someone else's Run; a worktree that cannot
 * be read names none.
 */
function previous(deps: CoreDeps, role: Role, loc: Located | undefined, here: string | undefined, sessions: readonly string[]): string | undefined {
  const events = deps.store.events({ type: "session_started" });
  const last = (rows: SessionRow[]) => rows.reverse().find((r) => r.heldRun)?.heldRun;
  if (loc) return last(events.map(toSessionRow).filter((r) => r.task === loc.task));
  // A worker takes no Run back, and must not use up its Run's handoff. A session carried on from
  // another (decision 333) takes that one's Run as its own.
  const own =
    role === "worker"
      ? undefined
      : last(events.filter((e) => sessions.includes(String(e.payload.session))).map(toSessionRow).filter((r) => r.task === undefined && r.role === role));
  return own ?? last(events.map(toSessionRow).filter((r) => r.task === undefined && r.role === role && here !== undefined && r.worktree === here));
}

/** Whose role a session that came back without --agent takes, and how it was found (decision 333). */
type Took = { role: Role; from: string; by: "session" | "terminal" | "worktree" };

/**
 * Decision 333: the session that ran before this one, among rows with no Task: this same session id
 * (a resume, in any terminal), else the last session in this Orca terminal (a /clear), else the
 * sessions in this Orca worktree (a resume under a new id in a new terminal), only while they all had
 * one role. Two roles in one worktree name none: a lead taken for the orchestrator would answer
 * decisions (decision 173).
 */
async function carriedOn(
  store: CoreDeps["store"],
  session: string,
  terminal: string | undefined,
  liveHere: () => Promise<string | undefined>,
): Promise<Took | { roles: Role[] } | undefined> {
  const rows = store.events({ type: "session_started" }).filter((e) => e.entity !== "task");
  const took = (e: (typeof rows)[number] | undefined, by: Took["by"]): Took | undefined =>
    e ? { role: e.payload.role as Role, from: String(e.payload.session), by } : undefined;
  const own = took(rows.findLast((e) => e.payload.session === session), "session");
  if (own) return own;
  const inTerminal = terminal ? took(rows.findLast((e) => e.payload.terminal === terminal), "terminal") : undefined;
  if (inTerminal) return inTerminal;
  const here = await liveHere();
  if (!here) return undefined;
  const there = rows.filter((e) => e.payload.worktree === here);
  const roles = [...new Set(there.map((e) => e.payload.role as Role))];
  return roles.length > 1 ? { roles } : took(there.at(-1), "worktree");
}

async function lastHandoff(deps: CoreDeps, run: string, session: string, subject: string): Promise<Delivery | undefined> {
  const box = await deps.orca.inbox({ terminal: `run:${run}`, limit: 50 });
  if (!box.ok) return undefined;
  const last = box.value.filter((m) => m.type === "handoff" && m.subject === subject).at(-1);
  const body = last?.body;
  if (!last || !body) return undefined;
  return () => {
    const r = deps.store.append({
      type: "notified",
      source: SOURCE,
      target: run,
      dedupe_key: `notify:${dedupeSegment(run)}:handoff:${dedupeSegment(last.id)}`,
      payload: { msg_id: last.id, to: `session:${session}`, msg_type: "handoff" },
    });
    return r.inserted ? [`인계(handoff ${last.id}, 한 번만 싣는다):`, body] : [];
  };
}

/** Decision 91④(i): an answer this Task waited on and was never told, under U8's key, so it rides once. */
function lateAnswers(deps: CoreDeps, task: string, session: string): Delivery[] {
  const events = deps.store.events();
  const rows = decisionView({ orca: { tasks: [], gates: [] }, events, now: "1970-01-01T00:00:00Z" });
  return rows
    .filter((d) => d.closedReason === "answered" && d.answer !== null && d.waiters.some((w) => w.task === task))
    .map((d) => () => {
      const key = answerNotifiedKey(d.decision, task);
      const r = deps.store.append({
        type: "notified",
        source: SOURCE,
        target: key.target,
        dedupe_key: key.dedupe_key,
        payload: { msg_id: `inject:${session}`, to: `session:${session}`, msg_type: "decision_gate" },
      });
      return r.inserted ? [`늦게 도착한 답(결정 91 ④): ${d.decision}: ${d.answer}`] : [];
    });
}
