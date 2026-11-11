import { itemFacts } from "../../brief/item_status.ts";
import { briefRuns } from "../../brief/load.ts";
import { dedupeSegment, type ViewGate, type ViewInput } from "../../contract/index.ts";
import { decisionAnswer } from "../../decision/answer.ts";
import { decisionMoot } from "../../decision/moot.ts";
import { isOpenGate } from "../../decision/waiters.ts";
import type { GhClient } from "../../gh/client.ts";
import { notifyReady } from "../../graph/notify-ready.ts";
import { type RereviewResult, rereviewItems } from "../../graph/rereview.ts";
import { readSnapshot } from "../../graph/snapshot.ts";
import { syncGraph } from "../../graph/sync.ts";
import { probeRound } from "../../owner/probe.ts";
import { recordUnreleased, unreleasedWaits } from "../../owner/release.ts";
import { OWNER_DEFAULTS } from "../../owner/types.ts";
import type { Appended } from "../../store/store.ts";
import type { Act, MonitorDeps, Planned, Reading } from "../monitor.ts";
import { orchestratorRun, runAbove, sendNotice } from "../notice.ts";
import { judgeDrift } from "./drift.ts";
import { judgeQueue, QUEUE_SOURCE } from "./judge.ts";
import { judgeStall } from "./stall.ts";

/**
 * The Run the queue-monitor passes as its caller: none. The plugin worker holds no Run, and
 * gate-resolve works only inside the gate's own Run (decision 77 라), so `release` hands every open
 * gate to the session holding its Run, which resolves it with the same call (decision 0148).
 */
export const QUEUE_CALLER = "monitor:queue";

const NO_GH: GhClient = { get: async () => ({ kind: "error", status: null, message: "no gh client in this round" }) };

/**
 * One queue-monitor round (decision 91, design #monitors): reads the Runs events name, judges, then
 * calls the core functions that own each rule. It writes signals and suggestions, and the one Task
 * kind GRAPH makes on its own, a re-review item (decision 215): no Task is closed or updated here,
 * and a gate is resolved only by a function's own rules (decision 76 rule 6).
 * Without `d.core` (a dry run) it reads everything and names each call it would make.
 */
export async function queueRound(d: MonitorDeps, signal: AbortSignal): Promise<Reading> {
  const planned: Planned[] = [];
  const unseen: string[] = [];
  const calls: string[] = [];
  const events = d.events();
  // The same Runs the brief reads: the caller's current Run (none in the plugin worker) and every Run an event names.
  const current = await d.orca.runCurrent();
  const runs = briefRuns(events, current.ok ? current.value.runId : null);
  const snap = await readSnapshot(d.orca, runs);
  for (const u of snap.unread) unseen.push(`task-list ${u.run}`);
  const gates: ViewGate[] = [];
  for (const run of runs) {
    if (signal.aborted) break;
    const g = await d.orca.gateList({ run });
    if (!g.ok) unseen.push(`gate-list ${run}`);
    else gates.push(...g.value.map((x) => ({ id: x.id, taskId: x.taskId ?? "", open: isOpenGate(x) })));
  }
  const input: ViewInput = { orca: { tasks: snap.snapshot.tasks, gates }, events, now: new Date(d.now()).toISOString() };
  const j = judgeQueue(input, d.config);
  planned.push(...j.planned);
  // Probe and wait writers take a store's append; the round collects their rows so a dry run shows them.
  const collect = {
    append: (e: Planned): Appended => {
      planned.push(e);
      return { seq: 0, inserted: true };
    },
  };
  const core = d.core;
  let fenced: RereviewResult["fenced"] = [];

  if (core) {
    const s = syncGraph(core, input.orca, [], { infer: true });
    calls.push(`graph sync: added ${s.added.length}, unstacked ${s.unstacked.length}, reland ${s.relandPrs.length}, dangling ${s.dangling.length}, refused ${s.refused.length}`);
    if (!signal.aborted) {
      const rr = await rereviewItems(core, input.orca);
      calls.push(`rereview items: made ${rr.made.length}${rr.made.length ? ` (${rr.made.join(", ")})` : ""}, refused ${rr.refused.length}, fenced ${rr.fenced.length}`);
      fenced = rr.fenced;
      unseen.push(...rr.refused.map((x) => `re-review item ${x}`));
    }
  } else calls.push("would call graph sync", "would call rereview items");

  if (j.ready.length > 0) {
    const runOf = new Map(input.orca.tasks.map((t) => [t.id, t.runId]));
    if (core && !signal.aborted) {
      const notices = await notifyReady(core, input, (task) => {
        const run = runOf.get(task);
        return run ? { leadRun: run } : undefined;
      });
      const told = new Set(notices.filter((n) => n.status === "sent" || n.status === "already").map((n) => n.task));
      planned.push(...j.ready.filter((r) => told.has(r.task)).map((r) => r.event));
      calls.push(...notices.map((n) => `notifyReady ${n.item}: ${n.status}${n.detail ? ` ${n.detail}` : ""}`));
    } else {
      planned.push(...j.ready.map((r) => r.event));
      calls.push(...j.ready.map((r) => `would call notifyReady ${r.item} (lead of ${runOf.get(r.task) ?? "?"})`));
    }
  }

  const budget = d.ghBudget?.();
  const repos = d.watch?.()?.repos;
  const ports = { orca: d.orca, gh: d.gh ?? NO_GH, ...(budget ? { budget } : {}), ...(repos ? { repos } : {}) };
  const probes = await probeRound(ports, collect, input, itemFacts(input), OWNER_DEFAULTS, QUEUE_SOURCE);
  calls.push(`probeRound: read ${probes.read}, passed ${probes.passed.length}, skipped ${probes.skipped.length}`);
  if (!d.gh) unseen.push("gh client");

  // waiting_human rows come from this machine's hooks or its orca-monitor, which drops other hosts' rows,
  // so each wait is local (decisions 88, 196).
  const waits = unreleasedWaits(input, () => true, OWNER_DEFAULTS);
  for (const w of waits) recordUnreleased(collect, w, undefined, QUEUE_SOURCE);
  if (waits.length > 0) unseen.push("screen excerpt: the Orca adapter has no terminal read");

  for (const m of j.moot) {
    if (signal.aborted) break;
    const ev = m.evidence.kind === "pr_closed" ? `pr_closed:${m.evidence.pr}` : "tasks_closed";
    if (!core) {
      calls.push(`would call decision_moot ${m.decision} (${ev})`);
      continue;
    }
    const r = await decisionMoot(core, { decision: m.decision, evidence: m.evidence, callerRun: QUEUE_CALLER });
    calls.push(`decision_moot ${m.decision} (${ev}): ${r.ok ? `${r.value.status}, handed off ${r.value.handedOff.length}` : r.refusal.code}`);
  }

  for (const a of j.reanswer) {
    if (signal.aborted) break;
    if (!core) {
      calls.push(`would call decision_answer ${a.decision} again (gate still open)`);
      continue;
    }
    const r = await decisionAnswer(core, { ...a, callerRun: QUEUE_CALLER });
    calls.push(`decision_answer ${a.decision} again: ${r.ok ? `${r.value.status}, handed off ${r.value.handedOff.length}, told ${r.value.notified.length}` : r.refusal.code}`);
  }

  const above = runAbove(d.orca);
  const told = new Set(events.flatMap((e) => (e.type === "notified" && e.dedupe_key ? [e.dedupe_key] : [])));
  for (const s of j.stale) {
    planned.push(s.event);
    // Raised already: the gate stays open, but the Run lookup (a paged worker list) is not read again.
    if (told.has(`${s.handoffKey}:${dedupeSegment("orchestrator")}`)) continue;
    const a = await above(s.run);
    if (a.kind !== "above") {
      unseen.push(`Run above ${s.run}${a.kind === "top" ? ": none, its coordinator is no Dispatch" : ""}`);
      continue;
    }
    const up = a.run;
    const r = await sendNotice(d, {
      key: { target: s.task, dedupe_key: s.handoffKey },
      to: "orchestrator",
      chain: { leadRun: s.run, orchestratorRun: up },
      subject: `${s.decision}: answer not delivered`,
      body: `${s.decision} is answered but the gate on ${s.task} in ${s.run} is still open after the handoff to that Run.`,
      escalate: true,
      source: QUEUE_SOURCE,
    });
    calls.push(`raise ${s.decision} on ${s.task} to run:${up}: ${r.detail}`);
  }

  if (d.coreVersion) {
    const pl = await d.orca.pluginList();
    if (!pl.ok) unseen.push("plugin list");
    else {
      const drift = judgeDrift(pl.value, d.coreVersion);
      if (drift) planned.push(drift);
    }
  } else unseen.push("core version");

  const have = new Set(events.flatMap((e) => (e.dedupe_key ? [e.dedupe_key] : [])));
  const fresh = planned.filter((e) => !e.dedupe_key || !have.has(e.dedupe_key));
  const runOf = new Map(input.orca.tasks.map((t) => [t.id, t.runId]));
  const acts: Act[] = [];
  // A row already written whose notice never went (a failed send) is offered again; notify keeps it to one.
  for (const e of planned) {
    const n = leadNotice(e);
    if (!n || have.has(n.key)) continue;
    const lead = runOf.get(n.task);
    if (!lead) {
      unseen.push(`owning lead of ${n.task}`);
      continue;
    }
    acts.push({
      what: `notify run:${lead} ${n.subject}`,
      run: async (dd) => ({
        ...(await sendNotice(dd, {
          key: { target: n.task, dedupe_key: n.key },
          to: "lead",
          chain: { leadRun: lead },
          subject: n.subject,
          body: n.body,
          msgType: n.msgType,
          source: QUEUE_SOURCE,
        })),
        planned: [],
      }),
    });
  }
  // Decision 217: Orca lets only the session bound to a Run write to it, so a re-review item fenced
  // out of the lead's Run becomes one wake per base change, asking that session to make it.
  for (const f of fenced) {
    const key = `notify:${dedupeSegment(f.task)}:rereview_fenced:${dedupeSegment(f.pr)}:${f.seq}`;
    if (have.has(key)) continue;
    acts.push({
      what: `wake run:${f.run} to make the re-review item of ${f.pr}`,
      wake: true,
      run: async (dd) => ({
        ...(await sendNotice(dd, {
          key: { target: f.task, dedupe_key: key },
          to: "lead",
          chain: { leadRun: f.run },
          subject: `🔁 rereview_item: ${f.pr}`,
          body: `The base of ${f.pr} changed, and its re-review item can only be made from this Run's session. Run: sangsoe graph sync --run ${f.run}`,
          msgType: "status",
          source: QUEUE_SOURCE,
        })),
        planned: [],
      }),
    });
  }
  return { planned: fresh, unseen, calls, acts };
}

/** `msgType` is one of Orca's closed `send --type` set; the event name rides in the subject. */
type LeadNotice = { task: string; key: string; subject: string; body: string; msgType: "status" };

/**
 * The rows whose notice goes to the item's owning lead (decision 154): todo_due and trigger_unclear
 * (appendix queue-monitor card), escalation_stale{verify_unconfirmed} (decision 91② row 11). One
 * notice per row: the key carries the row's own condition.
 */
function leadNotice(e: Planned): LeadNotice | undefined {
  const p = e.payload as Record<string, unknown>;
  const seg = dedupeSegment;
  if (e.type === "todo_due" || e.type === "trigger_unclear") {
    const task = String(p.task);
    const cond = (e.dedupe_key ?? "").split(":").slice(2);
    const key = [`notify:${seg(task)}`, e.type, ...cond].join(":");
    return e.type === "todo_due"
      ? { task, key, subject: `📅 todo_due: ${task}`, body: `The owner item ${task} has reached its date; bring it to the owner.`, msgType: "status" }
      : { task, key, subject: `⚠️ trigger_unclear: ${task}`, body: `The trigger of ${task} is text a script cannot read; decide whether it has come.`, msgType: "status" };
  }
  if (e.type === "escalation_stale" && p.reason === "verify_unconfirmed") {
    const task = String(p.ref);
    const key = `notify:${seg(task)}:verify_unconfirmed:${(e.dedupe_key ?? "").split(":").pop() ?? ""}`;
    // status, not escalation: queue-monitor holds no Dispatch, and Orca refuses an escalation from such a sender (decision 197).
    return { task, key, subject: `🔍 verify_unconfirmed: ${task}`, body: `The owner's input on ${task} is still not verified by its probe; check it or ask the owner.`, msgType: "status" };
  }
  return undefined;
}

export type StallReport = { planned: Planned[]; written: { type: string; seq: number; inserted: boolean }[]; calls: string[] };

/**
 * The timer-stall check (decision 83). Run from Orca events and panel refreshes, never from a timer,
 * so a stopped timer cannot hide its own stall. Each stall is written once and the orchestrator is
 * told once under a key bound to it; a re-check after a crash finishes the notice.
 */
export async function stallCheck(d: MonitorDeps): Promise<StallReport> {
  const planned = judgeStall(d.events({ type: "reap_round" }), d.now(), d.config.reaperIntervalMinutes * 60_000, d.openedAt);
  const written: StallReport["written"] = [];
  const calls: string[] = [];
  let top: Promise<string | undefined> | undefined;
  for (const e of planned) {
    const reason = String((e.payload as { reason?: unknown }).reason);
    let key: string | undefined;
    if (d.append) {
      const a = d.append(e);
      written.push({ type: e.type, seq: a.seq, inserted: a.inserted });
      key = `notify:${dedupeSegment("reaper")}:stalled:${a.seq}`;
      // Told already: the orchestrator lookup (a paged worker list) is not read again on every re-check.
      if (d.events({ type: "notified" }).some((n) => n.dedupe_key === key)) continue;
    }
    top ??= orchestratorRun(d.events(), runAbove(d.orca));
    const orch = await top;
    if (!orch) {
      calls.push("orchestrator Run unknown: timer_stalled written only");
      continue;
    }
    if (!key) {
      calls.push(`would tell orchestrator run:${orch}: ${reason}`);
      continue;
    }
    const r = await sendNotice(d, {
      key: { target: "reaper", dedupe_key: key },
      to: "orchestrator",
      chain: { orchestratorRun: orch },
      subject: "timer_stalled: reaper",
      body: reason,
      source: "monitor:stall",
    });
    calls.push(`tell orchestrator run:${orch}: ${r.detail}`);
  }
  return { planned, written, calls };
}
