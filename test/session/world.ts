import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOrcaAdapter, type CoreDeps, type ExecResult, type OrcaAdapter, Store } from "../../core/index.ts";
import { createFakeOrca, type FakeReply } from "../fake-orca/index.ts";

// A fake Orca for the recording hooks: one worktree whose Dispatch works a Task with a given spec, a
// run-current answer, a Run mailbox, and the sends the hooks make.

export const WORKTREE = "wt_000000000001";
export const DISPATCH = "ctx_000000000001";
export const TASK = "task_000000000001";
export const TASK_RUN = "run_000000000001";

/** `run` is the mailbox it sits in (any when absent); `subject` defaults to the type. */
export type Mail = { id: string; type: string; body: string; subject?: string; run?: string };
export type Sent = { to: string; type: string; subject: string; body: string; dispatchId?: string };

export interface SessionWorld extends CoreDeps {
  readonly store: Store;
  readonly orca: OrcaAdapter;
  /** The worktree's path; a session whose cwd is inside it is the dispatched one. */
  readonly dir: string;
  readonly sends: Sent[];
  readonly mail: Mail[];
  spec: string | undefined;
  heldRun: string | null;
  dispatched: boolean;
  /** Extra Tasks task-list answers for a Run, beside the dispatched one. */
  readonly runTasks: Map<string, { id: string; status: string; title: string }[]>;
  /** task-list answers an error while set. */
  failTaskList: boolean;
  /** run-current answers an error while set. */
  failRunCurrent: boolean;
  /** dispatch-show's status for TASK: `dispatched` while open, `completed` after worker_done. */
  dispatchStatus: string;
  /** `worktree ps` rows; null answers an error. */
  psRows: Record<string, unknown>[] | null;
  calls(): string[][];
}

const ok = (result: unknown): ExecResult => ({ code: 0, stdout: JSON.stringify({ ok: true, result }), stderr: "" });
const flag = (args: readonly string[], name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

export function createSessionWorld(o: { spec?: string; heldRun?: string | null; dispatched?: boolean; clock?: () => string } = {}): SessionWorld {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "sangsoe-session-")));
  const sends: Sent[] = [];
  const mail: Mail[] = [];
  const runTasks = new Map<string, { id: string; status: string; title: string }[]>();
  let n = 0;
  const w = {
    dir,
    sends,
    mail,
    runTasks,
    spec: "spec" in o ? o.spec : "sangsoe-role: worker\nbrief",
    heldRun: o.heldRun ?? null,
    dispatched: o.dispatched ?? true,
    failTaskList: false,
    failRunCurrent: false,
    dispatchStatus: "dispatched",
    psRows: null as Record<string, unknown>[] | null,
  };
  const replies: Record<string, FakeReply> = {
    "worktree-list": () =>
      ok({
        worktrees: [
          { id: "wt_main", hostId: "local", path: "/", isMainWorktree: true },
          { id: WORKTREE, hostId: "local", path: dir, isMainWorktree: false },
        ],
      }),
    // Like Orca: without --run the list is scoped to the Run bound to the caller, or every Run when unbound.
    "orchestration-worker-list": (args: readonly string[]) => {
      const scope = flag(args, "run") ?? w.heldRun;
      const mine = w.dispatched && (scope === null || scope === TASK_RUN);
      return ok({ workers: mine ? [{ dispatchId: DISPATCH, taskId: TASK, state: "running", workspace: WORKTREE, host: "local" }] : [], scope: { source: flag(args, "run") ? "flag" : w.heldRun ? "bound" : "all" } });
    },
    "orchestration-run-list": () => ok({ runs: [{ id: "run_lead", objective: "x" }, { id: TASK_RUN, objective: "y" }] }),
    "orchestration-worker-show": () => ok({ dispatchId: DISPATCH, taskId: TASK, runId: TASK_RUN, state: "running" }),
    "orchestration-task-list": (args: readonly string[]) => {
      if (w.failTaskList) return { code: 1, stdout: JSON.stringify({ ok: false, error: { code: "runtime_unavailable", message: "down" } }), stderr: "" };
      const run = flag(args, "run") ?? "";
      const own = run === TASK_RUN ? [{ id: TASK, status: "dispatched", title: TASK, ...(w.spec === undefined ? {} : { spec: w.spec }) }] : [];
      return ok({ tasks: [...own, ...(runTasks.get(run) ?? [])] });
    },
    "orchestration-gate-list": () => ok({ gates: [] }),
    "worktree-ps": () =>
      w.psRows ? ok({ worktrees: w.psRows }) : { code: 1, stdout: JSON.stringify({ ok: false, error: { code: "runtime_unavailable", message: "down" } }), stderr: "" },
    "orchestration-dispatch-show": () =>
      ok({
        dispatch: {
          id: DISPATCH,
          run_id: TASK_RUN,
          task_id: TASK,
          status: w.dispatchStatus,
          depth: 1,
          failure_count: 0,
          dispatched_at: "2026-11-09 14:56:05",
          completed_at: w.dispatchStatus === "dispatched" ? null : "2026-11-09 15:56:05",
        },
      }),
    "orchestration-run-current": () =>
      w.failRunCurrent ? { code: 1, stdout: JSON.stringify({ ok: false, error: { code: "runtime_unavailable", message: "down" } }), stderr: "" } : ok({ runId: w.heldRun }),
    "orchestration-inbox": (args: readonly string[]) => {
      const box = flag(args, "terminal");
      const mine = mail.filter((m) => m.run === undefined || `run:${m.run}` === box);
      return ok({ messages: mine.map(({ run: _r, ...m }) => ({ ...m, from: "x", to: "y", subject: m.subject ?? m.type, handled: false })) });
    },
    "orchestration-send": (args: readonly string[]) => {
      const dispatchId = flag(args, "dispatch-id");
      sends.push({
        to: flag(args, "to") ?? "",
        type: flag(args, "type") ?? "",
        subject: flag(args, "subject") ?? "",
        body: flag(args, "body") ?? "",
        ...(dispatchId ? { dispatchId } : {}),
      });
      return ok({ message: { id: `msg_${String(++n).padStart(12, "0")}` } });
    },
  };
  const fake = createFakeOrca({ replies });
  const store = Store.open({ path: ":memory:", ...(o.clock ? { clock: o.clock } : {}) });
  return Object.assign(w, {
    store,
    orca: createOrcaAdapter(fake.exec),
    calls: () => fake.calls.filter((c) => c[0] === "orca").map((c) => c.slice(1, 3)),
  });
}

/** A transcript file holding these records, one JSON line each. */
export function transcript(dir: string, records: readonly unknown[]): string {
  const path = join(dir, `t-${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(path, `${records.map((r) => JSON.stringify(r)).join("\n")}\n`);
  return path;
}

/** One `!` command as Claude Code 2.1.310 writes it: the input record and its output child (P13). */
export function bang(uuid: string, command: string, stdout: string, stderr = "", ts = "2099-01-01T00:00:00.000Z"): unknown[] {
  return [
    { type: "user", uuid, parentUuid: null, timestamp: ts, message: { role: "user", content: `<bash-input>${command}</bash-input>` } },
    {
      type: "user",
      uuid: `${uuid}-out`,
      parentUuid: uuid,
      timestamp: ts,
      message: { role: "user", content: `<bash-stdout>${stdout}</bash-stdout><bash-stderr>${stderr}</bash-stderr>` },
    },
  ];
}
