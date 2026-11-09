import {
  type GhClient,
  type GhResponse,
  type ItemState,
  type OrcaAdapter,
  type OrcaPluginRow,
  type OwnerItemFacts,
  Store,
  type TaskRow,
  type VerifySpec,
  type ViewInput,
  type ViewTaskStatus,
} from "../../core/index.ts";

// The owner queue on an in-memory store with a clock the test moves, a fake Orca (tasks and
// plugins it can change) and a fake GitHub (paths the test answers). Nothing leaves the process.

export const RUN = "run_000000000001";
export const T0 = "2026-11-10T09:00:00.000Z";
export const later = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();

export interface OwnerWorld {
  readonly store: Store;
  readonly tasks: Map<string, TaskRow>;
  readonly plugins: OrcaPluginRow[];
  readonly gh: Map<string, unknown>;
  readonly ghCalls: string[];
  readonly orca: Pick<OrcaAdapter, "taskList" | "pluginList" | "taskUpdate">;
  readonly ghClient: GhClient;
  now: string;
  at(iso: string): void;
  item(task: string, a: { who?: string; verify?: VerifySpec; cmdHint?: string; status?: string }): string;
  input(): ViewInput;
  facts(): OwnerItemFacts[];
  state(task: string): ItemState;
}

function stateOf(t: TaskRow | undefined): ItemState {
  if (!t) return "planned";
  if (t.status === "completed") return "done";
  if (t.status === "failed") return t.result === "cancelled" ? "cancelled" : "blocked";
  if (t.status === "dispatched") return "in_progress";
  if (t.status === "ready") return "ready";
  return "planned";
}

export function ownerWorld(): OwnerWorld {
  let ts = T0;
  const store = Store.open({ path: ":memory:", clock: () => ts });
  const tasks = new Map<string, TaskRow>();
  const plugins: OrcaPluginRow[] = [];
  const gh = new Map<string, unknown>();
  const ghCalls: string[] = [];
  let n = 0;
  const w: OwnerWorld = {
    store,
    tasks,
    plugins,
    gh,
    ghCalls,
    get now() {
      return ts;
    },
    set now(v: string) {
      ts = v;
    },
    at(iso) {
      ts = iso;
    },
    orca: {
      taskList: async ({ run }) => ({ ok: true, value: run === RUN ? [...tasks.values()] : [] }),
      pluginList: async () => ({ ok: true, value: plugins }),
      taskUpdate: async ({ id, status, result }) => {
        const t = tasks.get(id);
        if (!t) return { ok: false, error: { code: "task_not_found", message: id } };
        t.status = status;
        if (result) t.result = result;
        return { ok: true, value: { task: { id } } };
      },
    },
    ghClient: {
      get: async <T>(path: string): Promise<GhResponse<T>> => {
        ghCalls.push(path);
        return gh.has(path) ? { kind: "ok", status: 200, data: gh.get(path) as T } : { kind: "error", status: 404, message: "Not Found" };
      },
    },
    item(task, a) {
      tasks.set(task, { id: task, status: a.status ?? "ready", title: task });
      const alias = `i${String(++n).padStart(3, "0")}`;
      store.append({ type: "item_created", source: "test", payload: { task, alias, who: a.who ?? "owner", done_when: "done", owner_action: 0 }, entity: "task", entity_id: task });
      if (a.verify || a.cmdHint) {
        store.append({
          type: "item_extra_set",
          source: "test",
          payload: { task, ...(a.verify ? { verify: a.verify } : {}), ...(a.cmdHint ? { cmd_hint: a.cmdHint } : {}) },
          entity: "task",
          entity_id: task,
        });
      }
      return alias;
    },
    input() {
      return {
        orca: {
          tasks: [...tasks.values()].map((t) => ({ id: t.id, runId: RUN, status: t.status as ViewTaskStatus, deps: [], ...(t.result ? { result: t.result } : {}) })),
          gates: [],
        },
        events: store.events(),
        now: ts,
      };
    },
    facts() {
      const events = store.events();
      return events
        .filter((e) => e.type === "item_created")
        .map((c) => {
          const task = String(c.payload.task);
          const extra: Record<string, unknown> = Object.assign({}, ...events.filter((e) => e.type === "item_extra_set" && e.payload.task === task).map((e) => e.payload));
          const closed = events.filter((e) => e.type === "item_transition" && e.payload.task === task && e.payload.to === "done").at(-1);
          return {
            task,
            alias: String(c.payload.alias),
            state: stateOf(tasks.get(task)),
            who: String(c.payload.who),
            execBy: typeof extra.exec_by === "string" ? extra.exec_by : null,
            whyOwner: typeof extra.why_owner === "string" ? extra.why_owner : null,
            since: c.ts,
            closedAt: closed?.ts ?? null,
          };
        });
    },
    state(task) {
      return stateOf(tasks.get(task));
    },
  };
  return w;
}

/** The owner's words as the UserPromptSubmit hook records them (U13 writes this row). */
export function ownerSays(w: OwnerWorld, text: string, session?: string): number {
  return w.store.appendOwnerAction(
    { type: "owner_action", source: "UserPromptSubmit", payload: { origin: "chat", summary: text, hash: `h-${text.length}`, ...(session ? { cc_session: session } : {}) } },
    text,
  ).seq;
}
