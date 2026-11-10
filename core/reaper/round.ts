import { judgeLoad, type LoadSample } from "../capacity/capacity.ts";
import { dedupeKey, eventDef, type EventType, type StoredEvent } from "../contract/index.ts";
import type { Exec, OrcaAdapter, WorkerRow, WorktreeRow } from "../contract/orca.ts";
import type { Planned } from "../detect/monitor.ts";
import type { GhClient } from "../gh/client.ts";
import { settled } from "../recover/recover.ts";
import type { Appended, EventFilter } from "../store/store.ts";
import { preDelete } from "./checks.ts";
import type { ReaperConfig } from "./config.ts";
import { dockerUp, sweepDocker } from "./docker.ts";
import { branchOf, type Finished, judgeFinished, repoOf } from "./finished.ts";
import { blockedKey, dockerHolds, goneRow, type Hold, holdEvents } from "./record.ts";

/** The only Orca calls REAPER has: three reads and the one removal. No terminal call exists here. */
export type ReaperOrca = Pick<OrcaAdapter, "worktreeList" | "worktreePs" | "workerList" | "worktreeRm">;

export type ReaperDeps = {
  orca: ReaperOrca;
  gh: GhClient;
  /** `git` for the pre-delete checks and `docker` for recorded ids. */
  exec: Exec;
  events(filter?: EventFilter): StoredEvent[];
  /** Absent on a dry run: the round marks and reports, and never sweeps. */
  append?: (e: Planned) => Appended;
  now(): number;
  /** null with no readable `reaper` section: the round is mark-only (decision 174), not a failed root. */
  config: ReaperConfig | null;
  sample(): LoadSample;
};

export type ReapOptions = { trigger?: "timer" | "hint"; markOnly?: boolean; signal?: AbortSignal };

export type BlockReason =
  | "uncommitted"
  | "unpushed"
  | "unpushed_other_patch"
  | "in_use"
  | "archive_hook_failed"
  | "remote_host";
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
  planned: Planned[];
};

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
 * round before any candidate row or removal. Terminals are never closed here.
 */
export async function reapRound(d: ReaperDeps, o: ReapOptions = {}): Promise<ReapReport> {
  const trigger = o.trigger ?? "timer";
  const signal = o.signal ?? new AbortController().signal;
  const now = d.now();
  const rounds = d.events({ type: "reap_round" });
  const round = 1 + rounds.reduce((m, e) => Math.max(m, Number((e.payload as { round?: number }).round) || 0), 0);
  const r: ReapReport = {
    round,
    trigger,
    roots_ok: true,
    mark_only: d.config === null,
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
      },
      dedupe_key: key("reap_round", String(round)),
    });
    return r;
  };

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
  for (const c of list.value.rows) {
    if (c.isMainWorktree !== false) continue;
    if (!c.instanceId) {
      r.unknown.push(`worktree:${c.id}`);
      continue;
    }
    scope.push(c as WorktreeRow & { instanceId: string });
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

  if (d.config) {
    const protect = new Set(d.config.protect);
    for (const c of scope) if (protect.has(c.instanceId) || protect.has(c.path) || protect.has(branchOf(c))) marked.add(c.id);
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
  for (const [repo, cs] of repos) {
    const heads = await openPrHeads(d.gh, repo);
    if (!heads) {
      rootFailed(`open PRs of ${repo}`);
      continue;
    }
    for (const c of cs) if (heads.has(branchOf(c))) marked.add(c.id);
  }
  if (signal.aborted) rootFailed("round passed its cap");

  for (const id of unknown) r.unknown.push(`worktree:${byId.get(id)?.instanceId ?? id}`);
  r.marked = scope.filter((c) => marked.has(c.id)).map((c) => c.instanceId);
  const candidates = scope.filter((c) => !marked.has(c.id) && !unknown.has(c.id));
  r.candidates = candidates.map((c) => c.instanceId);
  if (!r.roots_ok || !d.config) return finish();
  const config = d.config;

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
      if (!last || last.state === "cleared" || failedSince(last.round)) {
        sighting("seen", c.instanceId);
        firstSeen.set(c.instanceId, { state: "seen", round, at: now });
      } else firstSeen.set(c.instanceId, last);
    } else if (last?.state === "seen") sighting("cleared", c.instanceId);
  }

  // Targets: a candidate in two different rounds in a row, past the grace, and positively finished.
  const pressure = judgeLoad(d.sample()).level !== "ok";
  const grace = pressure ? config.minGapMs : config.graceMs;
  const workerRows = typeof workers === "string" ? [] : workers;
  const targets: { card: WorktreeRow & { instanceId: string }; finished: Extract<Finished, { state: "finished" }> }[] = [];
  for (const c of candidates) {
    const seen = firstSeen.get(c.instanceId);
    if (!seen || seen.round >= round || now - seen.at < grace) continue;
    const f = await judgeFinished(c, d.gh, workerRows);
    if (f.state === "finished") targets.push({ card: c, finished: f });
    else if (f.state === "unknown") r.unseen.push(`finished? ${c.instanceId}: ${f.why}`);
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
  for (const { card, finished } of targets) {
    if (signal.aborted) {
      r.unseen.push("round passed its cap before the sweep finished");
      break;
    }
    const check = await preDelete(card, finished, d.exec, d.gh);
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
  const docker = [...holds.values()].filter((h) => h.held && reapedCards.has(taskCard.get(h.owner) ?? h.owner));
  if (docker.length > 0 && !signal.aborted) {
    if (!(await dockerUp(d.exec))) r.docker_skipped = true;
    else {
      for (const x of await sweepDocker(d.exec, docker)) {
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
