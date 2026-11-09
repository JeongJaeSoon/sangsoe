import { createOrcaAdapter, type ExecResult, type OrcaAdapter, type OrcaSnapshot, readSnapshot, Store, type ViewInput } from "../../core/index.ts";
import { createFakeOrca, type FakeReply } from "../fake-orca/index.ts";

// A stateful fake Orca for GRAPH: Tasks carry deps the way `task-list --full` prints them (a JSON
// string), a Task moves pending → ready when every dep completes, and a cancel is failed + result
// "cancelled". Sends are kept so a test can count the wakes.

export type GTask = { id: string; run: string; status: string; deps: string[]; parent: string | null; title: string; result?: string };
export type GSend = { to: string; subject: string };

export interface GraphWorld {
  readonly store: Store;
  readonly orca: OrcaAdapter;
  readonly tasks: Map<string, GTask>;
  readonly sends: GSend[];
  task(id: string, run: string, deps?: string[]): GTask;
  complete(id: string): void;
  cancel(id: string): void;
  dispatch(id: string): void;
  snapshot(runs?: string[]): Promise<OrcaSnapshot>;
  input(now?: string, runs?: string[]): Promise<ViewInput>;
  /** Make one Run's task-list fail, as when Orca cannot read it. */
  failRun(run: string | null): void;
  /** task-create fails once this many more creates have succeeded (null: never). */
  failCreateAfter(n: number | null): void;
}

const ok = (result: unknown): ExecResult => ({ code: 0, stdout: JSON.stringify({ ok: true, result }), stderr: "" });
const err = (code: string): ExecResult => ({ code: 1, stdout: JSON.stringify({ ok: false, error: { code, message: code } }), stderr: "" });
const flag = (args: readonly string[], name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

export const NOW = "2026-11-10T09:00:00.000Z";

export function createGraphWorld(): GraphWorld {
  const tasks = new Map<string, GTask>();
  const sends: GSend[] = [];
  let n = 0;
  let failing: string | null = null;
  let createsLeft: number | null = null;
  const settle = () => {
    for (const t of tasks.values()) {
      if (t.status === "pending" && t.deps.every((d) => tasks.get(d)?.status === "completed")) t.status = "ready";
    }
  };
  const add = (id: string, run: string, deps: string[], parent: string | null, title: string) => {
    const t: GTask = { id, run, status: "pending", deps, parent, title };
    tasks.set(id, t);
    settle();
    return t;
  };
  const replies: Record<string, FakeReply> = {
    "orchestration-task-list": (args: readonly string[]) => {
      const run = flag(args, "run");
      if (run === failing) return err("run_unreadable");
      const full = args.includes("--full");
      const rows = [...tasks.values()]
        .filter((t) => t.run === run)
        .map((t) => ({
          id: t.id,
          status: t.status,
          title: t.title,
          ...(full ? { run_id: t.run, parent_id: t.parent, deps: JSON.stringify(t.deps), ...(t.result ? { result: t.result } : {}) } : {}),
        }));
      return ok({ tasks: rows, runId: run });
    },
    "orchestration-task-create": (args: readonly string[]) => {
      if (createsLeft !== null && createsLeft-- <= 0) return err("orca_unavailable");
      const deps = JSON.parse(flag(args, "deps") ?? "[]") as string[];
      const run = flag(args, "run") ?? "run_unbound";
      if (deps.some((d) => tasks.get(d)?.run !== run)) return err("invalid_dependency");
      const id = `task_g${String(++n).padStart(10, "0")}`;
      add(id, run, deps, flag(args, "parent") ?? null, flag(args, "task-title") ?? id);
      return ok({ task: { id } });
    },
    "orchestration-send": (args: readonly string[]) => {
      sends.push({ to: flag(args, "to") ?? "", subject: flag(args, "subject") ?? "" });
      return ok({ message: { id: `msg_g${String(++n).padStart(10, "0")}` } });
    },
  };
  const fake = createFakeOrca({ replies });
  const orca = createOrcaAdapter(fake.exec);
  const store = Store.open({ path: ":memory:" });
  const runsOf = () => [...new Set([...tasks.values()].map((t) => t.run))];
  const world: GraphWorld = {
    store,
    orca,
    tasks,
    sends,
    task: (id, run, deps = []) => add(id, run, deps, null, id),
    complete: (id) => {
      (tasks.get(id) as GTask).status = "completed";
      settle();
    },
    cancel: (id) => {
      const t = tasks.get(id) as GTask;
      t.status = "failed";
      t.result = "cancelled";
    },
    dispatch: (id) => {
      (tasks.get(id) as GTask).status = "dispatched";
    },
    snapshot: async (runs) => (await readSnapshot(orca, runs ?? runsOf())).snapshot,
    input: async (now = NOW, runs) => ({ orca: await world.snapshot(runs), events: store.events(), now }),
    failRun: (run) => {
      failing = run;
    },
    failCreateAfter: (n) => {
      createsLeft = n;
    },
  };
  return world;
}

/** Binds an existing Task to an iNNN alias the way createItem does. */
export function bindItem(w: GraphWorld, task: string, alias: string, extra: Record<string, unknown> = {}): void {
  w.store.append({ type: "item_created", source: "core:item", entity: "task", entity_id: task, payload: { task, alias, who: "lead:api", done_when: "done", owner_action: 0 } });
  if (Object.keys(extra).length > 0) w.store.append({ type: "item_extra_set", source: "lead:api", payload: { task, ...extra } as never });
}
