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

export type Mail = { id: string; type: string; body: string };
export type Sent = { to: string; type: string; subject: string; body: string };

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
  calls(): string[][];
}

const ok = (result: unknown): ExecResult => ({ code: 0, stdout: JSON.stringify({ ok: true, result }), stderr: "" });
const flag = (args: readonly string[], name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

export function createSessionWorld(o: { spec?: string; heldRun?: string | null; dispatched?: boolean } = {}): SessionWorld {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "sangsoe-session-")));
  const sends: Sent[] = [];
  const mail: Mail[] = [];
  let n = 0;
  const w = {
    dir,
    sends,
    mail,
    spec: "spec" in o ? o.spec : "sangsoe-role: worker\nbrief",
    heldRun: o.heldRun ?? null,
    dispatched: o.dispatched ?? true,
  };
  const replies: Record<string, FakeReply> = {
    "worktree-list": () =>
      ok({
        worktrees: [
          { id: "wt_main", hostId: "local", path: "/", isMainWorktree: true },
          { id: WORKTREE, hostId: "local", path: dir, isMainWorktree: false },
        ],
      }),
    "orchestration-worker-list": () =>
      ok({ workers: w.dispatched ? [{ dispatchId: DISPATCH, taskId: TASK, state: "running", workspace: WORKTREE, host: "local" }] : [] }),
    "orchestration-worker-show": () => ok({ dispatchId: DISPATCH, taskId: TASK, runId: TASK_RUN, state: "running" }),
    "orchestration-task-list": (args: readonly string[]) =>
      ok({ tasks: flag(args, "run") === TASK_RUN ? [{ id: TASK, status: "dispatched", title: TASK, ...(w.spec === undefined ? {} : { spec: w.spec }) }] : [] }),
    "orchestration-run-current": () => ok({ runId: w.heldRun }),
    "orchestration-inbox": () => ok({ messages: mail.map((m) => ({ ...m, from: "x", to: "y", subject: m.type, handled: false })) }),
    "orchestration-send": (args: readonly string[]) => {
      sends.push({ to: flag(args, "to") ?? "", type: flag(args, "type") ?? "", subject: flag(args, "subject") ?? "", body: flag(args, "body") ?? "" });
      return ok({ message: { id: `msg_${String(++n).padStart(12, "0")}` } });
    },
  };
  const fake = createFakeOrca({ replies });
  const store = Store.open({ path: ":memory:" });
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
