// Throwaway world for REAPER scenarios: real git repos under the test temp dir, a fake Orca that
// answers only the four reads and the one write REAPER may make, a fake GitHub and a fake Docker.
// Nothing here can reach the machine's real worktrees or containers.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Exec,
  type ExecResult,
  type GhClient,
  type GhResponse,
  type LoadSample,
  type LocalRows,
  type OrcaResult,
  type ReaperConfig,
  type ReaperDeps,
  type ReapOptions,
  type ReapReport,
  reapRound,
  Store,
  type WorkerRow,
  type WorktreePsRow,
  type WorktreeRow,
} from "../../core/index.ts";

export const MIN = 60_000;
export const CONFIG: ReaperConfig = { protect: [], graceMs: 30 * MIN, minGapMs: 10 * MIN };

export type Repo = { path: string; head: string };

let root: string | null = null;
export function scratch(): string {
  root ??= mkdtempSync(join(tmpdir(), "sangsoe-reaper-"));
  return root;
}
export function dropScratch(): void {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();

/** A clean repo with one commit: the card's checkout. */
export function makeRepo(name: string): Repo {
  const path = join(scratch(), name);
  mkdirSync(path, { recursive: true });
  git(path, "init", "-q", "-b", name);
  writeFileSync(join(path, "a.txt"), "a\n");
  git(path, "add", "a.txt");
  git(path, "commit", "-q", "-m", `work on ${name}`);
  return { path, head: git(path, "rev-parse", "HEAD") };
}

export function card(name: string, repo: Repo, o: Partial<WorktreeRow> = {}): WorktreeRow {
  return {
    id: `repo-1::${repo.path}`,
    instanceId: `inst-${name}`,
    projectId: "github:acme/api",
    head: repo.head,
    hostId: "local",
    repoId: "repo-1",
    path: repo.path,
    branch: `refs/heads/${name}`,
    displayName: name,
    isMainWorktree: false,
    isArchived: false,
    parentWorktreeId: null,
    childWorktreeIds: [],
    lastActivityAt: 0,
    ...o,
  };
}

export function worker(workspace: string, o: Partial<WorkerRow> = {}): WorkerRow {
  return { dispatchId: `ctx_${workspace.length}`, taskId: "task_1", state: "succeeded", workspace, host: "local", ...o };
}

const rows = <T>(r: T[], nonLocalIds: string[] = []): LocalRows<T> => ({
  rows: r,
  nonLocal: { rows: nonLocalIds.length, hostIds: nonLocalIds.length ? ["ssh-1"] : [], ids: nonLocalIds },
  omittedHostIds: [],
  truncated: false,
});

const fail = (code: string) => ({ ok: false, error: { code, message: code } }) as const;

/** Calls are named by the adapter method; REAPER is given no other method, so it cannot call one. */
export class FakeOrca {
  cards: WorktreeRow[] = [];
  remote: string[] = [];
  ps: WorktreePsRow[] = [];
  workers: WorkerRow[] = [];
  failing = new Set<string>();
  rmError: string | null = null;
  calls: string[] = [];

  async worktreeList(): Promise<OrcaResult<LocalRows<WorktreeRow>>> {
    this.calls.push("worktreeList");
    if (this.failing.has("worktreeList")) return fail("runtime_unreachable");
    return { ok: true, value: rows(this.cards, this.remote) };
  }
  async worktreePs(): Promise<OrcaResult<LocalRows<WorktreePsRow>>> {
    this.calls.push("worktreePs");
    if (this.failing.has("worktreePs")) return fail("runtime_unreachable");
    return { ok: true, value: rows(this.ps) };
  }
  async workerList(): Promise<OrcaResult<LocalRows<WorkerRow>>> {
    this.calls.push("workerList");
    if (this.failing.has("workerList")) return fail("runtime_unreachable");
    return { ok: true, value: rows(this.workers) };
  }
  async worktreeRm(a: { worktree: string }): Promise<OrcaResult<Record<string, unknown>>> {
    this.calls.push(`worktreeRm ${a.worktree}`);
    if (this.rmError) return fail(this.rmError);
    this.cards = this.cards.filter((c) => `id:${c.id}` !== a.worktree);
    return { ok: true, value: { removed: true } };
  }
}

export type Pr = { number: number; state: "open" | "closed"; merged_at: string | null; head: { sha: string; ref: string } };

/** GitHub as REAPER asks it: open PRs, PRs by branch, HEAD-in-PR comparison, commit lookup. */
export class FakeGh implements GhClient {
  prs: Pr[] = [];
  /** Commits GitHub knows. */
  known = new Set<string>();
  messages = new Map<string, string>();
  /** Branch name → the sha GitHub has at its tip. */
  branches = new Map<string, string>();
  down = false;
  paths: string[] = [];
  /** The repository's spelling; like a fine-grained token on a private repo, any other case is 404. */
  repo = "acme/api";

  async get<T>(path: string): Promise<GhResponse<T>> {
    this.paths.push(path);
    if (this.down) return { kind: "error", status: null, message: "gh: network down" };
    const ok = (data: unknown) => ({ kind: "ok", status: 200, data }) as GhResponse<T>;
    const prefix = `/repos/${this.repo}/`;
    const full = new URL(path, "https://api.invalid/");
    if (!full.pathname.startsWith(prefix)) return { kind: "error", status: 404, message: `fake gh: ${path}` };
    const url = new URL(`/repos/acme/api/${full.pathname.slice(prefix.length)}${full.search}`, "https://api.invalid/");
    const owner = this.repo.split("/")[0];
    let m = /^\/repos\/acme\/api\/pulls$/.exec(url.pathname);
    if (m) {
      const state = url.searchParams.get("state");
      const head = url.searchParams.get("head");
      // Like GitHub, a head filter without a branch is ignored and the newest PRs come back.
      if (head && !head.endsWith(":")) return ok(this.prs.filter((p) => `${owner}:${p.head.ref}` === head));
      if (head) return ok([...this.prs].sort((a, b) => b.number - a.number));
      if (url.searchParams.get("page") !== "1") return ok([]);
      return ok(this.prs.filter((p) => state === "all" || p.state === state));
    }
    m = /^\/repos\/acme\/api\/compare\/([0-9a-f]+)\.\.\.([0-9a-f]+)$/.exec(url.pathname);
    if (m) {
      if (!this.known.has(m[2] ?? "")) return { kind: "error", status: 404, message: "Not Found" };
      return ok({ status: m[1] === m[2] ? "identical" : "ahead", ahead_by: m[1] === m[2] ? 0 : 1 });
    }
    m = /^\/repos\/acme\/api\/commits\/(.+)$/.exec(url.pathname);
    if (m) {
      const ref = decodeURIComponent(m[1] ?? "");
      const sha = this.branches.get(ref) ?? ref;
      if (!this.known.has(sha)) return { kind: "error", status: 422, message: "No commit found" };
      return ok({ sha, commit: { message: this.messages.get(sha) ?? "" } });
    }
    return { kind: "error", status: 404, message: `fake gh: ${path}` };
  }
}

/** Docker as REAPER may run it; any other form fails the test. */
export class FakeDocker {
  daemon = true;
  /** inspect fails with an error that is not "No such ...". */
  inspectError = false;
  /** id → running (containers) or present (others). */
  objects = new Map<string, { kind: string; running?: boolean; inUse?: boolean }>();
  calls: string[] = [];

  exec: Exec = async (file, args) => {
    const r = (code: number, stdout = ""): ExecResult => ({ code, stdout, stderr: code ? "error" : "" });
    if (file !== "docker") return realExec(file, args);
    const line = args.join(" ");
    this.calls.push(line);
    if (/\bprune\b|\bdown\b|(^| )-f( |$)|--force|--filter|label=/.test(line)) throw new Error(`forbidden docker call: ${line}`);
    const [kind, verb, ...rest] = args;
    if (kind === "version") return this.daemon ? r(0, "27.0.0") : r(1);
    if (!this.daemon) return r(1);
    const id = rest.at(-1) ?? "";
    const o = this.objects.get(id);
    if (verb === "inspect") {
      if (this.inspectError) return r(1);
      if (!o || o.kind !== kind) return { code: 1, stdout: "", stderr: `Error: No such ${kind}: ${id}` };
      return r(0, kind === "container" ? String(o.running === true) : "[]");
    }
    if (verb === "rm") {
      if (!o || o.kind !== kind) return r(1);
      if (o.running || o.inUse) return r(1);
      this.objects.delete(id);
      return r(0, id);
    }
    throw new Error(`unexpected docker call: ${line}`);
  };
}

const realExec: Exec = async (file, args) => {
  if (file !== "git") throw new Error(`REAPER test ran ${file}`);
  try {
    return { code: 0, stdout: execFileSync(file, [...args], { encoding: "utf8" }), stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
};

export type World = {
  orca: FakeOrca;
  gh: FakeGh;
  docker: FakeDocker;
  store: Store;
  clock: { now: number };
  config: ReaperConfig | null;
  load: LoadSample;
  /** The timer period the round judges a pause by; unset in the scenarios that predate decision 182. */
  intervalMs?: number;
  round(o?: ReapOptions): Promise<ReapReport>;
  types(type: string): Record<string, unknown>[];
};

export function world(): World {
  const clock = { now: Date.parse("2026-11-10T00:00:00Z") };
  const store = Store.open({ path: ":memory:", clock: () => new Date(clock.now).toISOString() });
  const w: World = {
    orca: new FakeOrca(),
    gh: new FakeGh(),
    docker: new FakeDocker(),
    store,
    clock,
    config: CONFIG,
    load: { load5: 0.5, cpus: 8 },
    round: (o = {}) => {
      const deps: ReaperDeps = {
        orca: w.orca,
        gh: w.gh,
        exec: w.docker.exec,
        events: (f) => store.events(f),
        append: (e) => store.append(e),
        now: () => clock.now,
        config: w.config,
        sample: () => w.load,
        ...(w.intervalMs ? { intervalMs: w.intervalMs } : {}),
      };
      return reapRound(deps, o);
    },
    types: (type) => store.events({ type }).map((e) => e.payload as Record<string, unknown>),
  };
  return w;
}

/** A card whose PR merged with this HEAD: finished, clean, pushed. */
export function finishedCard(w: World, name: string): WorktreeRow {
  const repo = makeRepo(name);
  const c = card(name, repo);
  w.orca.cards.push(c);
  w.gh.prs.push({ number: w.gh.prs.length + 1, state: "closed", merged_at: "2026-11-09T00:00:00Z", head: { sha: repo.head, ref: name } });
  w.gh.known.add(repo.head);
  return c;
}

/** Runs rounds `gap` minutes apart until `n` have run; returns the last report. */
export async function rounds(w: World, n: number, gapMin = 20): Promise<ReapReport> {
  let last: ReapReport | null = null;
  for (let i = 0; i < n; i++) {
    if (i > 0) w.clock.now += gapMin * MIN;
    last = await w.round();
  }
  if (!last) throw new Error("no round");
  return last;
}

/** Calls REAPER must never make, on any path (decision 74 O-12, 82 R6, 86 ①). */
export function assertNeverForbidden(w: World): void {
  for (const c of w.orca.calls) {
    if (/release|terminal|force|allow-failed/i.test(c)) throw new Error(`forbidden orca call: ${c}`);
  }
}
