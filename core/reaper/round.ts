import { existsSync } from "node:fs";
import { judgeLoad, type LoadSample } from "../capacity/capacity.ts";
import { dedupeKey, eventDef, type EventType, type StoredEvent } from "../contract/index.ts";
import type { Exec, OrcaAdapter, WorkerRow, WorktreeRow } from "../contract/orca.ts";
import type { Planned } from "../detect/monitor.ts";
import type { GhClient } from "../gh/client.ts";
import { settled } from "../recover/recover.ts";
import type { Appended, EventFilter } from "../store/store.ts";
import { type Check, type BlockReason as CheckReason, evidenceInWorktree, openWork, preDelete } from "./checks.ts";
import type { ReaperConfig, ReaperConfigRead } from "./config.ts";
import { type DockerState, dockerState, sweepDocker } from "./docker.ts";
import { branchOf, type Finished, judgeFinished, NO_TRACE, repoOf, withRemoteCase } from "./finished.ts";
import { composeRunning, listening, readStacks, type Stacks } from "./live.ts";
import { blockedKey, dockerHolds, goneRow, type Hold, holdEvents } from "./record.ts";

/**
 * The only Orca calls REAPER has: reads, the one removal, and closing a setup shell start_unit
 * recorded (decision 202). No other terminal is ever closed here.
 */
export type ReaperOrca = Pick<
  OrcaAdapter,
  "worktreeList" | "worktreePs" | "workerList" | "workerShow" | "taskList" | "ports" | "worktreeRm" | "terminalList" | "terminalClose"
>;

export type ReaperDeps = {
  orca: ReaperOrca;
  gh: GhClient;
  /** `git` for the pre-delete checks and `docker` for recorded ids. */
  exec: Exec;
  events(filter?: EventFilter): StoredEvent[];
  /** Absent on a dry run: the round marks and reports, and never sweeps. */
  append?: (e: Planned) => Appended;
  now(): number;
  /**
   * `absent`: the round is mark-only (decision 174), not a failed root. `unreadable`: a failed root
   * (decision 201), so no shell is closed and nothing removed while the protect list is unknown.
   */
  config: ReaperConfigRead;
  sample(): LoadSample;
  /** The timer period. Absent: no round is judged a catch-up. */
  intervalMs?: number;
};

export type ReapOptions = {
  trigger?: "timer" | "hint";
  markOnly?: boolean;
  signal?: AbortSignal;
  /**
   * Decision 234: card instance ids the owner confirmed on the panel. Only these are judged, in this
   * one round. The confirmation stands in for the two sightings and the grace, for "finished" on a
   * card with no PR and no Dispatch, and for the git checks on a card whose path is gone; every other
   * gate still runs and blocks.
   */
  confirmed?: readonly string[];
  /** Decision 234: judge every candidate's finished state, removing nothing, so the panel can say why. */
  explain?: boolean;
  /**
   * Decision 235: card instance ids a dry run looks at; every other card is left out before the roots,
   * so no GitHub or Orca read is spent on it. A card's verdict reads only its own rows and its own
   * repository, so these cards come out as the whole round would judge them. A round that writes ignores it.
   */
  only?: ReadonlySet<string>;
};

/** One candidate as the panel lists it (decision 234). `no_trace`: no PR and no Dispatch. */
export type Judged = {
  ref: string;
  name: string;
  path: string;
  gone: boolean;
  state: Finished["state"] | "no_trace";
  why: string;
};

export type BlockReason = CheckReason | "in_use" | "archive_hook_failed" | "remote_host" | "config_unreadable" | "repo_unreadable";
export type Blocked = { kind: string; ref: string; reason: BlockReason };

export type ReapReport = {
  round: number;
  trigger: "timer" | "hint";
  roots_ok: boolean;
  /** No `reaper` config section (decisions 144, 174): the round marks and writes no candidate. */
  mark_only: boolean;
  /** What the round could not read or decide; nothing was removed on its account. */
  unseen: string[];
  cards: number;
  marked: string[];
  candidates: string[];
  /** Candidates that passed every gate before the pre-delete checks. */
  targets: string[];
  swept: boolean;
  reaped: string[];
  blocked: Blocked[];
  unknown: string[];
  docker_skipped: boolean;
  /** Timer slots that never ran before this round (Orca was closed); 0 when the round is on time. */
  missed: number;
  /** Setup shells start_unit recorded and this round closed after their units were released (decision 202). */
  shells_closed: string[];
  /** Filled only when `explain` was asked. */
  judged: Judged[];
  planned: Planned[];
};

/**
 * Decision 182: nothing runs while Orca is closed, and the first round after it catches up once.
 * Slots that never ran are counted, not replayed; a gap under two periods is ordinary jitter.
 */
export function missedSlots(rounds: readonly StoredEvent[], now: number, intervalMs: number | undefined): number {
  const last = rounds.at(-1);
  if (!last || !intervalMs) return 0;
  const gap = now - Date.parse(last.ts);
  return gap > 2 * intervalMs ? Math.floor(gap / intervalMs) - 1 : 0;
}

const SOURCE = "reaper";
const WORKER_PAGE = 100;
const WORKER_PAGES = 30;
const PR_PAGES = 10;

const key = (type: EventType, ...parts: string[]) => {
  const def = eventDef(type);
  if (!def) throw new Error(`no event type ${type}`);
  return dedupeKey(def, parts[0] ?? "", ...parts.slice(1));
};

/** Every Dispatch, newest first, or a reason the list is incomplete (then the Task root failed). */
async function allWorkers(orca: ReaperOrca): Promise<WorkerRow[] | string> {
  const rows: WorkerRow[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < WORKER_PAGES; page++) {
    const r = await orca.workerList({ limit: WORKER_PAGE, ...(cursor ? { cursor } : {}) });
    if (!r.ok) return `worker-list: ${r.error.code}`;
    rows.push(...r.value.rows);
    const next = r.value.nextCursor;
    if (!next) return r.value.truncated ? "worker-list truncated without a cursor" : rows;
    if (next === cursor) return "worker-list repeated its cursor";
    cursor = next;
  }
  return `worker-list has more than ${WORKER_PAGES} pages`;
}

/** Head branches of the open PRs of one repository, or null when GitHub did not answer in full. */
async function openPrHeads(gh: GhClient, repo: string): Promise<Set<string> | null> {
  const heads = new Set<string>();
  for (let page = 1; page <= PR_PAGES; page++) {
    const r = await gh.get<{ head?: { ref?: string } }[]>(`repos/${repo}/pulls?state=open&per_page=100&page=${page}`);
    if (r.kind !== "ok" || !Array.isArray(r.data)) return null;
    for (const pr of r.data) if (pr.head?.ref) heads.add(pr.head.ref);
    if (r.data.length < 100) return heads;
  }
  return null;
}

/**
 * Decision 202: `worker-release` never closes the plain shell `worktree create` opened, and a live
 * terminal keeps a card from the reaper. Close that one recorded handle once every Dispatch in its
 * worktree is released, only with no setup script that could still run there, and only while Orca
 * still lists it with no agent in it. Unreadable means not now.
 */
async function closeReleasedShells(
  d: ReaperDeps,
  config: ReaperConfig | null,
  scope: readonly WorktreeRow[],
  workers: readonly WorkerRow[],
): Promise<string[]> {
  // A protected card is the owner's to touch, its shell included.
  const protect = new Set<string | undefined>(config?.protect ?? []);
  const inScope = new Set(scope.filter((c) => !protect.has(c.instanceId) && !protect.has(c.path) && !protect.has(branchOf(c))).map((c) => c.id));
  const closed: string[] = [];
  for (const e of d.events({ type: "unit_started" })) {
    const p = e.payload as { worktree?: string; shell?: string; setup?: string };
    if (!p.worktree || !p.shell || p.setup !== "none" || !inScope.has(p.worktree)) continue;
    const own = workers.filter((w) => w.workspace === p.worktree);
    if (own.length === 0 || !own.every((w) => w.terminalState === "released")) continue;
    const list = await d.orca.terminalList({ worktree: `id:${p.worktree}` });
    if (!list.ok || list.value.truncated || list.value.nonLocal.rows > 0) continue;
    const row = list.value.rows.find((t) => t.handle === p.shell);
    if (!row || row.agentIdentity) continue;
    const r = await d.orca.terminalClose({ terminal: p.shell });
    if (r.ok) closed.push(p.shell);
  }
  return closed;
}

type Sighting = { state: "seen" | "cleared"; round: number; at: number };

function lastSightings(events: readonly StoredEvent[]): Map<string, Sighting> {
  const last = new Map<string, Sighting>();
  for (const e of events) {
    const p = e.payload as { kind: string; ref: string; round: number; state: "seen" | "cleared" };
    last.set(`${p.kind}\n${p.ref}`, { state: p.state, round: p.round, at: Date.parse(e.ts) });
  }
  return last;
}

/**
 * One REAPER round (decisions 82, 83, 86, 88): adopt unrecorded cards, read the roots, mark, record
 * candidates, then sweep only targets that pass every gate. A root that cannot be read ends the
 * round before any candidate row or removal. The only terminal closed here is a released unit's
 * recorded setup shell (decision 202).
 */
export async function reapRound(d: ReaperDeps, o: ReapOptions = {}): Promise<ReapReport> {
  const trigger = o.trigger ?? "timer";
  const signal = o.signal ?? new AbortController().signal;
  const now = d.now();
  const rounds = d.events({ type: "reap_round" });
  const round = 1 + rounds.reduce((m, e) => Math.max(m, Number((e.payload as { round?: number }).round) || 0), 0);
  const config = d.config.kind === "ok" ? d.config.config : null;
  const r: ReapReport = {
    round,
    trigger,
    roots_ok: true,
    mark_only: d.config.kind === "absent",
    unseen: [],
    cards: 0,
    marked: [],
    candidates: [],
    targets: [],
    swept: false,
    reaped: [],
    blocked: [],
    unknown: [],
    docker_skipped: false,
    missed: missedSlots(rounds, now, d.intervalMs),
    shells_closed: [],
    judged: [],
    planned: [],
  };
  const write = (e: Planned) => {
    r.planned.push(e);
    d.append?.(e);
  };
  const rootFailed = (why: string) => {
    r.roots_ok = false;
    r.unseen.push(why);
  };
  const block = (kind: string, ref: string, reason: BlockReason) => {
    r.blocked.push({ kind, ref, reason });
    write({ type: "reap_blocked", source: SOURCE, payload: { kind, ref, reason }, dedupe_key: key("reap_blocked", kind, ref, reason) });
  };
  const finish = () => {
    write({
      type: "reap_round",
      source: SOURCE,
      payload: {
        trigger,
        roots_ok: r.roots_ok,
        round,
        ...(r.mark_only ? { mark_only: true } : {}),
        cards: r.cards,
        marked: r.marked.length,
        candidates: r.candidates.length,
        reaped: r.reaped.length,
        unknown: r.unknown.length,
        docker_skipped: r.docker_skipped,
        ...(r.missed > 0 ? { missed: r.missed } : {}),
      },
      dedupe_key: key("reap_round", String(round)),
    });
    return r;
  };

  if (d.config.kind === "unreadable") {
    rootFailed(`reaper config: ${d.config.why}`);
    block("config", "reaper", "config_unreadable");
  }

  // Card list: a root, and the input to adoption and remote_host.
  const list = await d.orca.worktreeList({ limit: 1000 });
  if (!list.ok) {
    rootFailed(`worktree list: ${list.error.code}`);
    return finish();
  }
  if (list.value.truncated) rootFailed("worktree list truncated");
  const remote = list.value.nonLocal.ids ?? [];
  for (const id of remote) {
    block("worktree", id, "remote_host");
    r.unknown.push(`worktree:${id}`);
  }
  for (let i = remote.length; i < list.value.nonLocal.rows; i++) r.unknown.push("worktree:(non-local, no id)");

  const recorded = new Set(
    [...d.events({ type: "resource" }), ...d.events({ type: "resource_adopted" })]
      .map((e) => e.payload as { kind: string; ref: string })
      .filter((p) => p.kind === "worktree")
      .map((p) => p.ref),
  );
  const scope: (WorktreeRow & { instanceId: string })[] = [];
  const only = d.append ? null : (o.only ?? null);
  for (const c of list.value.rows) {
    if (c.isMainWorktree !== false) continue;
    if (only && !only.has(c.instanceId ?? "")) continue;
    if (!c.instanceId) {
      r.unknown.push(`worktree:${c.id}`);
      continue;
    }
    scope.push(await withRemoteCase(c as WorktreeRow & { instanceId: string }, d.exec));
    if (!recorded.has(c.instanceId)) {
      write({
        type: "resource_adopted",
        source: SOURCE,
        payload: { kind: "worktree", ref: c.instanceId, basis: "card list" },
        dedupe_key: key("resource_adopted", "worktree", c.instanceId),
      });
    }
  }
  r.cards = scope.length;
  const byId = new Map(scope.map((c) => [c.id, c]));

  // Roots: read only, never stored.
  const marked = new Set<string>();
  const unknown = new Set<string>();
  const workers = await allWorkers(d.orca);
  if (typeof workers === "string") rootFailed(workers);
  else for (const w of workers) if (!settled(w) && w.workspace && byId.has(w.workspace)) marked.add(w.workspace);

  // Not a card removal, so mark-only rounds (by flag or by no config) close it too; a dry run does not,
  // nor does a round whose protect list could not be read.
  // A confirmed round (decision 234) closes nothing the owner did not name.
  if (typeof workers !== "string" && d.append && d.config.kind !== "unreadable" && !o.confirmed) r.shells_closed = await closeReleasedShells(d, config, scope, workers);

  const ps = await d.orca.worktreePs({});
  if (!ps.ok) rootFailed(`worktree ps: ${ps.error.code}`);
  else {
    if (ps.value.truncated) rootFailed("worktree ps truncated");
    for (const p of ps.value.rows) {
      if (!byId.has(p.worktreeId)) continue;
      if (p.unverifiableTerminalCount > 0) unknown.add(p.worktreeId);
      else if (p.liveTerminalCount > 0) marked.add(p.worktreeId);
    }
  }

  if (config) {
    const protect = new Set(config.protect);
    for (const c of scope) if (protect.has(c.instanceId) || protect.has(c.path) || protect.has(branchOf(c))) marked.add(c.id);
  }

  // Open-Task root (decision 177): an open Task or a live session keeps its card. Unreadable is unknown.
  if (typeof workers !== "string") {
    for (const c of scope) {
      if (marked.has(c.id) || unknown.has(c.id) || !workers.some((w) => w.workspace === c.id)) continue;
      if (signal.aborted) break;
      const open = await openWork(c, workers, d.orca);
      if (open.ok) continue;
      if ("blocked" in open) marked.add(c.id);
      else {
        unknown.add(c.id);
        r.unseen.push(`open Task? ${c.instanceId}: ${open.unknown}`);
      }
    }
  }

  const repos = new Map<string, WorktreeRow[]>();
  for (const c of scope) {
    if (marked.has(c.id)) continue;
    const repo = repoOf(c);
    if (!repo) {
      unknown.add(c.id);
      continue;
    }
    repos.set(repo, [...(repos.get(repo) ?? []), c]);
  }
  // Decision 207: a repository counts as sangsoe's when a card sangsoe started or recorded is in it. An
  // unreadable one fails the round closed; another owner's keeps its cards and says so once.
  const started = new Set(d.events({ type: "unit_started" }).map((e) => String((e.payload as { worktree?: unknown }).worktree ?? "")));
  const own = new Set(
    d
      .events({ type: "resource" })
      .map((e) => e.payload as { kind: string; ref: string })
      .filter((p) => p.kind === "worktree")
      .map((p) => p.ref),
  );
  const managed = new Set(scope.filter((c) => started.has(c.id) || own.has(c.instanceId)).flatMap((c) => repoOf(c) ?? []));
  for (const [repo, cs] of repos) {
    const heads = await openPrHeads(d.gh, repo);
    if (!heads && managed.has(repo)) {
      rootFailed(`open PRs of ${repo}`);
      continue;
    }
    if (!heads) {
      for (const c of cs) unknown.add(c.id);
      block("repo", repo, "repo_unreadable");
      continue;
    }
    for (const c of cs) if (heads.has(branchOf(c))) marked.add(c.id);
  }
  if (signal.aborted) rootFailed("round passed its cap");

  for (const id of unknown) r.unknown.push(`worktree:${byId.get(id)?.instanceId ?? id}`);
  r.marked = scope.filter((c) => marked.has(c.id)).map((c) => c.instanceId);
  const candidates = scope.filter((c) => !marked.has(c.id) && !unknown.has(c.id));
  r.candidates = candidates.map((c) => c.instanceId);
  const workerRows = typeof workers === "string" ? [] : workers;
  if (o.explain && r.roots_ok) {
    for (const c of candidates) {
      const f = await judgeFinished(c, d.gh, workerRows);
      const state = f.state === "unknown" && f.why === NO_TRACE ? "no_trace" : f.state;
      const why = f.state === "finished" ? (f.pr ? `PR #${f.pr.number}` : "Dispatch settled") : f.why;
      r.judged.push({ ref: c.instanceId, name: c.displayName ?? branchOf(c), path: c.path, gone: !existsSync(c.path), state, why });
    }
  }
  if (!r.roots_ok || !config) return finish();

  // Candidate rows: first sighting `seen`, reached again (or no longer a clean candidate) `cleared`.
  const sightings = lastSightings(d.events({ type: "reap_candidate" }));
  // A round that wrote no sighting breaks the run of two, whether a root failed or it only marked.
  const failedSince = (r0: number) =>
    rounds.some((e) => {
      const p = e.payload as { round: number; roots_ok: boolean; mark_only?: boolean };
      return p.round > r0 && (!p.roots_ok || p.mark_only === true);
    });
  const sighting = (state: "seen" | "cleared", ref: string) =>
    write({
      type: "reap_candidate",
      source: SOURCE,
      payload: { kind: "worktree", ref, round, state },
      dedupe_key: key("reap_candidate", "worktree", ref, String(round)),
    });
  const isCandidate = new Set(r.candidates);
  const firstSeen = new Map<string, Sighting>();
  for (const c of scope) {
    const last = sightings.get(`worktree\n${c.instanceId}`);
    if (isCandidate.has(c.instanceId)) {
      // A sighting from before a pause does not pair with the catch-up round: the run of two starts again.
      if (!last || last.state === "cleared" || failedSince(last.round) || r.missed > 0) {
        sighting("seen", c.instanceId);
        firstSeen.set(c.instanceId, { state: "seen", round, at: now });
      } else firstSeen.set(c.instanceId, last);
    } else if (last?.state === "seen") sighting("cleared", c.instanceId);
  }

  // Targets: a candidate in two different rounds in a row, past the grace, and positively finished.
  const pressure = judgeLoad(d.sample()).level !== "ok";
  const grace = pressure ? config.minGapMs : config.graceMs;
  const targets: { card: WorktreeRow & { instanceId: string }; finished: Extract<Finished, { state: "finished" }> }[] = [];
  const confirmed = o.confirmed ? new Set(o.confirmed) : null;
  for (const id of confirmed ?? []) if (!isCandidate.has(id)) r.unseen.push(`not a candidate now: ${id}`);
  const gone = new Set<string>();
  for (const c of candidates) {
    if (confirmed) {
      if (!confirmed.has(c.instanceId)) continue;
    } else {
      const seen = firstSeen.get(c.instanceId);
      if (!seen || seen.round >= round || now - seen.at < grace) continue;
    }
    let f = await judgeFinished(c, d.gh, workerRows);
    if (confirmed && !existsSync(c.path)) gone.add(c.id);
    // Decision 234: only the owner's confirmation lets a card no PR or Dispatch speaks for, or one
    // whose checkout is already gone, count as finished.
    if (confirmed && f.state === "unknown" && (f.why === NO_TRACE || gone.has(c.id))) f = { state: "finished", carried: false, pr: null };
    if (f.state === "finished") targets.push({ card: c, finished: f });
    else if (f.state === "unknown") r.unseen.push(`finished? ${c.instanceId}: ${f.why}`);
    else if (confirmed) r.unseen.push(`not finished: ${c.instanceId}: ${f.why}`);
  }
  r.targets = targets.map((t) => t.card.instanceId);
  if (o.markOnly || !d.append) return finish();

  // Sweep: the pre-delete checks, then Orca's removal with the repository's archive hook.
  r.swept = true;
  const reapedCards = new Set(
    d
      .events({ type: "reap_done" })
      .map((e) => e.payload as { kind: string; ref: string })
      .filter((p) => p.kind === "worktree")
      .map((p) => p.ref),
  );
  const done = (kind: string, ref: string) => {
    r.reaped.push(`${kind}:${ref}`);
    write({ type: "reap_done", source: SOURCE, payload: { kind, ref }, dedupe_key: key("reap_done", kind, ref) });
  };
  let up: Promise<DockerState> | undefined;
  const docker = () => (up ??= dockerState(d.exec));
  let stacks: Promise<Stacks> | undefined;
  const evidence = d.events({ type: "evidence" });
  // Decision 194: a hit skips the removal; nothing is stopped or killed. The Orca reads and `ports` are
  // asked again per card, for the Dispatches the round's worker-list named; the compose list once per sweep.
  const checks: ((card: WorktreeRow & { instanceId: string }, f: Extract<Finished, { state: "finished" }>) => Promise<Check> | Check)[] = [
    (card) => openWork(card, workerRows, d.orca),
    (card, f) => evidenceInWorktree(card, f, evidence),
    (card) => listening(card, d.orca),
    async (card) => {
      stacks ??= readStacks(d.exec, docker);
      const s = await stacks;
      if (s.kind === "no_docker") r.docker_skipped = true;
      return composeRunning(card, s);
    },
    // A checkout already gone has no status to read; its HEAD must still be on GitHub (decision 234).
    (card, f) => preDelete(card, f, d.exec, d.gh, gone.has(card.id) && !existsSync(card.path)),
  ];
  for (const { card, finished } of targets) {
    if (signal.aborted) {
      r.unseen.push("round passed its cap before the sweep finished");
      break;
    }
    let check: Check = { ok: true };
    for (const run of checks) {
      check = await run(card, finished);
      if (!check.ok) break;
    }
    if (!check.ok) {
      if ("blocked" in check) block("worktree", card.instanceId, check.blocked);
      else r.unknown.push(`worktree:${card.instanceId}: ${check.unknown}`);
      continue;
    }
    const rm = await d.orca.worktreeRm({ worktree: `id:${card.id}` });
    if (rm.ok) {
      done("worktree", card.instanceId);
      reapedCards.add(card.instanceId);
    } else if (rm.error.code === "worktree_archive_hook_failed") block("worktree", card.instanceId, "archive_hook_failed");
    else r.unknown.push(`worktree:${card.instanceId}: rm ${rm.error.code}`);
  }

  // Docker: recorded ids whose card is gone through REAPER, in decision 82 R6's order. Every outcome
  // closes the hold (removed, gone, or handed to a person as in use), so no id is tried twice.
  const taskCard = new Map<string, string>();
  for (const w of workerRows) {
    const c = w.workspace ? byId.get(w.workspace) : undefined;
    if (c && !taskCard.has(w.taskId)) taskCard.set(w.taskId, c.instanceId);
  }
  const holds = dockerHolds(holdEvents(d.events));
  // A confirmed round sweeps only what the cards it removed now held (decision 234): earlier holds are the
  // timer round's, and only this round can still map a Task-owned hold to its card.
  const removedNow = new Set(r.reaped.filter((x) => x.startsWith("worktree:")).map((x) => x.slice("worktree:".length)));
  const swept = confirmed ? removedNow : reapedCards;
  const owned = [...holds.values()].filter((h) => h.held && swept.has(taskCard.get(h.owner) ?? h.owner));
  if (owned.length > 0 && !signal.aborted) {
    const s = await docker();
    // A Docker that does not answer keeps every hold for the next round.
    if (s.kind === "absent") r.docker_skipped = true;
    else if (s.kind === "unanswered") r.unknown.push(`docker: ${s.why}`);
    else {
      for (const x of await sweepDocker(d.exec, owned)) {
        const h = holds.get(`${x.kind}\n${x.ref}`) as Hold;
        const gen = `g${h.gen}`;
        if (x.result === "removed") {
          r.reaped.push(`${x.kind}:${x.ref}`);
          write({ type: "reap_done", source: SOURCE, payload: { kind: x.kind, ref: x.ref }, dedupe_key: key("reap_done", x.kind, x.ref, gen) });
        } else if (x.result === "in_use") {
          r.blocked.push({ kind: x.kind, ref: x.ref, reason: "in_use" });
          write({
            type: "reap_blocked",
            source: SOURCE,
            payload: { kind: x.kind, ref: x.ref, reason: "in_use" },
            dedupe_key: blockedKey(x.kind, x.ref, h.gen),
          });
        } else if (x.result === "gone") write(goneRow(h));
        else r.unknown.push(`${x.kind}:${x.ref}: inspect failed`);
      }
    }
  }
  return finish();
}
