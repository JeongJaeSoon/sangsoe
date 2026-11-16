import { basename } from "node:path";
import type { OrcaAdapter, TerminalRow, WorkerRow, WorktreePsRow } from "../contract/orca.ts";
import type { Host } from "../install/host.ts";
import { type InstalledTree, isStale, type Proc, processTable, serverEntry, workingDirs } from "../install/stale-sessions.ts";
import { settled } from "../recover/recover.ts";
import { handoffSubject } from "../session/handoff.ts";
import { agentRole, readRoleLine } from "../session/locate.ts";
import type { SessionLaunch } from "../session/session-start.ts";
import type { Store } from "../store/store.ts";
import { startUnit } from "./start.ts";
import type { Role, StartOutcome, StartRequest } from "./types.ts";

export type RestartPorts = {
  orca: OrcaAdapter;
  store: Pick<Store, "append" | "events" | "allocate">;
  host: Host;
  /** This CLI process: its pid finds the calling session among its parents; its folder names the caller's worktree. */
  self: { pid: number; cwd: string; terminal?: string | undefined };
  installed?: (entry: string) => InstalledTree | null;
  now?: () => number;
  exists?: (path: string) => boolean;
  sleep?: (ms: number) => Promise<void>;
  /** Decision 322's bind; default start_unit's core. */
  bind?: (req: StartRequest) => Promise<StartOutcome>;
  /** Each line as it is made: a run cut short by its caller's timeout still shows how far it got. */
  emit?: (line: string) => void;
};

export type RestartOptions = { task?: string; dryRun: boolean };

type Action = "restart" | "bind" | "self" | "skip";

export type RestartRow = {
  claudePid: number;
  cwd?: string;
  role?: Role;
  task?: string;
  dispatch?: string;
  run?: string;
  worktree?: string;
  terminal?: string;
  session?: string;
  state?: string;
  flags: string[];
  dropped: string[];
  action: Action;
  why: string;
  command?: string;
};

type Caller = { role: Role; run: string; worktree?: string; task?: string };

// Flags a restart carries over. Everything else is listed as dropped; the old session id goes too.
const KEEP = new Set(["--agent", "--name", "--model", "--effort", "--permission-mode", "--plugin-dir"]);
const PATH_FLAGS = new Set(["--plugin-dir"]);
const SESSION_FLAGS = new Set(["--resume", "-r", "--continue", "-c", "--session-id", "--fork-session"]);
// What `worktree ps` reports for an agent that is not mid-turn (as unit_close reads it, decision 263).
const AT_REST = new Set(["done", "idle"]);
const AGENT_WAIT_MS = 90_000;
const POLL_MS = 2_000;
const CONFIG_ENV = "CLAUDE_CONFIG_DIR";

export type Launch = { bin: string; flags: string[]; dropped: string[]; problem?: string };

const binOf = (args: string) => (args.split(/\s(?=--?[A-Za-z])/)[0] ?? "").trim();
const isClaude = (x: Proc) => basename(binOf(x.args)) === "claude";

/**
 * The claude binary and the flags a restart keeps, read back from `ps` arguments. `ps` joins argv with
 * spaces and a path may hold one (Orca's `--plugin-dir` sits under "Application Support"), so the line
 * is cut before each `-x`/`--x` word, and a path flag's value must exist as read.
 */
export function readLaunch(args: string, exists: (path: string) => boolean): Launch {
  const parts = args.split(/\s(?=--?[A-Za-z])/);
  const bin = (parts[0] ?? "").trim();
  const flags: string[] = [];
  const dropped: string[] = [];
  let problem: string | undefined;
  for (const raw of parts.slice(1)) {
    const seg = raw.trim();
    const eq = /^(--[A-Za-z][\w-]*)=(.*)$/.exec(seg);
    const name = eq?.[1] ?? seg.split(/\s/, 1)[0] ?? "";
    const value = eq ? (eq[2] ?? "") : seg.slice(name.length).trim();
    if (!KEEP.has(name)) {
      if (!SESSION_FLAGS.has(name)) dropped.push(seg);
      continue;
    }
    if (PATH_FLAGS.has(name)) {
      if (value === "" || !exists(value)) problem ??= `${name} 값 "${value}" 를 경로로 읽지 못했다`;
      else flags.push(name, value);
      continue;
    }
    const word = value.split(/\s+/, 1)[0] ?? "";
    if (word === "") {
      problem ??= `${name} 에 값이 없다`;
      continue;
    }
    flags.push(name, word);
    const rest = value.slice(word.length).trim();
    if (rest) dropped.push(rest);
  }
  if (basename(bin) !== "claude") problem ??= `세션 프로세스가 claude 가 아니다 (${bin.slice(0, 80)})`;
  return { bin, flags, dropped, ...(problem ? { problem } : {}) };
}

function flagOf(launch: Pick<Launch, "flags">, name: string): string | undefined {
  for (let i = 0; i < launch.flags.length; i += 2) if (launch.flags[i] === name) return launch.flags[i + 1];
  return undefined;
}

/**
 * Decision 330: how the session above `pid` was launched, for SessionStart to record. An Orca restore
 * re-opens a session without its --agent and --name, so only the first launch a session recorded
 * is trusted later. undefined when ps cannot be read or no claude is above `pid`.
 */
export function sessionLaunch(host: Host, pid: number, now: number): SessionLaunch | undefined {
  const procs = processTable(host, now);
  if (!procs) return undefined;
  const byPid = new Map(procs.map((x) => [x.pid, x]));
  const seen = new Set<number>();
  let at = byPid.get(pid);
  while (at && !isClaude(at) && !seen.has(at.pid)) {
    seen.add(at.pid);
    at = byPid.get(at.ppid);
  }
  if (!at || !isClaude(at)) return undefined;
  const l = readLaunch(at.args, () => true);
  const out: SessionLaunch = {};
  for (const [key, name] of [["agent", "--agent"], ["name", "--name"], ["model", "--model"], ["effort", "--effort"]] as const) {
    const v = flagOf(l, name);
    if (v) out[key] = v;
  }
  const dir = host.env[CONFIG_ENV];
  if (dir) out.configDir = dir;
  return out;
}

const RECORDED = [
  ["launch_agent", "--agent"],
  ["launch_name", "--name"],
  ["launch_model", "--model"],
  ["launch_effort", "--effort"],
] as const;

/**
 * The flags a restart passes: what ps shows, each recorded launch field written over it. Per field the
 * first non-empty value wins: a session alive before decision 330 recorded none, and a later
 * restore records what it lost.
 */
function withRecorded(store: RestartPorts["store"], session: string, launch: Launch): { launch: Launch; configDir?: string } {
  const rows = store.events({ type: "session_started" }).filter((e) => e.payload.session === session);
  const first = (field: string) => rows.map((e) => e.payload[field]).find((v): v is string => typeof v === "string" && v !== "");
  const flags = [...launch.flags];
  for (const [field, name] of RECORDED) {
    const v = first(field);
    if (!v) continue;
    const i = flags.findIndex((f, j) => j % 2 === 0 && f === name);
    if (i >= 0) flags[i + 1] = v;
    else flags.push(name, v);
  }
  const configDir = first("config_dir");
  return { launch: { ...launch, flags }, ...(configDir ? { configDir } : {}) };
}

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/**
 * The line the new terminal runs: wait until the old claude process is gone, then resume its session
 * with its own flags and settings folder. After worker-stop the wait ends at once; it keeps two
 * processes off one session.
 */
export function resumeCommand(oldPid: number, launch: Launch, session: string, configDir?: string): string {
  const env = configDir ? `${CONFIG_ENV}=${quote(configDir)} ` : "";
  return `while kill -0 ${oldPid} 2>/dev/null; do sleep 1; done; ${env}${[launch.bin, "--resume", session, ...launch.flags].map(quote).join(" ")}`;
}

const trim = (p: string) => p.replace(/\/+$/, "");
const within = (dir: string, root: string) => dir === trim(root) || dir.startsWith(`${trim(root)}/`);

const paneKeyOf = (t: TerminalRow) => (t.orphaned === true ? t.recordedPaneKey : t.tabId && t.leafId ? `${t.tabId}:${t.leafId}` : undefined);

/**
 * The claude agent `worktree ps` shows in this terminal's pane. A session Orca restored, or one a
 * terminal create started, carries no `agentIdentity` on its terminal row (measured 2026-11-17), so
 * the row's identity alone misses it.
 */
function claudeIn(t: TerminalRow, ps: WorktreePsRow[] | undefined, worktree: string): { state?: string } | undefined {
  const key = paneKeyOf(t);
  const agent = key ? ps?.find((r) => r.worktreeId === worktree)?.agents.find((a) => a.paneKey === key && a.agentType === "claude") : undefined;
  if (agent) return { state: agent.state };
  return t.agentIdentity ? {} : undefined;
}

/** The agent state `worktree ps` shows for one terminal; a reason string when it cannot tell. */
async function agentState(orca: OrcaAdapter, ps: WorktreePsRow[] | undefined, worktree: string, terminal: string): Promise<{ state: string } | { unknown: string }> {
  if (!ps) return { unknown: "worktree ps 를 다 읽지 못했다" };
  const list = await orca.terminalList({ worktree: `id:${worktree}` });
  if (!list.ok || list.value.truncated) return { unknown: "터미널 목록을 다 읽지 못했다" };
  const row = list.value.rows.find((t) => t.handle === terminal);
  const key = row && paneKeyOf(row);
  const agent = key ? ps.find((r) => r.worktreeId === worktree)?.agents.find((a) => a.paneKey === key) : undefined;
  return agent ? { state: agent.state } : { unknown: `터미널 ${terminal} 의 agent 를 worktree ps 에서 찾지 못했다` };
}

/** The Claude Code session SessionStart recorded last: under the Task, or with no Task for the Run the caller holds. */
function lastSession(store: RestartPorts["store"], o: { task: string } | { run: string; role: Role }): string | undefined {
  const rows = store.events({ type: "session_started" });
  const hit =
    "task" in o
      ? rows.findLast((e) => e.entity_id === o.task)
      : rows.findLast((e) => !e.entity_id && e.target === `run:${o.run}` && e.payload.role === o.role);
  return typeof hit?.payload.session === "string" ? hit.payload.session : undefined;
}

const MAX_PAGES = 10;

/** The unsettled Dispatches of one Run by worktree, from worker-list over that Run alone; null when a read failed. */
async function dispatchesIn(orca: OrcaAdapter, run: string): Promise<Map<string, WorkerRow> | null> {
  const out = new Map<string, WorkerRow>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await orca.workerList({ run, limit: 100, ...(cursor ? { cursor } : {}) });
    if (!r.ok) return null;
    for (const w of r.value.rows) if (w.workspace && !settled(w)) out.set(w.workspace, w);
    cursor = r.value.nextCursor;
    if (!cursor) break;
  }
  return out;
}

/** Each Task's spec in one Run, from one `task-list --full`; null when it cannot be read. */
async function specsIn(orca: OrcaAdapter, run: string): Promise<Map<string, string | undefined> | null> {
  const r = await orca.taskList({ run, full: true });
  if (!r.ok) return null;
  return new Map(
    r.value.map((t) => {
      const spec = (t as { spec?: unknown }).spec;
      return [t.id, typeof spec === "string" ? spec : undefined];
    }),
  );
}

/**
 * Who runs the command, read without a walk over every Run (the walk stalled the first measurement for
 * minutes): `--agent sangsoe:orchestrator` is the orchestrator; else the Task start_unit started in the
 * caller's worktree (`unit_started`), when its Dispatch is still open; else the declared role, an
 * orchestrator when none (an Orca restore drops --agent).
 */
async function findCaller(p: RestartPorts, claude: Proc | undefined, run: string, innermost: (dir: string) => string | undefined): Promise<Caller | { error: string }> {
  const declared = agentRole(claude ? flagOf(readLaunch(claude.args, () => true), "--agent") : undefined);
  if (declared === "orchestrator") return { role: "orchestrator", run };
  const tree = innermost(p.self.cwd);
  const started = tree ? p.store.events({ type: "unit_started" }).findLast((e) => e.payload.worktree === tree) : undefined;
  const task = started?.entity_id;
  const taskRun = typeof started?.payload.run === "string" ? started.payload.run : undefined;
  if (task && taskRun) {
    const d = await p.orca.dispatchShow({ task });
    if (d.ok && d.value.status === "dispatched" && !d.value.completed_at) {
      const specs = await specsIn(p.orca, taskRun);
      if (!specs) return { error: `부른 세션의 Task ${task} 를 읽지 못했다(task-list --run ${taskRun})` };
      const role = readRoleLine(specs.get(task));
      if (!role) return { error: `부른 세션의 Task ${task} 에 역할 줄이 없다` };
      return { role, run, task, ...(tree ? { worktree: tree } : {}) };
    }
  }
  const role = declared ?? "orchestrator";
  // A lead with no Task names its worktree as start_unit asks (decision 243); an orchestrator leaves it to start_unit.
  return { role, run, ...(role === "lead" && tree ? { worktree: tree } : {}) };
}

/**
 * Decision 330: which sangsoe sessions to restart and how, read without changing anything. With
 * `task`, the one session holding that Task, stale or not, bound alone when it already runs again;
 * without, every session whose MCP server runs an older install than the one its entry names now
 * (decision 247) and whose Dispatch lives in the caller's Run.
 */
export async function planRestart(p: RestartPorts, o: { task?: string }): Promise<{ caller: Caller; rows: RestartRow[] } | { error: string }> {
  const { orca, host } = p;
  const exists = p.exists ?? (() => false);
  const procs = processTable(host, (p.now ?? Date.now)());
  if (!procs) return { error: "ps 를 읽지 못해 도는 세션을 보지 못했다" };
  const byPid = new Map(procs.map((x) => [x.pid, x]));
  const ancestors: number[] = [];
  for (let at = byPid.get(p.self.pid); at && !ancestors.includes(at.ppid); at = byPid.get(at.ppid)) ancestors.push(at.ppid);
  const callerClaude = ancestors.map((pid) => byPid.get(pid)).find((x): x is Proc => !!x && isClaude(x));

  const current = await orca.runCurrent();
  const run = current.ok && typeof current.value.runId === "string" && current.value.runId !== "" ? current.value.runId : undefined;
  if (!run) return { error: "부른 세션이 쥔 Run 을 읽지 못했다(run-current): Run 을 쥔 오케스트레이터나 리드가 부른다" };
  const trees = await orca.worktreeList({ limit: 1000 });
  if (!trees.ok) return { error: `worktree 목록을 읽지 못했다(${trees.error.code})` };
  const innermost = (dir: string | undefined) =>
    dir ? trees.value.rows.filter((t) => within(dir, t.path)).sort((a, b) => b.path.length - a.path.length)[0] : undefined;
  const caller = await findCaller(p, callerClaude, run, (d) => innermost(d)?.id);
  if ("error" in caller) return caller;
  if (caller.role === "worker") return { error: "워커는 세션을 다시 띄우지 않는다: 그 Run 을 쥔 리드가 부른다" };

  const box = await orca.inbox({ terminal: `run:${run}`, limit: 50 });
  const handoffOf = (task: string) => (box.ok ? box.value.filter((m) => m.type === "handoff" && m.subject === handoffSubject(task)).at(-1)?.id : undefined);
  let psRows: Promise<WorktreePsRow[] | undefined> | undefined;
  const ps = () =>
    (psRows ??= orca.worktreePs({ limit: 1000 }).then((r) => (r.ok && !r.value.truncated ? r.value.rows : undefined)));

  type Held = { role: Role; task: string; dispatch: string; run: string; worktree: string; terminal: string };
  /** The row for an idle child: stop it, resume its session in a new terminal, bind it back. */
  const restartRow = async (base: Pick<RestartRow, "claudePid" | "cwd" | "flags" | "dropped">, launch: Launch, h: Held): Promise<RestartRow> => {
    const st = await agentState(orca, await ps(), h.worktree, h.terminal);
    const state = "state" in st ? st.state : undefined;
    const more = { ...base, ...h, ...(state ? { state } : {}) };
    if (!state) return { ...more, action: "skip", why: `쉬는지 알 수 없다: ${"unknown" in st ? st.unknown : ""}` };
    if (!AT_REST.has(state)) return { ...more, action: "skip", why: `턴 중이다(agent ${state}): 쉴 때 다시 부른다` };
    const session = lastSession(p.store, { task: h.task });
    if (!session) return { ...more, action: "skip", why: `Task ${h.task} 의 세션 id 가 store 에 없다(session_started)` };
    if (launch.problem) return { ...more, session, action: "skip", why: launch.problem };
    const r = withRecorded(p.store, session, launch);
    const handoff = handoffOf(h.task);
    return {
      ...more,
      flags: r.launch.flags,
      session,
      action: "restart",
      why: `쉬고 있다(${handoff ? `마지막 handoff ${handoff}` : "handoff 없음: --resume 이 대화를 그대로 잇는다"})`,
      command: resumeCommand(base.claudePid, r.launch, session, r.configDir),
    };
  };

  if (o.task !== undefined) return { caller, rows: await planTask(o.task) };

  const servers = procs.filter((x) => {
    const entry = serverEntry(x.args);
    return entry !== undefined && isStale(x.startedAt, entry, p.installed);
  });
  if (servers.length === 0) return { caller, rows: [] };
  const dirs = workingDirs(host, servers.map((s) => s.pid));
  const held = await dispatchesIn(orca, run);
  if (!held) return { error: `Run ${run} 의 워커 목록을 읽지 못했다(worker-list --run)` };
  const specs = await specsIn(orca, run);
  if (!specs) return { error: `Run ${run} 의 Task 목록을 읽지 못했다(task-list --run)` };

  const rows: RestartRow[] = [];
  for (const s of servers) {
    const claude = byPid.get(s.ppid);
    const cwd = dirs.get(s.pid);
    const launch = readLaunch(claude?.args ?? "", exists);
    const base = { claudePid: s.ppid, ...(cwd ? { cwd } : {}), flags: launch.flags, dropped: launch.dropped };
    const skip = (why: string, more: Partial<RestartRow> = {}): RestartRow => ({ ...base, ...more, action: "skip", why });
    if (!claude || !cwd) {
      rows.push(skip(!claude ? "MCP server 의 부모 프로세스가 없다" : "작업 폴더를 읽지 못했다"));
      continue;
    }
    const tree = innermost(cwd)?.id;
    if (ancestors.includes(s.ppid)) {
      if (caller.task) {
        rows.push(skip("이 명령을 부른 세션이다: Dispatch 를 쥔 세션은 그 Run 의 coordinator 가 다시 띄운다", { role: caller.role, task: caller.task }));
        continue;
      }
      const session = lastSession(p.store, { run, role: caller.role });
      if (!session || !tree || launch.problem) {
        rows.push(skip(`이 명령을 부른 세션이다: ${launch.problem ?? (session ? "worktree 를 찾지 못했다" : `Run ${run} 의 ${caller.role} 세션 id 가 store 에 없다`)}`, { role: caller.role }));
        continue;
      }
      const r = withRecorded(p.store, session, launch);
      rows.push({
        ...base,
        flags: r.launch.flags,
        role: caller.role,
        run,
        worktree: tree,
        session,
        action: "self",
        why: "이 명령을 부른 세션: 새 터미널이 이 세션이 끝나기를 기다렸다가 이어 띄운다",
        command: resumeCommand(s.ppid, r.launch, session, r.configDir),
      });
      continue;
    }
    if (!tree) {
      rows.push(skip("Orca worktree 밖의 세션이다(오너가 손으로 연 세션은 건드리지 않는다)"));
      continue;
    }
    const w = held.get(tree);
    if (!w) {
      rows.push(skip(`부른 쪽 Run(${run})에 이 worktree 의 Dispatch 가 없다: 다른 Run 의 세션은 그 Run 을 쥔 쪽이, 오너가 연 세션은 오너가 다시 띄운다`));
      continue;
    }
    const role = readRoleLine(specs.get(w.taskId));
    const ids = { task: w.taskId, dispatch: w.dispatchId, run, worktree: tree };
    if (!role) {
      rows.push(skip("sangsoe 역할 줄이 없는 Task 다(sangsoe 밖에서 시작한 세션은 건드리지 않는다)", ids));
      continue;
    }
    if (!w.terminal) {
      rows.push(skip(`Dispatch ${w.dispatchId} 의 터미널을 읽지 못했다`, { role, ...ids }));
      continue;
    }
    rows.push(await restartRow(base, launch, { role, ...ids, terminal: w.terminal }));
  }
  return { caller, rows };

  /** One Task's session: restarted when its Dispatch is open, bound alone when it already runs again. */
  async function planTask(task: string): Promise<RestartRow[]> {
    const d = await orca.dispatchShow({ task });
    if (!d.ok) return [];
    const w = await orca.workerShow({ dispatch: d.value.id });
    if (!w.ok || !w.value.workspace) return [];
    const tree = w.value.workspace;
    const claudes = (procs ?? []).filter(isClaude);
    const dirs = workingDirs(host, claudes.map((c) => c.pid));
    const here = claudes.filter((c) => innermost(dirs.get(c.pid))?.id === tree);
    const session = lastSession(p.store, { task });
    const resumed = session ? here.filter((c) => new RegExp(`(^|\\s)(--resume|-r)[\\s=]${session}(\\s|$)`).test(c.args)) : [];
    const proc = resumed[0] ?? here[0];
    if (!proc) return [];
    const launch = readLaunch(proc.args, exists);
    const base = { claudePid: proc.pid, ...(dirs.get(proc.pid) ? { cwd: dirs.get(proc.pid) as string } : {}), flags: launch.flags, dropped: launch.dropped };
    const ids = { task, dispatch: d.value.id, run: w.value.runId, worktree: tree };
    const skip = (why: string, more: Partial<RestartRow> = {}): RestartRow[] => [{ ...base, ...ids, ...more, action: "skip", why }];
    if (w.value.runId !== run) return skip(`Run ${w.value.runId} 의 Task 다: 그 Run 을 쥔 coordinator 가 다시 띄운다`);
    const specs = await specsIn(orca, run);
    const role = readRoleLine(specs?.get(task));
    if (!role) return skip(specs ? "sangsoe 역할 줄이 없는 Task 다" : `Run ${run} 의 Task 목록을 읽지 못했다`);
    const open = d.value.status === "dispatched" && !d.value.completed_at && !settled(w.value);
    if (open) {
      if (!w.value.terminal) return skip(`Dispatch ${d.value.id} 의 터미널을 읽지 못했다`, { role });
      if (here.length > 1) return skip(`worktree 에 claude 가 ${here.length}개 돈다: 어느 것이 이 Task 의 세션인지 모른다`, { role });
      return [await restartRow(base, launch, { role, ...ids, terminal: w.value.terminal })];
    }
    // The old Dispatch is over and the session already runs again (an Orca restore, or a restart cut short before its bind).
    if (!session || resumed.length !== 1) {
      return skip(`옛 Dispatch ${d.value.id} 는 끝났고 이 worktree 에 세션 ${session ?? "?"} 를 이어 띄운 claude 가 ${resumed.length}개다: 하나일 때 묶는다`, { role });
    }
    const terms = await orca.terminalList({ worktree: `id:${tree}` });
    if (!terms.ok || terms.value.truncated) return skip("터미널 목록을 다 읽지 못했다", { role, session });
    const rows = await ps();
    const agents = terms.value.rows.flatMap((t) => {
      const seen = t.handle === w.value.terminal ? undefined : claudeIn(t, rows, tree);
      return seen ? [{ t, state: seen.state }] : [];
    });
    const [only] = agents;
    if (!only || agents.length !== 1) return skip(`옛 터미널 말고 claude 가 보이는 터미널이 ${agents.length}개다: 하나일 때 묶는다`, { role, session });
    const handle = only.t.handle;
    return [
      { ...base, ...ids, role, session, terminal: handle, ...(only.state ? { state: only.state } : {}), action: "bind", why: `옛 Dispatch 가 끝났고 세션이 터미널 ${handle} 에서 이미 다시 떠 있다: 묶기만 한다` },
    ];
  }
}

function describe(r: RestartRow): string {
  const who = [r.role ?? "-", r.task ?? "-", r.dispatch ?? "-"].join(" ");
  const flags = r.flags.length > 0 ? r.flags.join(" ") : "-";
  const extra = r.dropped.length > 0 ? `  dropped ${r.dropped.join(" | ")}` : "";
  return `  pid ${r.claudePid}  ${who}  ${r.cwd ?? "-"}  session ${r.session ?? "-"}  state ${r.state ?? "-"}  flags ${flags}${extra}\n    → ${r.action}: ${r.why}`;
}

/** The Run's coordinator sees a terminal show up with claude in it before binding it (decision 322 (나)); bounded by the clock. */
async function waitAgent(p: RestartPorts, worktree: string, terminal: string): Promise<boolean> {
  const sleep = p.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = p.now ?? Date.now;
  const end = now() + AGENT_WAIT_MS;
  for (;;) {
    const list = await p.orca.terminalList({ worktree: `id:${worktree}` });
    const row = list.ok ? list.value.rows.find((t) => t.handle === terminal) : undefined;
    if (row?.agentIdentity) return true;
    if (row) {
      const ps = await p.orca.worktreePs({ limit: 1000 });
      if (ps.ok && claudeIn(row, ps.value.rows, worktree)) return true;
    }
    if (now() >= end) return false;
    await sleep(POLL_MS);
  }
}

type Say = (...lines: string[]) => void;

async function bindOne(p: RestartPorts, caller: Caller, r: RestartRow, terminal: string, say: Say): Promise<boolean> {
  const task = r.task as string;
  const again = `sangsoe restart --task ${task}`;
  const bind = p.bind ?? ((req: StartRequest) => startUnit({ orca: p.orca, store: p.store, slots: () => 0, cwd: () => p.self.cwd, source: "cli:restart" }, req));
  const out = await bind({
    requester: { role: caller.role, runId: caller.run, ...(caller.worktree ? { worktreeId: caller.worktree } : {}), ...(caller.task ? { taskId: caller.task } : {}) },
    childRole: r.role === "lead" ? "lead" : "worker",
    task: { id: task },
    agent: "claude",
    resume: { worktreeId: r.worktree as string, sessionId: r.session as string, terminal },
  });
  if (out.kind !== "resumed") {
    const why = out.kind === "refused" ? `${out.reason}: ${out.detail}` : out.kind;
    say(`  ✗ ${task}: 터미널 ${terminal} 에서 세션은 다시 떴지만 Task 에 묶지 못했다(${why})`, `    이어서: ${again} (묶기만 한다)`);
    return false;
  }
  say(`  ✓ ${task}: Dispatch ${out.from} → ${out.dispatchId}, 터미널 ${terminal}`);
  if (r.role === "lead") {
    // The lead's own workers hold its Run, which only it can reopen (Orca's recovery guide).
    const sent = await p.orca.send({
      to: terminal,
      type: "status",
      subject: "sangsoe restart: 다시 띄웠다(결정 330)",
      body: "업그레이드 뒤 이 세션을 claude --resume 으로 다시 띄워 원래 Task 에 묶었다. 이 Run 의 낡은 워커는 `sangsoe restart --stale` 로 다시 띄운다(--dry-run 으로 먼저 본다).",
    });
    if (!sent.ok) say(`    리드에게 알리지 못했다(${sent.error.code}): 리드가 sangsoe restart --stale 을 부르게 알린다`);
  }
  return true;
}

async function restartOne(p: RestartPorts, caller: Caller, r: RestartRow, say: Say): Promise<boolean> {
  const { orca } = p;
  const task = r.task as string;
  const worktree = r.worktree as string;
  const again = `sangsoe restart --task ${task}`;
  const stopped = await orca.workerStop({ dispatch: r.dispatch as string });
  if (!stopped.ok) {
    say(`  ✗ ${task}: worker-stop ${r.dispatch} 실패(${stopped.error.code}): 세션을 다시 띄우지 않았다. worker-show 로 그 Dispatch 를 읽고 다시 부른다`);
    return false;
  }
  const created = await orca.terminalCreate({ worktree: `id:${worktree}`, command: r.command as string, title: `restart ${task}` });
  if (!created.ok) {
    say(
      `  ✗ ${task}: Dispatch ${r.dispatch} 는 멈췄고 터미널 생성이 실패로 읽혔다(${created.error.code}: ${created.error.message.slice(0, 200)})`,
      `    먼저 ${again} --dry-run 으로 claude 가 이미 다시 떴는지 본다(떴으면 bind 줄). 없으면: orca terminal create --worktree ${quote(`id:${worktree}`)} --command ${quote(r.command as string)}`,
      `    그 뒤 ${again}`,
    );
    return false;
  }
  const terminal = created.value.handle;
  if (!(await waitAgent(p, worktree, terminal))) {
    say(`  ✗ ${task}: 터미널 ${terminal} 에 ${AGENT_WAIT_MS / 1000}초 안에 claude 가 붙지 않았다`, `    붙은 뒤: ${again} (묶기만 한다)`);
    return false;
  }
  return bindOne(p, caller, r, terminal, say);
}

async function restartSelf(p: RestartPorts, r: RestartRow, say: Say): Promise<boolean> {
  const created = await p.orca.terminalCreate({ worktree: `id:${r.worktree}`, command: r.command as string, title: `restart ${r.role}` });
  const ownLine = `/exit 뒤 이 터미널에서: ${r.command?.slice(r.command.indexOf("done; ") + "done; ".length)}`;
  if (!created.ok) {
    say(`  ✗ 이 세션: 새 터미널을 열지 못했다(${created.error.code})`, `    오너가 칠 한 줄: ${ownLine}`);
    return false;
  }
  say(
    `  ✓ 이 세션: 새 터미널 ${created.value.handle} 이 pid ${r.claudePid} 가 끝나기를 기다린다`,
    `    오너: Orca 에서 이 세션의 터미널${p.self.terminal ? ` ${p.self.terminal}` : ""} 을 닫으면(결정 301) 새 터미널이 세션을 이어 띄운다`,
  );
  return true;
}

/**
 * Decision 330: restart the caller's own children whose sessions run stale code (or the one `task`
 * names), each idle one by worker-stop, a new terminal running `claude --resume` with its flags, and
 * start_unit's resume (decision 322); a Task whose session already runs again is only bound. Then, for
 * a caller with no Dispatch, a terminal that resumes the caller once it ends. A dry run prints the plan
 * and changes nothing.
 */
export async function restartSessions(p: RestartPorts, o: RestartOptions): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const say: Say = (...ls) => {
    for (const l of ls) {
      lines.push(l);
      p.emit?.(l);
    }
  };
  const plan = await planRestart(p, o);
  if ("error" in plan) {
    say(`sangsoe restart: ${plan.error}`);
    return { code: 1, lines };
  }
  const { caller, rows } = plan;
  const what = o.task ? `Task ${o.task}` : "낡은 세션";
  say(`sangsoe restart: ${what} ${rows.length}개 (부른 쪽 ${caller.role}, Run ${caller.run})${o.dryRun ? " — dry-run, 바꾸지 않는다" : ""}`);
  if (rows.length === 0) {
    say(o.task ? `  Task ${o.task} 를 쥔 sangsoe 세션 프로세스를 찾지 못했다` : "  없다");
    return { code: o.task ? 1 : 0, lines };
  }
  for (const r of rows) {
    say(describe(r));
    if (r.command) say(`    command: ${r.command}`);
  }
  if (o.dryRun) return { code: 0, lines };
  let ok = true;
  say("결과:");
  for (const r of rows) {
    if (r.action === "bind") ok = (await bindOne(p, caller, r, r.terminal as string, say)) && ok;
    if (r.action === "restart") ok = (await restartOne(p, caller, r, say)) && ok;
  }
  for (const r of rows.filter((x) => x.action === "self")) ok = (await restartSelf(p, r, say)) && ok;
  if (!rows.some((x) => x.action !== "skip")) say("  다시 띄운 세션 없음");
  return { code: ok ? 0 : 1, lines };
}
