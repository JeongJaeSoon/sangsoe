import { createOrcaAdapter, type ExecResult, type OrcaAdapter, Store } from "../../core/index.ts";
import { createFakeOrca, type FakeReply } from "../fake-orca/index.ts";

// A stateful fake Orca for the decision loop: gates, tasks and sends change as the core calls them,
// so a second call sees what the first one did (the static recordings cannot show that).

export type WorldTask = { id: string; run: string; status: string; dispatchId?: string; title?: string; result?: string };
/** `options` is the text Orca's gate-list returns: the JSON array gate-create was given, as a string. */
export type WorldGate = { id: string; taskId: string; status: string; question: string; options?: string; resolution?: string };
export type WorldSend = { to: string; subject: string; body: string; type: string };

export interface World {
  readonly store: Store;
  readonly orca: OrcaAdapter;
  readonly tasks: Map<string, WorldTask>;
  readonly gates: Map<string, WorldGate>;
  readonly sends: WorldSend[];
  /** Every orca call as its subcommand words; with a name ("orchestration gate-resolve"), those calls' full argv. */
  calls(name?: string): string[][];
  /** The Run run-current reports from now on, as when another Run's session makes the call. */
  useRun(run: string): void;
  /** Make sends to this address fail (null: none), as when that worker died. */
  failSendTo(address: string | null): void;
  /** The next send arrives but its response is lost, with or without Orca's request id on stderr. */
  loseNextSend(withRequestId: boolean): void;
}

const ok = (result: unknown): ExecResult => ({ code: 0, stdout: JSON.stringify({ ok: true, result }), stderr: "" });
const err = (code: string): ExecResult => ({
  code: 1,
  stdout: JSON.stringify({ ok: false, error: { code, message: code } }),
  stderr: "",
});

function flag(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

/**
 * `above`: lead Run → the Run whose Dispatch runs that lead's session, as Orca shows it (run-show's
 * coordinator_handle is that Dispatch's worker terminal). Given, run-show, worker-list and
 * worker-show answer from it; a Run not in it has a coordinator no Dispatch runs.
 */
export function createWorld(tasks: WorldTask[], o: { failSend?: boolean; currentRun?: string; above?: Record<string, string> } = {}): World {
  const taskMap = new Map(tasks.map((t) => [t.id, { ...t }]));
  const gates = new Map<string, WorldGate>();
  const sends: WorldSend[] = [];
  let n = 0;
  let created = 0;
  let current = o.currentRun ?? null;
  let deadAddress: string | null = null;
  let lose: boolean | null = null;
  const requests = new Map<string, string>();
  const runOf = (task: string) => taskMap.get(task)?.run;
  const replies: Record<string, FakeReply> = {
    "orchestration-run-current": () => ok({ runId: current }),
    "orchestration-task-list": (args: readonly string[]) => {
      const run = flag(args, "run");
      // Like Orca, `result` (where a cancel shows) comes only with --full.
      const full = args.includes("--full");
      const rows = [...taskMap.values()].filter((t) => t.run === run);
      // `--full` returns Orca's stored row: `task_title`, `dispatch_id`, `run_id`, no camelCase.
      return ok({
        tasks: rows.map(({ run: r, result, dispatchId, title, ...t }) =>
          full
            ? { ...t, run_id: r, task_title: title ?? t.id, result: result ?? null, ...(dispatchId ? { dispatch_id: dispatchId } : {}) }
            : { ...t, title: title ?? t.id, ...(dispatchId ? { dispatchId } : {}) },
        ),
        runId: run,
      });
    },
    "orchestration-task-create": (args: readonly string[]) => {
      // Its own counter, so a carrier Task does not shift the gate and message ids tests name.
      const id = `task_9${String(++created).padStart(11, "0")}`;
      taskMap.set(id, { id, run: flag(args, "run") ?? "run_unbound", status: "pending", title: flag(args, "task-title") ?? id });
      return ok({ task: { id } });
    },
    "orchestration-gate-create": (args: readonly string[]) => {
      const task = flag(args, "task") ?? "";
      if (!taskMap.has(task)) return err("task_not_found");
      // Orca refuses a gate on a Task whose supervised worker runs (test/fixtures/orca-refusals).
      const t = taskMap.get(task);
      if (t?.status === "dispatched" || t?.dispatchId) return err("task_not_startable");
      // "Create a decision gate blocking a task" (gate-create --help).
      if (t && (t.status === "pending" || t.status === "ready")) t.status = "blocked";
      const id = `gate_${String(++n).padStart(12, "0")}`;
      const options = flag(args, "options");
      gates.set(id, { id, taskId: task, status: "pending", question: flag(args, "question") ?? "", ...(options ? { options } : {}) });
      return ok({ gate: { id, taskId: task, status: "pending" } });
    },
    "orchestration-gate-resolve": (args: readonly string[]) => {
      const g = gates.get(flag(args, "id") ?? "");
      if (g?.status !== "pending") return err("gate_not_pending");
      g.status = "resolved";
      g.resolution = flag(args, "resolution") ?? "";
      return ok({ gate: { id: g.id, status: g.status } });
    },
    "orchestration-gate-list": (args: readonly string[]) => {
      const run = flag(args, "run");
      if (!run) return err("run_required");
      const task = flag(args, "task");
      const rows = [...gates.values()].filter((g) => runOf(g.taskId) === run && (!task || g.taskId === task));
      return ok({ gates: rows, runId: run });
    },
    "orchestration-send": (args: readonly string[]) => {
      if (o.failSend || flag(args, "to") === deadAddress) return err("recipient_not_found");
      // Orca replays a request it already did without sending again.
      const replay = flag(args, "retry-request");
      if (replay && requests.has(replay)) return ok({ message: { id: requests.get(replay) } });
      const msgId = `msg_${String(++n).padStart(12, "0")}`;
      sends.push({
        to: flag(args, "to") ?? "",
        subject: flag(args, "subject") ?? "",
        body: flag(args, "body") ?? "",
        type: flag(args, "type") ?? "",
      });
      if (lose !== null) {
        const withId = lose;
        lose = null;
        const req = `req_${String(++n).padStart(12, "0")}`;
        requests.set(req, msgId);
        return { code: null, stdout: "", stderr: withId ? `retry with --retry-request ${req}` : "", failure: "timeout" };
      }
      return ok({ message: { id: msgId } });
    },
    "orchestration-request-show": (args: readonly string[]) =>
      ok({ state: requests.has(flag(args, "request") ?? "") ? "completed" : "absent" }),
  };
  if (o.above) {
    const above = o.above;
    const term = (run: string) => `term_coord_${run}`;
    replies["orchestration-run-show"] = (args: readonly string[]) => {
      const id = flag(args, "id") ?? "";
      return ok({ run: { id, objective: id, coordinator_handle: term(id), consumer_generation: 1, legacy: 0 } });
    };
    replies["orchestration-worker-list"] = () =>
      ok({ workers: Object.keys(above).map((run) => ({ dispatchId: `ctx_lead_${run}`, taskId: `task_lead_${run}`, state: "ready", terminal: term(run), host: "local" })) });
    replies["orchestration-worker-show"] = (args: readonly string[]) => {
      const run = (flag(args, "dispatch") ?? "").replace(/^ctx_lead_/, "");
      return ok({ dispatchId: `ctx_lead_${run}`, taskId: `task_lead_${run}`, runId: above[run], state: "ready", terminal: term(run) });
    };
  }
  const fake = createFakeOrca({ replies });
  const store = Store.open({ path: ":memory:" });
  return {
    store,
    orca: createOrcaAdapter(fake.exec),
    tasks: taskMap,
    gates,
    sends,
    calls: (name) => {
      const orca = fake.calls.filter((c) => c[0] === "orca");
      // Named: each call's full argv, so a test can read its flags.
      return name ? orca.filter((c) => c.slice(1, 3).join(" ") === name).map((c) => c.slice(1)) : orca.map((c) => c.slice(1, 3));
    },
    useRun: (run) => {
      current = run;
    },
    failSendTo: (address) => {
      deadAddress = address;
    },
    loseNextSend: (withRequestId) => {
      lose = withRequestId;
    },
  };
}

/** The owner's words as the UserPromptSubmit hook would record them; returns the row's seq. */
export function ownerSays(store: Store, text: string): number {
  return store.appendOwnerAction(
    { type: "owner_action", source: "UserPromptSubmit", payload: { origin: "chat", summary: text, hash: `h-${text.length}` } },
    text,
  ).seq;
}
