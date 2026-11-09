import { answerNotifiedKey, dedupeKey, dedupeSegment, EVENTS } from "../contract/index.ts";
import type { CoreDeps } from "../notify/result.ts";
import { decision as decisionView } from "../store/views/decision.ts";
import { roleLine } from "../start/start.ts";
import type { Role } from "../start/types.ts";
import { VERSION } from "../version.ts";
import { agentRole, type Located, locate, readRoleLine } from "./locate.ts";
import { type SessionHookInput, toSessionRow } from "./session.ts";

const SOURCE = "SessionStart";

export interface SessionStartOptions {
  /** The version in this plugin's plugin.json; undefined when it could not be read. */
  readonly pluginVersion?: string | undefined;
}

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
  const role = declared ?? readRoleLine(loc?.spec);
  if (!role) {
    if (!loc) return [];
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
  const before = previous(deps, role, loc);
  store.append({
    type: "session_started",
    source: SOURCE,
    ...(loc ? { entity: "task", entity_id: loc.task, subject: `run:${loc.run}` } : {}),
    ...(held ? { target: `run:${held}` } : {}),
    dedupe_key: dedupeKey(EVENTS.session_started, input.session_id, input.source ?? "startup"),
    payload: { session: input.session_id, role, model: input.model ?? "unknown" },
  });

  const lines = [`${roleLine(role)}${loc ? ` · Task ${loc.task} · Dispatch ${loc.dispatch} · Run ${loc.run}` : ""}`];
  const run = held ?? before;
  if (held) lines.push(`Run ${held} 을 쥐고 있다(run-current).`);
  else if (before && role !== "worker") lines.push(`run-current 가 비었다. 자기 Run 을 다시 쥔다: orca orchestration run-use ${before}`);
  if (run) lines.push(...(await lastHandoff(deps, run, input.session_id)));
  if (opts.pluginVersion && opts.pluginVersion !== VERSION) {
    lines.push(`sangsoe 버전 어긋남: Claude Code plugin ${opts.pluginVersion} ≠ 코어 ${VERSION}. 오너에게 sangsoe install 을 알린다.`);
  }
  if (loc) lines.push(...lateAnswers(deps, loc.task, input.session_id));
  return lines;
}

/** The Run an earlier session of the same Task (or, without a Task, the same role) held. */
function previous(deps: CoreDeps, role: Role, loc: Located | undefined): string | undefined {
  const rows = deps.store.events({ type: "session_started" }).map(toSessionRow);
  const same = rows.filter((r) => (loc ? r.task === loc.task : r.task === undefined && r.role === role));
  return same.reverse().find((r) => r.heldRun)?.heldRun;
}

async function lastHandoff(deps: CoreDeps, run: string, session: string): Promise<string[]> {
  const box = await deps.orca.inbox({ terminal: `run:${run}`, limit: 50 });
  if (!box.ok) return [];
  const last = box.value.filter((m) => m.type === "handoff").at(-1);
  if (!last?.body) return [];
  const r = deps.store.append({
    type: "notified",
    source: SOURCE,
    target: run,
    dedupe_key: `notify:${dedupeSegment(run)}:handoff:${dedupeSegment(last.id)}`,
    payload: { msg_id: last.id, to: `session:${session}`, msg_type: "handoff" },
  });
  return r.inserted ? [`인계(handoff ${last.id}, 한 번만 싣는다):`, last.body] : [];
}

/** Decision 91④(i): an answer this Task waited on and was never told, under U8's key, so it rides once. */
function lateAnswers(deps: CoreDeps, task: string, session: string): string[] {
  const events = deps.store.events();
  const rows = decisionView({ orca: { tasks: [], gates: [] }, events, now: "1970-01-01T00:00:00Z" });
  const out: string[] = [];
  for (const d of rows) {
    if (d.closedReason !== "answered" || d.answer === null || !d.waiters.some((w) => w.task === task)) continue;
    const key = answerNotifiedKey(d.decision, task);
    const r = deps.store.append({
      type: "notified",
      source: SOURCE,
      target: key.target,
      dedupe_key: key.dedupe_key,
      payload: { msg_id: `inject:${session}`, to: `session:${session}`, msg_type: "decision_gate" },
    });
    if (r.inserted) out.push(`늦게 도착한 답(결정 91 ④): ${d.decision}: ${d.answer}`);
  }
  return out;
}
