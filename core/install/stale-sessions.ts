import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Host } from "./host.ts";

/** The entry a plugin-launched sangsoe MCP server runs (decision 211). */
export const SERVER_ENTRY = /\/claude-plugin\/mcp\/server\.[jt]s$/;

/** What the install a server's entry resolves to now holds: its version and when it was written there. */
export type InstalledTree = { version: string; at: number };

/**
 * The sangsoe install `entry` names now, read again through its symlinks; null when it is gone or
 * another package. `at` is the package.json's change time: an install writes the file, so a server
 * started before it loaded an older one (decision 247).
 */
export function installedTree(entry: string): InstalledTree | null {
  try {
    const file = realpathSync(join(dirname(entry), "../../package.json"));
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    if (pkg.name !== "sangsoe" || typeof pkg.version !== "string") return null;
    return { version: pkg.version, at: statSync(file).ctimeMs };
  } catch {
    return null;
  }
}

const PS = ["-axo", "pid=,etime=,args="];
// lsof can hang on an unreachable network mount; the end of install must not.
const TIMEOUT_MS = 10_000;

export const RESTART_LINE =
  "restart them with `sangsoe restart --stale` (the orchestrator restarts its leads, each lead its workers; add --dry-run to see the plan first); /reload-plugins does not restart the server";

/** `ps` elapsed time, `[[dd-]hh:]mm:ss`, in milliseconds. */
function elapsedMs(etime: string): number | undefined {
  const m = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(etime);
  if (!m) return undefined;
  const [, d = "0", h = "0", min = "0", s = "0"] = m;
  return (((Number(d) * 24 + Number(h)) * 60 + Number(min)) * 60 + Number(s)) * 1000;
}

type Server = { pid: number; startedAt: number; entry: string };

/**
 * The plugin entry `args` runs, or undefined. Only `node <entry>`, as the plugin's .mcp.json launches
 * it: an editor or pager open on server.ts is no server. Either path may hold a space, so the entry is
 * everything from the first argument that starts with `/`.
 */
export function serverEntry(args: string): string | undefined {
  const cut = args.indexOf(" /");
  const entry = cut < 0 ? "" : args.slice(cut + 1);
  return basename(args.slice(0, Math.max(cut, 0)).trim()) === "node" && SERVER_ENTRY.test(entry) ? entry : undefined;
}

function servers(stdout: string, now: number): Server[] {
  const out: Server[] = [];
  for (const line of stdout.split("\n")) {
    const [, pid, etime, args = ""] = /^(\d+)\s+(\S+)\s+(.+)$/.exec(line.trim()) ?? [];
    const entry = serverEntry(args);
    const ms = elapsedMs(etime ?? "");
    if (entry && ms !== undefined) out.push({ pid: Number(pid), startedAt: now - ms, entry });
  }
  return out;
}

/** One row of the whole process table with parents, for `sangsoe restart` (decision 330). */
export type Proc = { pid: number; ppid: number; startedAt: number; args: string };

/** `ps` with each process's parent and untruncated arguments; null when it cannot be read. */
export function processTable(host: Host, now: number): Proc[] | null {
  const r = host.run("ps", ["-ww", "-axo", "pid=,ppid=,etime=,args="], { LC_ALL: "C" }, TIMEOUT_MS);
  if (r.code !== 0) return null;
  return r.stdout.split("\n").flatMap((line) => {
    const [, pid, ppid, etime, args = ""] = /^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(line.trim()) ?? [];
    const ms = elapsedMs(etime ?? "");
    return ms === undefined ? [] : [{ pid: Number(pid), ppid: Number(ppid), startedAt: now - ms, args }];
  });
}

/** Decision 247's verdict for one server: it started before the install its entry names now, or that install is gone. */
export function isStale(startedAt: number, entry: string, installed: (entry: string) => InstalledTree | null = installedTree): boolean {
  const tree = installed(entry);
  return !tree || startedAt < tree.at;
}

/** The working directory of each pid, from one `lsof` call; a pid lsof cannot read is missing. */
export function workingDirs(host: Host, pids: number[]): Map<number, string> {
  const r = host.run("lsof", ["-a", "-d", "cwd", "-Fpn", "-p", pids.join(",")], undefined, TIMEOUT_MS);
  const dirs = new Map<number, string>();
  let pid: number | undefined;
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid !== undefined) dirs.set(pid, line.slice(1));
  }
  return dirs;
}

/**
 * Decision 247: the running sangsoe MCP servers that started before the install their entry names
 * now (or whose install is gone), one row each, and how to restart them. Reads the process table and
 * those servers' working directories only; it writes to no terminal and stops nothing.
 */
export function staleSessions(
  host: Host,
  deps: { installed?: (entry: string) => InstalledTree | null; now?: () => number } = {},
): string[] {
  const installed = deps.installed ?? installedTree;
  const now = (deps.now ?? Date.now)();
  const ps = host.run("ps", PS, { LC_ALL: "C" }, TIMEOUT_MS);
  if (ps.code !== 0) return [`stale sessions: cannot read \`ps ${PS.join(" ")}\`, so running sessions were not checked`];
  const stale = servers(ps.stdout, now).flatMap((s) => {
    const tree = installed(s.entry);
    return !tree || s.startedAt < tree.at ? [{ ...s, tree }] : [];
  });
  if (stale.length === 0) return ["stale sessions: none"];
  const dirs = workingDirs(host, stale.map((s) => s.pid));
  const home = host.env.HOME;
  const where = (pid: number) => {
    const d = dirs.get(pid);
    if (!d) return "(working directory unreadable)";
    return home && (d === home || d.startsWith(`${home}/`)) ? `~${d.slice(home.length)}` : d;
  };
  const noun = stale.length === 1 ? "server runs" : "servers run";
  return [
    `stale sessions: ${stale.length} sangsoe MCP ${noun} code older than what is installed now`,
    ...stale.map(({ pid, tree }) =>
      tree
        ? `  pid ${pid}  ${where(pid)}  runs an install older than sangsoe ${tree.version}  installed ${tree.version}`
        : `  pid ${pid}  ${where(pid)}  runs an install that is gone  installed none`,
    ),
    RESTART_LINE,
  ];
}
