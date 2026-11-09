import { createOrcaAdapter, type ExecResult, type OrcaAdapter, Store } from "../../core/index.ts";
import { createFakeOrca, type FakeReply } from "../fake-orca/index.ts";

// A stateful fake Orca for the decision loop: gates, tasks and sends change as the core calls them,
// so a second call sees what the first one did (the static recordings cannot show that).

export type WorldTask = { id: string; run: string; status: string; dispatchId?: string; title?: string };
export type WorldGate = { id: string; taskId: string; status: string; question: string; resolution?: string };
export type WorldSend = { to: string; subject: string; body: string; type: string };

export interface World {
  readonly store: Store;
  readonly orca: OrcaAdapter;
  readonly tasks: Map<string, WorldTask>;
  readonly gates: Map<string, WorldGate>;
  readonly sends: WorldSend[];
  /** Every orca call as its subcommand words, e.g. "orchestration gate-resolve". */
  calls(name?: string): string[][];
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

export function createWorld(tasks: WorldTask[], o: { failSend?: boolean; currentRun?: string } = {}): World {
  const taskMap = new Map(tasks.map((t) => [t.id, { ...t }]));
  const gates = new Map<string, WorldGate>();
  const sends: WorldSend[] = [];
  let n = 0;
  const runOf = (task: string) => taskMap.get(task)?.run;
  const replies: Record<string, FakeReply> = {
    "orchestration-run-current": () => ok({ runId: o.currentRun ?? null }),
    "orchestration-task-list": (args: readonly string[]) => {
      const run = flag(args, "run");
      const rows = [...taskMap.values()].filter((t) => t.run === run);
      return ok({ tasks: rows.map(({ run: _r, ...t }) => ({ ...t, title: t.title ?? t.id })), runId: run });
    },
    "orchestration-task-create": (args: readonly string[]) => {
      const id = `task_9${String(++n).padStart(11, "0")}`;
      taskMap.set(id, { id, run: flag(args, "run") ?? "run_unbound", status: "pending", title: flag(args, "task-title") ?? id });
      return ok({ task: { id } });
    },
    "orchestration-gate-create": (args: readonly string[]) => {
      const task = flag(args, "task") ?? "";
      if (!taskMap.has(task)) return err("task_not_found");
      const id = `gate_${String(++n).padStart(12, "0")}`;
      gates.set(id, { id, taskId: task, status: "pending", question: flag(args, "question") ?? "" });
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
      if (o.failSend) return err("recipient_not_found");
      sends.push({
        to: flag(args, "to") ?? "",
        subject: flag(args, "subject") ?? "",
        body: flag(args, "body") ?? "",
        type: flag(args, "type") ?? "",
      });
      return ok({ message: { id: `msg_${String(++n).padStart(12, "0")}` } });
    },
  };
  const fake = createFakeOrca({ replies });
  const store = Store.open({ path: ":memory:" });
  return {
    store,
    orca: createOrcaAdapter(fake.exec),
    tasks: taskMap,
    gates,
    sends,
    calls: (name) => {
      const words = fake.calls.filter((c) => c[0] === "orca").map((c) => c.slice(1, 3));
      return name ? words.filter((w) => w.join(" ") === name) : words;
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
