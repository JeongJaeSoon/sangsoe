import { existsSync, lstatSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { DEFAULT_THRESHOLDS, judgeLoad, type LoadLevel, type LoadSample, type LoadThresholds } from "../capacity/capacity.ts";
import type { StoredEvent } from "../contract/index.ts";
import type { Exec, OrcaAdapter, WorktreeRow } from "../contract/orca.ts";
import { DEFAULT_MONITOR_CONFIG } from "../detect/monitor.ts";
import { withDiagnostics } from "../detect/resource/judge.ts";
import { SAMPLE_RETENTION_MS, SAMPLE_STEP_MS, type StoredSample } from "../store/samples.ts";
import type { EventFilter } from "../store/store.ts";
import { ownerHolds } from "./record.ts";
import type { Blocked, Judged, ReapOptions, ReapReport } from "./round.ts";

// Decision 234: the panel's 리소스 section. Every number is read when the owner opens or refreshes the
// section, never on a timer and never stored: Orca owns the cards and terminals, the OS the load and
// processes, the file system the temporary directories.

/** What a test file once left in $TMPDIR per call (`mkdtemp`'s six-character tail). */
const TMP_NAME = /^sangsoe-(hook|session|pre|record|mail)-[A-Za-z0-9]{6}$/;
/** Younger directories may belong to a test run in progress on this machine. */
export const TMP_MIN_AGE_MS = 60 * 60_000;
const BATCH = 200;
export const TRASH_BIN = "/usr/bin/trash";

export type Reading<T> = { ok: true; value: T } | { ok: false; why: string };
export type Usage = { count: number; kb: number | null };

export type ResourceView = {
  at: string;
  load: Reading<{ level: LoadLevel; reasons: string[]; loadPerCpu?: number; memFreePct?: number; diskFreeGb?: number }>;
  /** The resource monitor's last pressure_high or capacity_free row. */
  episode: { state: "high" | "ok" | "none"; since?: string; reason?: string };
  band: Band;
  made: {
    worktrees: Reading<Usage>;
    terminals: Reading<{ count: number }>;
    processes: Reading<{ claude: Usage; node: Usage }>;
    tmp: Reading<Usage>;
    /** Decision 240: owner-kind rows still held, oldest first; listed only, never cleared by sangsoe. */
    recorded: { kind: string; ref: string; owner: string; since: string }[];
  };
  /** Cards REAPER would list (a dry run that writes nothing), each with why it is one. */
  worktrees: Reading<{ rows: (Judged & { kb: number | null })[]; markOnly: boolean; unseen: string[] }>;
  /** Leftover per-call directories old enough to go to the trash. */
  tmp: Reading<Usage>;
  /** Whether this machine has the trash command; without it nothing in $TMPDIR is touched. */
  trash: boolean;
};

export type ResourceDeps = {
  orca: Pick<OrcaAdapter, "worktreeList" | "worktreePs" | "diagnosticsMemory">;
  exec: Exec;
  events(filter?: EventFilter): StoredEvent[];
  now(): number;
  sample(): LoadSample;
  /** REAPER over the store with no append: what it would list now. */
  plan(o: ReapOptions): Promise<ReapReport>;
  tmpRoot: string;
  uid: number;
  trashBin: string | null;
  /** The REAPER timer period the band judges a gap by; the default monitor config's when absent. */
  intervalMs?: number;
  /** Decision 241's samples after `since`; absent, the load part carries no history. */
  samples?(since: number): StoredSample[];
};

/** Leftover per-call directories under `root` this user owns that are older than the minimum age. */
export function tmpLeftovers(root: string, now: number, uid: number, minAgeMs = TMP_MIN_AGE_MS): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    if (!TMP_NAME.test(name)) continue;
    const p = join(root, name);
    try {
      const s = lstatSync(p);
      if (s.isDirectory() && s.uid === uid && now - s.mtimeMs >= minAgeMs) out.push(p);
    } catch {
      // Gone between the list and the stat.
    }
  }
  return out;
}

/** `du -sk` per path, in batches; null for a path du did not report. */
export async function diskKb(exec: Exec, paths: readonly string[]): Promise<Map<string, number> | null> {
  const kb = new Map<string, number>();
  for (let i = 0; i < paths.length; i += BATCH) {
    const r = await exec("du", ["-sk", ...paths.slice(i, i + BATCH)]);
    if (r.failure) return null;
    for (const line of r.stdout.split("\n")) {
      const m = /^(\d+)\t(.+)$/.exec(line);
      if (m?.[1] && m[2]) kb.set(m[2], Number(m[1]));
    }
  }
  return kb;
}

const total = (kb: Map<string, number> | null, paths: readonly string[]): number | null =>
  kb ? paths.reduce((n, p) => n + (kb.get(p) ?? 0), 0) : null;

/** claude and node processes by name, with their resident memory; shown only, never signalled. */
export async function processUsage(exec: Exec): Promise<Reading<{ claude: Usage; node: Usage }>> {
  const r = await exec("ps", ["-axo", "rss=,comm="]);
  if (r.code !== 0) return { ok: false, why: `ps: ${r.failure ?? r.code}` };
  const by = { claude: { count: 0, kb: 0 }, node: { count: 0, kb: 0 } };
  for (const line of r.stdout.split("\n")) {
    const m = /^\s*(\d+)\s+(.+)$/.exec(line);
    const name = m?.[2] ? basename(m[2].trim()) : "";
    if (name !== "claude" && name !== "node") continue;
    by[name].count++;
    by[name].kb += Number(m?.[1] ?? 0);
  }
  return { ok: true, value: by };
}

function episodeOf(events: ResourceDeps["events"]): ResourceView["episode"] {
  const last = [...events({ type: "pressure_high" }), ...events({ type: "capacity_free" })].sort((a, b) => a.seq - b.seq).at(-1);
  if (!last) return { state: "none" };
  if (last.type === "capacity_free") return { state: "ok", since: last.ts };
  return { state: "high", since: last.ts, reason: String((last.payload as { reason?: unknown }).reason ?? "") };
}

/** Worktree ids (Orca's `id`) and instance ids sangsoe started or recorded. */
function ownCards(events: ResourceDeps["events"]): { ids: Set<string>; instances: Set<string> } {
  const ids = new Set(events({ type: "unit_started" }).map((e) => String((e.payload as { worktree?: unknown }).worktree ?? "")));
  const instances = new Set(
    events({ type: "resource" })
      .map((e) => e.payload as { kind?: string; ref?: string })
      .filter((p) => p.kind === "worktree" && p.ref)
      .map((p) => p.ref as string),
  );
  return { ids, instances };
}

const isMine = (own: ReturnType<typeof ownCards>, c: WorktreeRow) =>
  c.isMainWorktree === false && (own.ids.has(c.id) || own.instances.has(c.instanceId ?? ""));

/**
 * The instance ids of the worktrees sangsoe made (start_unit's `unit_started.worktree`, a recorded
 * `resource`{kind worktree}); null when Orca's list cannot be read. Only these are ever offered to 정리.
 */
export async function sangsoeWorktrees(events: ResourceDeps["events"], orca: Pick<OrcaAdapter, "worktreeList">): Promise<Set<string> | null> {
  const list = await orca.worktreeList({ limit: 1000 });
  if (!list.ok) return null;
  const own = ownCards(events);
  return new Set(list.value.rows.filter((c) => isMine(own, c)).map((c) => c.instanceId ?? c.id));
}

export type BandState = "ok" | "warn" | "danger" | "unknown";
/** The last 24 hours of load levels, from the episode rows the resource monitor already writes. */
export type Band = { from: string; to: string; spans: { from: string; to: string; state: BandState }[] };
export const BAND_MS = 24 * 3_600_000;

/**
 * Decision 235: the band stores nothing of its own. pressure_high marks entering warn or danger (the
 * level it entered at; a rise inside an episode is not recorded), capacity_free the return to ok. The
 * monitor's own rounds are not recorded, so a stretch with no REAPER timer round within three of its
 * periods is unknown: Orca or its worker was not running. Three, not two: a tick that fires while a
 * hint round (pressure_high is one) still runs is dropped, so the load itself can skip one round.
 */
export function loadBand(events: readonly StoredEvent[], now: number, intervalMs: number): Band {
  const from = now - BAND_MS;
  const at = (e: StoredEvent) => Date.parse(e.ts);
  const episodes = events.filter((e) => e.type === "pressure_high" || e.type === "capacity_free").sort((a, b) => a.seq - b.seq);
  const covered = events
    .filter((e) => e.type === "reap_round" && (e.payload as { trigger?: unknown }).trigger === "timer")
    .map((e) => [at(e), at(e) + 3 * intervalMs] as const);
  const levelAt = (t: number): BandState => {
    if (!covered.some(([a, b]) => a <= t && t < b)) return "unknown";
    const last = episodes.filter((e) => at(e) <= t).at(-1);
    if (last?.type !== "pressure_high") return "ok";
    return String((last.payload as { reason?: unknown }).reason ?? "").startsWith("danger") ? "danger" : "warn";
  };
  const cuts = [...new Set([from, now, ...episodes.map(at), ...covered.flat()].filter((t) => t >= from && t <= now))].sort((a, b) => a - b);
  const spans: Band["spans"] = [];
  for (let i = 1; i < cuts.length; i++) {
    const a = cuts[i - 1] as number;
    const b = cuts[i] as number;
    const state = levelAt(a);
    const prev = spans.at(-1);
    if (prev?.state === state) prev.to = new Date(b).toISOString();
    else spans.push({ from: new Date(a).toISOString(), to: new Date(b).toISOString(), state });
  }
  return { from: new Date(from).toISOString(), to: new Date(now).toISOString(), spans };
}

export type ResourcePart = "load" | "made" | "candidates";
export const RESOURCE_PARTS: readonly ResourcePart[] = ["load", "made", "candidates"];
export type ResourcePartView =
  | { part: "load"; at: string; load: ResourceView["load"]; episode: ResourceView["episode"]; band: Band; history?: Reading<LoadHistory> }
  | { part: "made"; at: string; made: ResourceView["made"] }
  | { part: "candidates"; at: string; worktrees: ResourceView["worktrees"]; tmp: ResourceView["tmp"]; trash: boolean };

const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One sample as the panel's card draws it: the same figures the gauges show. */
export type LoadPoint = { at: number; loadPerCpu?: number; memUsedPct?: number; diskFreeGb?: number };
/** Decision 250: the last 24 hours of decision 241's samples, with the thresholds the lines mark. */
export type LoadHistory = { from: string; to: string; stepMs: number; thresholds: LoadThresholds; points: LoadPoint[] };

function loadHistory(read: (since: number) => StoredSample[], now: number, thresholds: LoadThresholds): Reading<LoadHistory> {
  const from = now - SAMPLE_RETENTION_MS;
  let rows: StoredSample[];
  try {
    rows = read(from);
  } catch (e) {
    return { ok: false, why: why(e) };
  }
  const points = rows.map((s) => ({
    at: s.at,
    ...(s.load5 !== undefined && s.cpus ? { loadPerCpu: s.load5 / s.cpus } : {}),
    ...(s.memFreePct !== undefined ? { memUsedPct: 100 - s.memFreePct } : {}),
    ...(s.diskFreeGb !== undefined ? { diskFreeGb: s.diskFreeGb } : {}),
  }));
  return { ok: true, value: { from: new Date(from).toISOString(), to: new Date(now).toISOString(), stepMs: SAMPLE_STEP_MS, thresholds, points } };
}

/** One point read of the load: Orca's memory figures over the OS sample, judged once. */
async function readLoad(d: ResourceDeps, raw: LoadSample): Promise<ResourceView["load"]> {
  const diag = await d.orca.diagnosticsMemory();
  const sample = withDiagnostics(raw, diag.ok ? diag.value : null);
  const verdict = judgeLoad(sample);
  return {
    ok: true,
    value: {
      level: verdict.level,
      reasons: verdict.reasons,
      ...(sample.load5 !== undefined && sample.cpus ? { loadPerCpu: sample.load5 / sample.cpus } : {}),
      ...(sample.memFreePct !== undefined ? { memFreePct: sample.memFreePct } : {}),
      ...(sample.diskFreeGb !== undefined ? { diskFreeGb: sample.diskFreeGb } : {}),
    },
  };
}

/** Leftover per-call directories with their size; `minAgeMs` 0 counts the young ones too. */
async function tmpUsage(d: ResourceDeps, now: number, minAgeMs?: number): Promise<Reading<Usage>> {
  let paths: string[];
  try {
    paths = tmpLeftovers(d.tmpRoot, now, d.uid, minAgeMs);
  } catch (e) {
    return { ok: false, why: `${d.tmpRoot}: ${why(e)}` };
  }
  return { ok: true, value: { count: paths.length, kb: total(await diskKb(d.exec, paths), paths) } };
}

async function readMade(d: ResourceDeps, now: number): Promise<ResourceView["made"]> {
  const own = ownCards(d.events);
  const cards = async (): Promise<Pick<ResourceView["made"], "worktrees" | "terminals">> => {
    const [list, ps] = await Promise.all([d.orca.worktreeList({ limit: 1000 }), d.orca.worktreePs({})]);
    if (!list.ok) {
      const failed = { ok: false as const, why: `worktree list: ${list.error.code}` };
      return { worktrees: failed, terminals: failed };
    }
    const mine = list.value.rows.filter((c) => isMine(own, c));
    const paths = mine.map((c) => c.path).filter((p) => existsSync(p));
    const ids = new Set(mine.map((c) => c.id));
    return {
      worktrees: { ok: true, value: { count: mine.length, kb: total(await diskKb(d.exec, paths), paths) } },
      terminals: ps.ok
        ? { ok: true, value: { count: ps.value.rows.filter((p) => ids.has(p.worktreeId)).reduce((n, p) => n + p.liveTerminalCount, 0) } }
        : { ok: false, why: `worktree ps: ${ps.error.code}` },
    };
  };
  const [c, processes, tmp] = await Promise.all([cards(), processUsage(d.exec), tmpUsage(d, now, 0)]);
  const recorded = [...ownerHolds(d.events({ type: "resource" })).values()]
    .filter((h) => h.held)
    .map(({ kind, ref, owner, since }) => ({ kind, ref, owner, since }))
    .sort((a, b) => a.since.localeCompare(b.since));
  return { ...c, processes, tmp, recorded };
}

async function readCandidates(d: ResourceDeps, now: number): Promise<Pick<ResourceView, "worktrees" | "tmp">> {
  const cards = async (): Promise<ResourceView["worktrees"]> => {
    const list = await d.orca.worktreeList({ limit: 1000 });
    if (!list.ok) return { ok: false, why: `worktree list: ${list.error.code}` };
    const own = ownCards(d.events);
    const mine = new Set(list.value.rows.filter((c) => isMine(own, c)).map((c) => c.instanceId ?? c.id));
    try {
      const plan = await d.plan({ trigger: "hint", explain: true, only: mine });
      if (!plan.roots_ok) return { ok: false, why: plan.unseen.join("; ") || "a root could not be read" };
      // The ones a confirmed round would take (round.ts), of sangsoe's own cards only: another program's
      // worktree is never offered. An unfinished card stays even when its path is gone.
      const rows = plan.judged.filter((j) => mine.has(j.ref) && (j.state === "finished" || j.state === "no_trace" || (j.gone && j.state === "unknown")));
      const paths = rows.filter((j) => !j.gone).map((j) => j.path);
      const kb = await diskKb(d.exec, paths);
      return { ok: true, value: { rows: rows.map((j) => ({ ...j, kb: j.gone ? 0 : (kb?.get(j.path) ?? null) })), markOnly: plan.mark_only, unseen: plan.unseen } };
    } catch (e) {
      return { ok: false, why: why(e) };
    }
  };
  const [worktrees, tmp] = await Promise.all([cards(), tmpUsage(d, now)]);
  return { worktrees, tmp };
}

/** Decision 235: one part of the section, so the panel paints each as it comes; the reads inside run together. */
export async function readResourcePart(d: ResourceDeps, part: ResourcePart): Promise<ResourcePartView> {
  const now = d.now();
  const at = new Date(now).toISOString();
  if (part === "load") {
    const sample = d.sample();
    const band = loadBand(["pressure_high", "capacity_free", "reap_round"].flatMap((type) => d.events({ type })), now, d.intervalMs ?? DEFAULT_MONITOR_CONFIG.reaperIntervalMinutes * 60_000);
    const history = d.samples ? { history: loadHistory(d.samples, now, sample.thresholds ?? DEFAULT_THRESHOLDS) } : {};
    return { part, at, load: await readLoad(d, sample), episode: episodeOf(d.events), band, ...history };
  }
  if (part === "made") return { part, at, made: await readMade(d, now) };
  return { part, at, ...(await readCandidates(d, now)), trash: d.trashBin !== null };
}

/** The whole section at once (`sangsoe reap plan`): the three parts together. */
export async function readResources(d: ResourceDeps): Promise<ResourceView> {
  const [l, m, c] = await Promise.all(RESOURCE_PARTS.map((p) => readResourcePart(d, p)));
  if (l?.part !== "load" || m?.part !== "made" || c?.part !== "candidates") throw new Error("resource parts out of order");
  return { at: l.at, load: l.load, episode: l.episode, band: l.band, made: m.made, worktrees: c.worktrees, tmp: c.tmp, trash: c.trash };
}

export type OwnerReap = { worktrees: readonly string[]; tmp: boolean };
export type OwnerReaped = {
  reaped: string[];
  blocked: Blocked[];
  /** Ids not removed and why: no longer a candidate, not finished, or unreadable. */
  skipped: string[];
  tmp: { moved: number; left: number } | null;
};

export type OwnerReapDeps = {
  run(o: ReapOptions): Promise<ReapReport>;
  /** sangsoeWorktrees, read at run time; null removes no card. */
  mine(): Promise<Set<string> | null>;
  exec: Exec;
  now(): number;
  tmpRoot: string;
  uid: number;
  trashBin: string | null;
};

/**
 * The confirmed half of 정리 (decision 234): the listed cards in one REAPER round, then the per-call
 * directories, re-found by the same rule at run time and moved to the trash. Nothing is deleted.
 */
export async function ownerReap(d: OwnerReapDeps, a: OwnerReap): Promise<OwnerReaped> {
  const out: OwnerReaped = { reaped: [], blocked: [], skipped: [], tmp: null };
  const mine = a.worktrees.length > 0 ? await d.mine() : null;
  if (a.worktrees.length > 0 && !mine) out.skipped.push("sangsoe's worktrees could not be read: no card removed");
  const named = mine ? a.worktrees.filter((id) => mine.has(id)) : [];
  if (mine) for (const id of a.worktrees) if (!mine.has(id)) out.skipped.push(`not made by sangsoe: ${id}`);
  if (named.length > 0) {
    const r = await d.run({ trigger: "hint", confirmed: named });
    out.reaped = r.reaped;
    out.blocked = r.blocked.filter((b) => b.kind !== "worktree" || named.includes(b.ref));
    // The round also lists cards the owner did not name (unreadable roots elsewhere); the owner hears only of theirs.
    const listed = (u: string) => !u.startsWith("worktree:") || named.some((id) => u === `worktree:${id}` || u.startsWith(`worktree:${id}:`));
    out.skipped.push(...r.unseen, ...r.unknown.filter(listed));
    if (r.mark_only) out.skipped.push("reaper config absent: no card removed");
  }
  if (a.tmp && d.trashBin) {
    try {
      const before = tmpLeftovers(d.tmpRoot, d.now(), d.uid);
      for (let i = 0; i < before.length; i += BATCH) await d.exec(d.trashBin, before.slice(i, i + BATCH));
      const left = before.filter((p) => existsSync(p)).length;
      out.tmp = { moved: before.length - left, left };
    } catch (e) {
      out.skipped.push(`임시 폴더를 읽지 못함: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}
