import { basename } from "node:path";
import type { OrcaAdapter, TerminalRow, WorktreePsRow } from "../contract/orca.ts";
import type { Host } from "../install/host.ts";
import { type InstalledTree, isStale, type Proc, processTable, serverEntry, workingDirs } from "../install/stale-sessions.ts";
import { agentRole, type Located, locate, readRoleLine } from "../session/locate.ts";
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
};

export type RestartOptions = { task?: string; dryRun: boolean };

type Action = "restart" | "self" | "skip";

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
const KEEP = new Set(["--agent", "--model", "--effort", "--permission-mode", "--plugin-dir"]);
const PATH_FLAGS = new Set(["--plugin-dir"]);
const SESSION_FLAGS = new Set(["--resume", "-r", "--continue", "-c", "--session-id", "--fork-session"]);
// What `worktree ps` reports for an agent that is not mid-turn (as unit_close reads it, decision 263).
const AT_REST = new Set(["done", "idle"]);
const AGENT_WAIT_MS = 90_000;
const POLL_MS = 2_000;

export type Launch = { bin: string; flags: string[]; dropped: string[]; problem?: string };

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

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/**
 * The line the new terminal runs: wait until the old claude process is gone, then resume its session
 * with its own flags. After worker-stop the wait ends at once; it keeps two processes off one session.
 */
export function resumeCommand(oldPid: number, launch: Launch, session: string): string {
  return `while kill -0 ${oldPid} 2>/dev/null; do sleep 1; done; ${[launch.bin, "--resume", session, ...launch.flags].map(quote).join(" ")}`;
}

const trim = (p: string) => p.replace(/\/+$/, "");
const within = (dir: string, root: string) => dir === trim(root) || dir.startsWith(`${trim(root)}/`);

const paneKeyOf = (t: TerminalRow) => (t.orphaned === true ? t.recordedPaneKey : t.tabId && t.leafId ? `${t.tabId}:${t.leafId}` : undefined);

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

function flagOf(launch: Launch, name: string): string | undefined {
  const i = launch.flags.indexOf(name);
  return i < 0 ? undefined : launch.flags[i + 1];
}

/**
 * Decision 330: which sangsoe sessions to restart and how, read without changing anything. With
 * `task`, the one session holding that Task's Dispatch, stale or not; without, every session whose
 * MCP server runs an older install than the one its entry names now (decision 247).
 */
export async function planRestart(p: RestartPorts, o: { task?: string }): Promise<{ caller: Caller; rows: RestartRow[] } | { error: string }> {
  const { orca, host } = p;
  const exists = p.exists ?? (() => false);
  const procs = processTable(host, (p.now ?? Date.now)());
  if (!procs) return { error: "ps 를 읽지 못해 도는 세션을 보지 못했다" };
  const byPid = new Map(procs.map((x) => [x.pid, x]));
  const ancestors = new Set<number>();
  for (let at = byPid.get(p.self.pid); at && !ancestors.has(at.ppid); at = byPid.get(at.ppid)) ancestors.add(at.ppid);
  const callerClaude = [...ancestors].map((pid) => byPid.get(pid)).find((x): x is Proc => !!x && basename(x.args.split(/\s(?=--?[A-Za-z])/)[0] ?? "") === "claude");

  const current = await orca.runCurrent();
  const run = current.ok && typeof current.value.runId === "string" && current.value.runId !== "" ? current.value.runId : undefined;
  if (!run) return { error: "부른 세션이 쥔 Run 을 읽지 못했다(run-current): Run 을 쥔 오케스트레이터나 리드가 부른다" };
  const callerLoc = await locate(orca, p.self.cwd);
  const callerRole = callerLoc
    ? readRoleLine(callerLoc.spec)
    : (agentRole(callerClaude ? flagOf(readLaunch(callerClaude.args, () => true), "--agent") : undefined) ?? "orchestrator");
  if (!callerRole) return { error: `부른 세션의 Task ${callerLoc?.task} 에 역할 줄이 없다` };
  if (callerRole === "worker") return { error: "워커는 세션을 다시 띄우지 않는다: 그 Run 을 쥔 리드가 부른다" };
  const trees = await orca.worktreeList({ limit: 1000 });
  const innermost = (dir: string) =>
    trees.ok ? trees.value.rows.filter((t) => within(dir, t.path)).sort((a, b) => b.path.length - a.path.length)[0]?.id : undefined;
  // A lead with no Task names its worktree as start_unit asks (decision 243); an orchestrator leaves it to start_unit.
  const ownTree = callerLoc?.worktree ?? (callerRole === "lead" ? innermost(p.self.cwd) : undefined);
  const caller: Caller = { role: callerRole, run, ...(callerLoc ? { task: callerLoc.task } : {}), ...(ownTree ? { worktree: ownTree } : {}) };

  const servers = procs.flatMap((x) => {
    const entry = serverEntry(x.args);
    return entry && (o.task !== undefined || isStale(x.startedAt, entry, p.installed)) ? [x] : [];
  });
  const dirs = servers.length > 0 ? workingDirs(host, servers.map((s) => s.pid)) : new Map<number, string>();
  const ps = await orca.worktreePs({ limit: 1000 });
  const psRows = ps.ok && !ps.value.truncated ? ps.value.rows : undefined;

  const rows: RestartRow[] = [];
  for (const s of servers) {
    const claude = byPid.get(s.ppid);
    const cwd = dirs.get(s.pid);
    const self = ancestors.has(s.ppid);
    const loc: Located | undefined = self ? (callerLoc ?? undefined) : cwd ? await locate(orca, cwd) : undefined;
    if (o.task !== undefined && loc?.task !== o.task) continue;
    const launch = readLaunch(claude?.args ?? "", exists);
    const base = { claudePid: s.ppid, ...(cwd ? { cwd } : {}), flags: launch.flags, dropped: launch.dropped };
    const skip = (why: string, more: Partial<RestartRow> = {}): RestartRow => ({ ...base, ...more, action: "skip", why });
    if (!claude || !cwd) {
      rows.push(skip(!claude ? "MCP server 의 부모 프로세스가 없다" : "작업 폴더를 읽지 못했다"));
      continue;
    }
    const role = loc ? readRoleLine(loc.spec) : agentRole(flagOf(launch, "--agent"));
    const held = loc ? { task: loc.task, dispatch: loc.dispatch, run: loc.run, worktree: loc.worktree } : {};
    if (!role) {
      rows.push(skip("sangsoe 역할이 없는 세션이다(오너가 손으로 연 세션은 건드리지 않는다)", held));
      continue;
    }
    if (self) {
      if (loc) {
        rows.push(skip("이 명령을 부른 세션이다: Dispatch 를 쥔 세션은 그 Run 의 coordinator 가 다시 띄운다", { role, ...held }));
        continue;
      }
      const session = lastSession(p.store, { run, role });
      const worktree = innermost(cwd);
      if (!session || !worktree || launch.problem) {
        rows.push(skip(`이 명령을 부른 세션이다: ${launch.problem ?? (session ? "worktree 를 찾지 못했다" : `Run ${run} 의 ${role} 세션 id 가 store 에 없다`)}`, { role }));
        continue;
      }
      rows.push({ ...base, role, run, worktree, session, action: "self", why: "이 명령을 부른 세션: 새 터미널이 이 세션이 끝나기를 기다렸다가 이어 띄운다", command: resumeCommand(s.ppid, launch, session) });
      continue;
    }
    if (!loc) {
      rows.push(skip("Dispatch 없는 세션이다: 그 세션이 스스로 sangsoe restart --stale 을 부른다", { role }));
      continue;
    }
    if (loc.run !== run) {
      rows.push(skip(`Run ${loc.run} 의 Task 다: 그 Run 을 쥔 coordinator 가 다시 띄운다`, { role, ...held }));
      continue;
    }
    const w = await orca.workerShow({ dispatch: loc.dispatch });
    const terminal = w.ok ? w.value.terminal : undefined;
    if (!terminal) {
      rows.push(skip(`Dispatch ${loc.dispatch} 의 터미널을 읽지 못했다`, { role, ...held }));
      continue;
    }
    const st = await agentState(orca, psRows, loc.worktree, terminal);
    const state = "state" in st ? st.state : undefined;
    const more = { role, ...held, terminal, ...(state ? { state } : {}) };
    if (!state) {
      rows.push(skip(`쉬는지 알 수 없다: ${"unknown" in st ? st.unknown : ""}`, more));
      continue;
    }
    if (!AT_REST.has(state)) {
      rows.push(skip(`턴 중이다(agent ${state}): 쉴 때 다시 부른다`, more));
      continue;
    }
    const session = lastSession(p.store, { task: loc.task });
    if (!session) {
      rows.push(skip(`Task ${loc.task} 의 세션 id 가 store 에 없다(session_started)`, more));
      continue;
    }
    if (launch.problem) {
      rows.push(skip(launch.problem, { ...more, session }));
      continue;
    }
    rows.push({ ...base, ...more, session, action: "restart", why: "쉬고 있다", command: resumeCommand(s.ppid, launch, session) });
  }
  return { caller, rows };
}

function describe(r: RestartRow): string {
  const who = [r.role ?? "-", r.task ?? "-", r.dispatch ?? "-"].join(" ");
  const flags = r.flags.length > 0 ? r.flags.join(" ") : "-";
  const extra = r.dropped.length > 0 ? `  dropped ${r.dropped.join(" | ")}` : "";
  return `  pid ${r.claudePid}  ${who}  ${r.cwd ?? "-"}  session ${r.session ?? "-"}  state ${r.state ?? "-"}  flags ${flags}${extra}\n    → ${r.action}: ${r.why}`;
}

/** The Run's coordinator sees a terminal show up with claude in it before binding it (decision 322 (나)). */
async function waitAgent(p: RestartPorts, worktree: string, terminal: string): Promise<boolean> {
  const sleep = p.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let waited = 0; waited <= AGENT_WAIT_MS; waited += POLL_MS) {
    const list = await p.orca.terminalList({ worktree: `id:${worktree}` });
    if (list.ok && list.value.rows.some((t) => t.handle === terminal && t.agentIdentity)) return true;
    await sleep(POLL_MS);
  }
  return false;
}

async function restartOne(p: RestartPorts, caller: Caller, r: RestartRow): Promise<{ ok: boolean; lines: string[] }> {
  const { orca } = p;
  const task = r.task as string;
  const worktree = r.worktree as string;
  const fail = (...lines: string[]) => ({ ok: false, lines: [`  ✗ ${task}: ${lines[0]}`, ...lines.slice(1).map((l) => `    ${l}`)] });
  const stopped = await orca.workerStop({ dispatch: r.dispatch as string });
  if (!stopped.ok) {
    return fail(`worker-stop ${r.dispatch} 실패(${stopped.error.code}): 세션을 다시 띄우지 않았다. worker-show 로 그 Dispatch 를 읽고 다시 부른다`);
  }
  const resumeArgs = `start_unit {task: ${task}, childRole: ${r.role}, resume: {worktreeId: ${worktree}, sessionId: ${r.session}, terminal: <새 터미널>}}`;
  const created = await orca.terminalCreate({ worktree: `id:${worktree}`, command: r.command as string, title: `restart ${task}` });
  if (!created.ok) {
    return fail(
      `Dispatch ${r.dispatch} 는 멈췄고 터미널을 열지 못했다(${created.error.code})`,
      `손으로 잇는 길: orca terminal create --worktree ${quote(`id:${worktree}`)} --command ${quote(r.command as string)}`,
      `그 뒤 ${resumeArgs}`,
    );
  }
  const terminal = created.value.handle;
  if (!(await waitAgent(p, worktree, terminal))) {
    return fail(`터미널 ${terminal} 에 ${AGENT_WAIT_MS / 1000}초 안에 claude 가 붙지 않았다`, `붙은 뒤 ${resumeArgs.replace("<새 터미널>", terminal)}`);
  }
  const bind = p.bind ?? ((req: StartRequest) => startUnit({ orca, store: p.store, slots: () => 0, cwd: () => p.self.cwd, source: "cli:restart" }, req));
  const out = await bind({
    requester: { role: caller.role, runId: caller.run, ...(caller.worktree ? { worktreeId: caller.worktree } : {}), ...(caller.task ? { taskId: caller.task } : {}) },
    childRole: r.role === "lead" ? "lead" : "worker",
    task: { id: task },
    agent: "claude",
    resume: { worktreeId: worktree, sessionId: r.session as string, terminal },
  });
  if (out.kind !== "resumed") {
    const why = out.kind === "refused" ? `${out.reason}: ${out.detail}` : out.kind;
    return fail(`터미널 ${terminal} 에서 세션은 다시 떴지만 Task 에 묶지 못했다(${why})`, `같은 resume 을 다시: ${resumeArgs.replace("<새 터미널>", terminal)}`);
  }
  const lines = [`  ✓ ${task}: Dispatch ${out.from} → ${out.dispatchId}, 터미널 ${terminal}`];
  if (r.role === "lead") {
    // The lead's own workers hold its Run, which only it can reopen (Orca's recovery guide).
    const sent = await orca.send({
      to: terminal,
      type: "status",
      subject: "sangsoe restart: 다시 띄웠다(결정 330)",
      body: "업그레이드 뒤 이 세션을 claude --resume 으로 다시 띄워 원래 Task 에 묶었다. 이 Run 의 낡은 워커는 `sangsoe restart --stale` 로 다시 띄운다(--dry-run 으로 먼저 본다).",
    });
    if (!sent.ok) lines.push(`    리드에게 알리지 못했다(${sent.error.code}): 리드가 sangsoe restart --stale 을 부르게 알린다`);
  }
  return { ok: true, lines };
}

async function restartSelf(p: RestartPorts, r: RestartRow): Promise<{ ok: boolean; lines: string[] }> {
  const created = await p.orca.terminalCreate({ worktree: `id:${r.worktree}`, command: r.command as string, title: `restart ${r.role}` });
  const ownLine = `/exit 뒤 이 터미널에서: ${r.command?.slice(r.command.indexOf("done; ") + "done; ".length)}`;
  if (!created.ok) return { ok: false, lines: [`  ✗ 이 세션: 새 터미널을 열지 못했다(${created.error.code})`, `    오너가 칠 한 줄: ${ownLine}`] };
  return {
    ok: true,
    lines: [
      `  ✓ 이 세션: 새 터미널 ${created.value.handle} 이 pid ${r.claudePid} 가 끝나기를 기다린다`,
      `    오너: Orca 에서 이 세션의 터미널${p.self.terminal ? ` ${p.self.terminal}` : ""} 을 닫으면(결정 301) 새 터미널이 세션을 이어 띄운다`,
    ],
  };
}

/**
 * Decision 330: restart the caller's own children whose sessions run stale code (or the one `task`
 * names), each idle one by worker-stop, a new terminal running `claude --resume` with its flags, and
 * start_unit's resume (decision 322); then, for a caller with no Dispatch, a terminal that resumes the
 * caller once it ends. A dry run prints the plan and changes nothing.
 */
export async function restartSessions(p: RestartPorts, o: RestartOptions): Promise<{ code: number; lines: string[] }> {
  const plan = await planRestart(p, o);
  if ("error" in plan) return { code: 1, lines: [`sangsoe restart: ${plan.error}`] };
  const { caller, rows } = plan;
  const what = o.task ? `Task ${o.task}` : "낡은 세션";
  const lines = [`sangsoe restart: ${what} ${rows.length}개 (부른 쪽 ${caller.role}, Run ${caller.run})${o.dryRun ? " — dry-run, 바꾸지 않는다" : ""}`];
  if (rows.length === 0) return { code: o.task ? 1 : 0, lines: [...lines, o.task ? `  Task ${o.task} 를 쥔 sangsoe 세션 프로세스를 찾지 못했다` : "  없다"] };
  for (const r of rows) {
    lines.push(describe(r));
    if (r.command) lines.push(`    command: ${r.command}`);
  }
  if (o.dryRun) return { code: 0, lines };
  let ok = true;
  lines.push("결과:");
  for (const r of rows.filter((x) => x.action === "restart")) {
    const one = await restartOne(p, caller, r);
    ok &&= one.ok;
    lines.push(...one.lines);
  }
  for (const r of rows.filter((x) => x.action === "self")) {
    const one = await restartSelf(p, r);
    ok &&= one.ok;
    lines.push(...one.lines);
  }
  if (!rows.some((x) => x.action !== "skip")) lines.push("  다시 띄운 세션 없음");
  return { code: ok ? 0 : 1, lines };
}
