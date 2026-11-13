import { existsSync, lstatSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { judgeLoad, type LoadLevel, type LoadSample } from "../capacity/capacity.ts";
import type { StoredEvent } from "../contract/index.ts";
import type { Exec, OrcaAdapter } from "../contract/orca.ts";
import { withDiagnostics } from "../detect/resource/judge.ts";
import type { EventFilter } from "../store/store.ts";
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
  made: {
    worktrees: Reading<Usage>;
    terminals: Reading<{ count: number }>;
    processes: Reading<{ claude: Usage; node: Usage }>;
    tmp: Reading<Usage>;
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

export async function readResources(d: ResourceDeps): Promise<ResourceView> {
  const now = d.now();
  const diag = await d.orca.diagnosticsMemory();
  const sample = withDiagnostics(d.sample(), diag.ok ? diag.value : null);
  const verdict = judgeLoad(sample);
  const load: ResourceView["load"] = {
    ok: true,
    value: {
      level: verdict.level,
      reasons: verdict.reasons,
      ...(sample.load5 !== undefined && sample.cpus ? { loadPerCpu: sample.load5 / sample.cpus } : {}),
      ...(sample.memFreePct !== undefined ? { memFreePct: sample.memFreePct } : {}),
      ...(sample.diskFreeGb !== undefined ? { diskFreeGb: sample.diskFreeGb } : {}),
    },
  };

  const own = ownCards(d.events);
  const list = await d.orca.worktreeList({ limit: 1000 });
  let worktrees: ResourceView["made"]["worktrees"];
  let terminals: ResourceView["made"]["terminals"];
  if (!list.ok) {
    worktrees = { ok: false, why: `worktree list: ${list.error.code}` };
    terminals = worktrees;
  } else {
    const mine = list.value.rows.filter((c) => c.isMainWorktree === false && (own.ids.has(c.id) || own.instances.has(c.instanceId ?? "")));
    const paths = mine.map((c) => c.path).filter((p) => existsSync(p));
    worktrees = { ok: true, value: { count: mine.length, kb: total(await diskKb(d.exec, paths), paths) } };
    const ps = await d.orca.worktreePs({});
    const ids = new Set(mine.map((c) => c.id));
    terminals = ps.ok
      ? { ok: true, value: { count: ps.value.rows.filter((p) => ids.has(p.worktreeId)).reduce((n, p) => n + p.liveTerminalCount, 0) } }
      : { ok: false, why: `worktree ps: ${ps.error.code}` };
  }

  let tmpAll: string[] | null = null;
  let tmpOld: string[] | null = null;
  let tmpWhy = "";
  try {
    tmpAll = tmpLeftovers(d.tmpRoot, now, d.uid, 0);
    tmpOld = tmpLeftovers(d.tmpRoot, now, d.uid);
  } catch (e) {
    tmpWhy = `${d.tmpRoot}: ${e instanceof Error ? e.message : String(e)}`;
  }
  const tmpKb = tmpAll ? await diskKb(d.exec, tmpAll) : null;
  const tmpMade: Reading<Usage> = tmpAll ? { ok: true, value: { count: tmpAll.length, kb: total(tmpKb, tmpAll) } } : { ok: false, why: tmpWhy };
  const tmp: Reading<Usage> = tmpOld ? { ok: true, value: { count: tmpOld.length, kb: total(tmpKb, tmpOld) } } : { ok: false, why: tmpWhy };

  let cards: ResourceView["worktrees"];
  try {
    const plan = await d.plan({ trigger: "hint", explain: true });
    if (!plan.roots_ok) cards = { ok: false, why: plan.unseen.join("; ") || "a root could not be read" };
    else {
      // The ones a confirmed round would take (round.ts): an unfinished card stays even when its path is gone.
      const rows = plan.judged.filter((j) => j.state === "finished" || j.state === "no_trace" || (j.gone && j.state === "unknown"));
      const paths = rows.filter((j) => !j.gone).map((j) => j.path);
      const kb = await diskKb(d.exec, paths);
      cards = {
        ok: true,
        value: { rows: rows.map((j) => ({ ...j, kb: j.gone ? 0 : (kb?.get(j.path) ?? null) })), markOnly: plan.mark_only, unseen: plan.unseen },
      };
    }
  } catch (e) {
    cards = { ok: false, why: e instanceof Error ? e.message : String(e) };
  }

  return {
    at: new Date(now).toISOString(),
    load,
    episode: episodeOf(d.events),
    made: { worktrees, terminals, processes: await processUsage(d.exec), tmp: tmpMade },
    worktrees: cards,
    tmp,
    trash: d.trashBin !== null,
  };
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
  if (a.worktrees.length > 0) {
    const r = await d.run({ trigger: "hint", confirmed: a.worktrees });
    out.reaped = r.reaped;
    out.blocked = r.blocked.filter((b) => b.kind !== "worktree" || a.worktrees.includes(b.ref));
    // The round also lists cards the owner did not name (unreadable roots elsewhere); the owner hears only of theirs.
    const listed = (u: string) => !u.startsWith("worktree:") || a.worktrees.some((id) => u === `worktree:${id}` || u.startsWith(`worktree:${id}:`));
    out.skipped = [...r.unseen, ...r.unknown.filter(listed)];
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
