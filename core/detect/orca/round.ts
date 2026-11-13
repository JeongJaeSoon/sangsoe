import { dedupeKey, dedupeSegment, EVENTS } from "../../contract/index.ts";
import type { GateRow, InboxMessage, LocalRows, OrcaResult, WorkerRow, WorkerShow, WorktreePsRow } from "../../contract/orca.ts";
import type { Act, MonitorDeps, Planned, Reading } from "../monitor.ts";
import { runAbove, sendNotice } from "../notice.ts";

type Notice = Parameters<typeof sendNotice>[1];
import { type CoordinatorRead, fromMail, INBOX_PAGE, namedRuns, oldUnread, recipientOf } from "./coordinator.ts";
import { isUnfinished, judgeOrca, keepLastRead, type Observed, ORCA_EVENT_TYPES, observe } from "./judge.ts";
import { readRefusalHead, refusalPath } from "./mail.ts";

// The orca-monitor runs inside the long-lived plugin worker: the last round's Dispatch fields stay
// here, in memory, for observed_change. A restart starts with none and writes no change that round.
let previous: ReadonlyMap<string, Observed> = new Map();
const readRefusal = readRefusalHead();

const value = <T>(r: OrcaResult<T>): T | null => (r.ok ? r.value : null);

// worker-list without --run spans every Run, newest first, settled Dispatches included: a few
// pages find the Runs in flight. A Run's own list is read to the end, since run_stalled needs all
// of its members.
const GLOBAL_PAGES = 3;
const RUN_PAGES = 10;

async function pages(d: MonitorDeps, signal: AbortSignal, max: number, run?: string): Promise<LocalRows<WorkerRow> | null> {
  const ask = (cursor?: string) =>
    d.orca.workerList({ limit: 100, ...(run ? { run } : {}), ...(cursor ? { cursor } : {}) }).then(value);
  const first = await ask();
  if (!first) return null;
  let page: LocalRows<WorkerRow> = first;
  let truncated = first.truncated && !first.nextCursor;
  const rows = new Map(page.rows.map((w) => [w.dispatchId, w]));
  const omitted = new Set(page.omittedHostIds);
  let nonLocal = page.nonLocal.rows;
  const hostIds = new Set(page.nonLocal.hostIds);
  const cursors = new Set<string>();
  for (let n = 1; page.nextCursor && !cursors.has(page.nextCursor) && n < max && !signal.aborted; n++) {
    cursors.add(page.nextCursor);
    const next = await ask(page.nextCursor);
    if (!next) break;
    page = next;
    truncated ||= next.truncated && !next.nextCursor;
    for (const w of next.rows) rows.set(w.dispatchId, w);
    for (const h of next.omittedHostIds) omitted.add(h);
    nonLocal += next.nonLocal.rows;
    for (const h of next.nonLocal.hostIds) hostIds.add(h);
  }
  return {
    rows: [...rows.values()],
    nonLocal: { rows: nonLocal, hostIds: [...hostIds] },
    omittedHostIds: [...omitted],
    // A next page left unread, or a page that said it held back rows without a cursor.
    truncated: truncated || page.nextCursor !== undefined,
  };
}

/**
 * One orca-monitor round: Orca reads through the adapter only, mail through `inbox`, which never
 * marks it handled; then the pure judgment. Rows of other hosts never reach it (decision 88 ①).
 */
export async function orcaRound(d: MonitorDeps, signal: AbortSignal): Promise<Reading> {
  const [ps, workerRows, inbox] = await Promise.all([
    d.orca.worktreePs({ agentWait: true }),
    pages(d, signal, GLOBAL_PAGES),
    d.orca.inbox({ limit: INBOX_PAGE }),
  ]);
  const shows: Record<string, WorkerShow | null> = {};
  for (const w of workerRows?.rows.filter(isUnfinished) ?? []) {
    if (signal.aborted) break;
    shows[w.dispatchId] = value(await d.orca.workerShow({ dispatch: w.dispatchId }));
  }
  const runs: Record<string, LocalRows<WorkerRow> | null> = {};
  const gates: Record<string, GateRow[] | null> = {};
  for (const run of new Set(Object.values(shows).flatMap((s) => (s?.runId ? [s.runId] : [])))) {
    if (signal.aborted) break;
    runs[run] = await pages(d, signal, RUN_PAGES, run);
    gates[run] = value(await d.orca.gateList({ run }));
  }
  const events = ORCA_EVENT_TYPES.flatMap((type) => d.events({ type }));
  const mail = value(inbox);
  const recorded = new Set(events.map((e) => e.dedupe_key));
  const refusals = new Map<string, string | null>();
  for (const m of mail ?? []) {
    const path = refusalPath(m);
    const dispatch = m.payload?.dispatchId;
    if (!path || !dispatch || refusals.has(path) || signal.aborted) continue;
    if (recorded.has(dedupeKey(EVENTS.refusal_report, dispatch, m.id))) continue;
    refusals.set(path, await readRefusal(path));
  }
  // A dry run reads the coordinators even with no old mail, so its report shows whom it would judge.
  const wanted = mail && !signal.aborted && (!d.append || oldUnread(mail, d.now(), d.config).size > 0);
  const coordinators = wanted ? await readCoordinators(d, mail, value(ps), signal) : { coords: new Map(), calls: [] };
  const reads = { ps: value(ps), workers: workerRows, shows, runs, gates, inbox: mail, events, refusals, coordinators: coordinators.coords };
  const reading = judgeOrca(reads, d.now(), d.config, previous);
  if (!signal.aborted) previous = keepLastRead(previous, observe(reads));
  const raise = await wakeRaises(d, reading.planned, signal);
  const stalls = stallNotices(d, reading.planned, coordinators.coords);
  return {
    ...reading,
    unseen: [...reading.unseen, ...raise.unseen, ...stalls.unseen],
    acts: [...(reading.acts ?? []), ...raise.acts, ...stalls.acts],
    calls: [...(reading.calls ?? []), ...coordinators.calls],
  };
}

/**
 * Decision 245: the coordinator of every Run the inbox page names, from Orca only. `run-show`'s
 * handle when it is a live terminal whose pane `worktree ps` shows, else the terminal the Run's own
 * mail to its Dispatches came from (`fromMail`). A Dispatch's worker in that terminal makes it no
 * coordinator of this kind; a worker list cut short leaves that unknown.
 */
async function readCoordinators(
  d: MonitorDeps,
  inbox: readonly InboxMessage[],
  ps: LocalRows<WorktreePsRow> | null,
  signal: AbortSignal,
): Promise<{ coords: Map<string, CoordinatorRead>; calls: string[] }> {
  const coords = new Map<string, CoordinatorRead>();
  const calls: string[] = [];
  const list = value(await d.orca.terminalList({}));
  if (!list) return { coords, calls: ["coordinators: terminal list not read"] };
  const live = new Map(list.rows.map((t) => [t.handle, t]));
  const panes = new Set((ps?.rows ?? []).flatMap((row) => (row.agents ?? []).map((a) => a.paneKey)));
  const workers = await pages(d, signal, RUN_PAGES * 2);
  const busy = workers && !workers.truncated ? new Set(workers.rows.filter(isUnfinished).flatMap((w) => (w.terminal ? [w.terminal] : []))) : undefined;
  for (const run of namedRuns(inbox)) {
    if (signal.aborted) break;
    const show = value(await d.orca.runShow({ id: run }));
    const shown = show?.coordinatorHandle;
    const t = shown ? live.get(shown) : undefined;
    const pane = t?.tabId && t.leafId ? `${t.tabId}:${t.leafId}` : undefined;
    const mail = fromMail(inbox, run);
    const k = pane && panes.has(pane) && t ? { pane, handle: t.handle } : mail && live.has(mail.handle) ? mail : undefined;
    // An unplaced Run could be the orchestrator's, so no top is sure (the stalled Run would tell itself).
    const unresolved = !k && (!show || t !== undefined);
    coords.set(run, k ? { ...k, ...(busy ? { dispatch: busy.has(k.handle) } : {}) } : unresolved ? { unresolved: true } : {});
    const found = k ? `${k.handle} pane ${k.pane}${k === mail ? " (from its mail)" : ""}, dispatch ${busy ? busy.has(k.handle) : "unknown"}` : undefined;
    calls.push(`coordinator run:${run}: ${found ?? (unresolved ? (show ? `${shown} live but no ps pane` : "run-show not read") : "no live terminal")}`);
  }
  return { coords, calls };
}

/**
 * Decision 245: one notice per coordinator stall, keyed by the stall's row so a later round is
 * notify's "already". Its first line names the Run and the coordinator, so a wrong recipient knows.
 */
function stallNotices(d: MonitorDeps, planned: readonly Planned[], coords: ReadonlyMap<string, CoordinatorRead>): { acts: Act[]; unseen: string[] } {
  const acts: Act[] = [];
  const unseen: string[] = [];
  for (const e of planned) {
    const p = e.payload as { run?: string; coordinator?: string };
    if (e.type !== "run_stalled" || !p.run || !p.coordinator) continue;
    const { run, coordinator } = p;
    const to = recipientOf(run, coords);
    if (!to) {
      unseen.push(`orchestrator Run not single: run_stalled ${run} written only`);
      continue;
    }
    acts.push({
      what: `tell run:${to}: run ${run} stalled`,
      wake: true,
      run: async (dd) => ({
        ...(await sendNotice(dd, {
          key: { target: run, dedupe_key: `notify:${dedupeSegment(run)}:${dedupeSegment(e.dedupe_key ?? run)}` },
          to: "orchestrator",
          chain: { orchestratorRun: to },
          subject: `⏸ run_stalled: ${run}`,
          body: `run:${run} coordinator ${coordinator} stalled.\nMail to that Run has sat unread ${d.config.stuckMinutes}+ minutes and its coordinator has not worked since it arrived.`,
          msgType: "status",
          source: "orca-monitor",
        })),
        planned: [],
      }),
    });
  }
  return { acts, unseen };
}

const TIER_SUFFIX = /:(worker|lead|orchestrator)$/;

/**
 * Design N3: an unread wake goes one tier up the receiving order, through notify's escalation under
 * the told row's own key, so one condition reaches each tier once. The next tier is read from where
 * the unread row went: a Dispatch's Run, or the Run above a Run. `status`, since the monitor holds no
 * Dispatch (decision 197 ⑥). The orchestrator has no one above it in the order: the row stays the signal.
 */
async function wakeRaises(d: MonitorDeps, planned: readonly Planned[], signal: AbortSignal): Promise<{ acts: Act[]; unseen: string[] }> {
  const acts: Act[] = [];
  const unseen: string[] = [];
  const wakes = planned.filter((e) => e.type === "wake_unconfirmed");
  if (wakes.length === 0) return { acts, unseen };
  const told = d.events({ type: "notified" });
  const keys = new Set(told.flatMap((e) => (e.dedupe_key ? [e.dedupe_key] : [])));
  const above = runAbove(d.orca);
  for (const w of wakes) {
    if (signal.aborted) break;
    const msg = String((w.payload as { msg_id: string }).msg_id);
    const row = told.find((e) => e.payload.msg_id === msg);
    if (!row?.dedupe_key || !row.target) continue;
    const tier = TIER_SUFFIX.exec(row.dedupe_key)?.[1];
    if (tier === "orchestrator") continue;
    const base = row.dedupe_key.replace(TIER_SUFFIX, "");
    const to = String(row.payload.to);
    let chain: Notice["chain"];
    let next: Notice["to"];
    if (to.startsWith("dispatch:")) {
      if (keys.has(`${base}:${dedupeSegment("lead")}`)) continue;
      const dispatch = to.slice("dispatch:".length);
      const s = await d.orca.workerShow({ dispatch });
      if (!s.ok || !s.value.runId) {
        unseen.push(`Run of ${dispatch} for wake ${msg}`);
        continue;
      }
      chain = { dispatch, leadRun: s.value.runId };
      next = "lead";
    } else {
      if (keys.has(`${base}:${dedupeSegment("orchestrator")}`)) continue;
      const run = to.slice("run:".length);
      const a = await above(run);
      if (a.kind !== "above") {
        unseen.push(`Run above ${run} for wake ${msg}${a.kind === "top" ? ": none, its coordinator is no Dispatch" : ""}`);
        continue;
      }
      chain = { leadRun: run, orchestratorRun: a.run };
      next = "orchestrator";
    }
    const target = row.target;
    acts.push({
      what: `raise unread ${msg} (${to}) to ${next}`,
      wake: true,
      run: async (dd) => ({
        ...(await sendNotice(dd, {
          key: { target, dedupe_key: base },
          to: next,
          chain,
          subject: `⏰ wake_unconfirmed: ${target}`,
          body: `${msg} to ${to} is still unread after ${d.config.wakeMinutes} minutes.`,
          escalate: true,
          msgType: "status",
          source: "orca-monitor",
        })),
        planned: [],
      }),
    });
  }
  return { acts, unseen };
}
