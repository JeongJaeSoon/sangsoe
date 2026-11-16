// A watched fleet for pr-monitor round-cost tests (decision 329): many repositories, many PRs that
// are not sangsoe's, and a fake gh and Orca that charge a delay per call to a clock. The clock is
// virtual by default (each call moves `now`), or real when `real` is set (each call sleeps).
import {
  DEFAULT_MONITOR_CONFIG,
  type GhClient,
  type GhResponse,
  type MonitorDeps,
  nullChatProvider,
  type OrcaAdapter,
  Store,
} from "../../core/index.ts";

export const FLEET_NOW = Date.parse("2026-11-17T12:00:00Z");
export const CAP_MS = 90_000;

export type FleetOptions = {
  repos?: number;
  /** Merged PRs per repository nobody in sangsoe opened (another person's work). */
  merged?: number;
  /** Open PRs per repository on no local workspace. */
  open?: number;
  /** Repository indexes (0-based) with `tracked` open PRs on a local workspace that Orca links to a Task. */
  trackedIn?: number[];
  tracked?: number;
  ghMs?: number;
  orcaMs?: number;
  real?: boolean;
};

export type Charge = { repo: string; stage: string; ms: number };

const ok = (data: unknown): GhResponse<unknown> => ({ kind: "ok", status: 200, data });
const pad = (n: number) => String(n).padStart(2, "0");
export const repoName = (i: number) => `acme/app-${pad(i + 1)}`;
const url = (repo: string, n: number) => `https://github.com/${repo}/pull/${n}`;

export function fleet(o: FleetOptions = {}) {
  const repos = Array.from({ length: o.repos ?? 11 }, (_, i) => repoName(i));
  let ghMs = o.ghMs ?? 400;
  let orcaMs = o.orcaMs ?? 700;
  const delays = (d: { ghMs?: number; orcaMs?: number }) => {
    ghMs = d.ghMs ?? ghMs;
    orcaMs = d.orcaMs ?? orcaMs;
  };
  const store = Store.open({ path: ":memory:" });
  let virtual = FLEET_NOW;
  const now = () => (o.real ? Date.now() : virtual);
  const charges: Charge[] = [];
  let current = repos[0] ?? "";
  let onCharge: (() => void) | null = null;

  const charge = async (repo: string | undefined, stage: string, ms: number) => {
    if (repo) current = repo;
    charges.push({ repo: current, stage, ms });
    if (o.real) await new Promise((r) => setTimeout(r, ms));
    else {
      virtual += ms;
      await Promise.resolve();
    }
    onCharge?.();
  };

  const routes = new Map<string, unknown>();
  const refs = new Map<string, unknown[]>();
  /** PR URLs whose `reference find` fails. */
  const unreadable = new Set<string>();
  const worktrees: { id: string; projectId: string; branch: string; isArchived: boolean; displayName: string; head?: string }[] = [];
  const dispatches = new Map<string, { taskId: string; runId: string; liveness: string }>();
  const pull = (repo: string, n: number, extra: Record<string, unknown> = {}) => ({
    number: n,
    merged_at: null,
    updated_at: "2026-11-17T10:00:00Z",
    user: { login: `dev${n % 7}` },
    head: { sha: n.toString(16).padStart(40, "0"), ref: `topic-${n}`, repo: { full_name: repo } },
    base: { ref: "main" },
    labels: [],
    ...extra,
  });

  repos.forEach((repo, i) => {
    const open = Array.from({ length: o.open ?? 5 }, (_, k) => pull(repo, 500 + k));
    const merged = Array.from({ length: o.merged ?? 30 }, (_, k) =>
      pull(repo, 100 + k, { merged_at: `2026-11-1${k % 7}T0${k % 10}:00:00Z`, updated_at: `2026-11-1${k % 7}T0${k % 10}:00:00Z` }),
    );
    if ((o.trackedIn ?? [0, repos.length - 1]).includes(i)) {
      for (let k = 0; k < (o.tracked ?? 1); k++) {
        const n = 900 + k;
        const task = `task_${pad(i + 1)}_${k}`;
        const branch = `task-${pad(i + 1)}-${k}`;
        open.unshift(pull(repo, n, { head: { sha: "f".repeat(40), ref: branch, repo: { full_name: repo } } }));
        worktrees.push({ id: `ws_${task}`, projectId: `github:${repo}`, branch: `refs/heads/${branch}`, isArchived: false, displayName: task, head: "f".repeat(40) });
        dispatches.set(`ctx_${task}`, { taskId: task, runId: "run_lead", liveness: "live" });
        refs.set(url(repo, n), [{ workspace: { id: `ws_${task}`, hostId: "local", archived: false }, agents: [{ mailbox: `dispatch:ctx_${task}` }] }]);
      }
    }
    routes.set(`repos/${repo}/pulls?state=open&per_page=100`, open);
    routes.set(`repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=30`, merged);
  });

  const stageOf = (path: string) => {
    if (path.includes("pulls?state=open")) return "list open";
    if (path.includes("pulls?state=closed")) return "list closed";
    if (/\/(reviews|comments)\?|\/issues\/\d+\/events\?per_page=100$/.test(path)) return "reviews";
    if (path.includes("/files?") || path.includes("/events?per_page=100&page=")) return "tier";
    if (path.includes("/actions/")) return "main CI";
    return "other gh";
  };
  const repoOf = (path: string) => repos.find((r) => path.startsWith(`repos/${r}/`));

  const gh: GhClient = {
    get: async <T>(path: string) => {
      await charge(repoOf(path), stageOf(path), ghMs);
      const body = routes.get(path);
      return (body === undefined ? { kind: "error", status: 404, message: "Not Found" } : ok(body)) as GhResponse<T>;
    },
  };
  const orca = {
    referenceFind: async ({ query }: { query: string }) => {
      await charge(repos.find((r) => query.includes(`/${r}/`)), "reference find", orcaMs);
      if (unreadable.has(query)) return { ok: false, error: { code: "runtime_error", message: "orca did not answer" } };
      return { ok: true, value: { matches: refs.get(query) ?? [] } };
    },
    worktreeList: async () => {
      await charge(undefined, "worktree list", orcaMs);
      return { ok: true, value: { rows: worktrees, nonLocal: { rows: 0, hostIds: [] }, omittedHostIds: [], truncated: false } };
    },
    workerShow: async ({ dispatch }: { dispatch: string }) => {
      await charge(undefined, "worker show", orcaMs);
      const s = dispatches.get(dispatch);
      return s ? { ok: true, value: { dispatchId: dispatch, state: "running", ...s } } : { ok: false, error: { code: "not_found", message: "" } };
    },
    workerList: async () => {
      await charge(undefined, "worker list", orcaMs);
      return { ok: true, value: { rows: [], nonLocal: { rows: 0, hostIds: [] }, omittedHostIds: [], truncated: false } };
    },
    taskList: async () => {
      await charge(undefined, "task list", orcaMs);
      return { ok: true, value: [] };
    },
    referenceAdd: async () => {
      await charge(undefined, "reference add", orcaMs);
      return { ok: true, value: {} };
    },
  } as unknown as OrcaAdapter;

  const deps: MonitorDeps = {
    orca,
    exec: async () => ({ code: 1, stdout: "", stderr: "" }),
    events: (f) => store.events(f),
    append: (e) => store.append(e),
    now,
    config: DEFAULT_MONITOR_CONFIG,
    chat: nullChatProvider,
    sample: () => ({}),
    gh,
    ghBudget: () => undefined,
    watch: () => ({ repos, authors: [], linkedOnly: true, owners: [] }),
    tier: () => null,
  };

  /** A signal that aborts once `capMs` of this clock has passed since the call: the timer's cap. */
  const capped = (capMs = CAP_MS) => {
    const ctl = new AbortController();
    const start = now();
    if (o.real) {
      const h = setTimeout(() => ctl.abort(new Error("cap")), capMs);
      return { signal: ctl.signal, start, done: () => clearTimeout(h) };
    }
    onCharge = () => {
      if (now() - start >= capMs) ctl.abort(new Error("cap"));
    };
    const done = () => {
      onCharge = null;
    };
    return { signal: ctl.signal, start, done };
  };

  const rows = (type?: string) => store.events(type ? { type } : {}).filter((e) => e.source === "pr-monitor");
  /** Calls of one stage since charge index `from`. */
  const calls = (stage: string, from = 0) => charges.slice(from).filter((c) => c.stage === stage).length;
  return { repos, store, deps, charges, calls, capped, rows, now, routes, refs, unreadable, url, delays };
}

/** Milliseconds charged per repository and stage, as table rows. */
export function chargeTable(charges: readonly Charge[]): { repo: string; stage: string; calls: number; ms: number }[] {
  const by = new Map<string, { repo: string; stage: string; calls: number; ms: number }>();
  for (const c of charges) {
    const k = `${c.repo} ${c.stage}`;
    const row = by.get(k) ?? { repo: c.repo, stage: c.stage, calls: 0, ms: 0 };
    row.calls += 1;
    row.ms += c.ms;
    by.set(k, row);
  }
  return [...by.values()];
}
