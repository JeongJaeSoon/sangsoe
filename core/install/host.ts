import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type RunResult = { code: number; stdout: string; stderr: string };

/** Overrides for one child's environment; `undefined` removes the variable. */
export type RunEnv = Readonly<Record<string, string | undefined>>;

// Everything install/uninstall/doctor read from or do to the machine, so tests run with no claude or orca.
export type Host = {
  /** `timeoutMs`: a child still running then is killed and reads as a failed run (code 127). */
  run(cmd: string, args: readonly string[], env?: RunEnv, timeoutMs?: number): RunResult;
  exists(path: string): boolean;
  readText(path: string): string;
  env: Readonly<Record<string, string | undefined>>;
  nodeVersion: string;
};

export const realHost: Host = {
  run(cmd, args, env, timeoutMs) {
    let childEnv: NodeJS.ProcessEnv | undefined;
    if (env) {
      childEnv = { ...process.env };
      for (const [k, v] of Object.entries(env)) {
        if (v === undefined) delete childEnv[k];
        else childEnv[k] = v;
      }
    }
    const r = spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: childEnv, ...(timeoutMs ? { timeout: timeoutMs } : {}) });
    if (r.error) return { code: 127, stdout: "", stderr: r.error.message };
    return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
  },
  exists: existsSync,
  readText: (p) => readFileSync(p, "utf8"),
  env: process.env,
  nodeVersion: process.versions.node,
};

export const MARKETPLACE = "sangsoe";
export const PLUGIN_ID = "sangsoe@sangsoe";
const MARKETPLACE_FILE = join(".claude-plugin", "marketplace.json");

// The formula's wrapper sets SANGSOE_ROOT to Homebrew's opt path, which survives `brew upgrade`
// (decision 90): registering the Cellar path would pin Claude Code and Orca to one version's folder.
export function treeRoot(host: Host, from: string = dirname(fileURLToPath(import.meta.url))): string {
  const fromEnv = host.env.SANGSOE_ROOT;
  if (fromEnv) return fromEnv;
  for (let dir = from; ; dir = dirname(dir)) {
    if (host.exists(join(dir, MARKETPLACE_FILE))) return dir;
    if (dirname(dir) === dir) return from;
  }
}

export const orcaPluginDir = (root: string) => join(root, "orca-plugin");
export const orcaManifest = (root: string) => join(orcaPluginDir(root), "orca-plugin.json");

export function json<T>(r: RunResult): T | undefined {
  if (r.code !== 0) return undefined;
  try {
    return JSON.parse(r.stdout) as T;
  } catch {
    return undefined;
  }
}

export const lastLine = (r: RunResult) =>
  (r.stderr.trim() || r.stdout.trim()).split("\n").at(-1) ?? `exit ${r.code}`;

export type Marketplace = { name: string; source?: string; path?: string };
export type ClaudePlugin = { id: string; version?: string; scope?: string; enabled?: boolean };

export const listMarketplaces = (host: Host, env?: RunEnv) =>
  json<Marketplace[]>(host.run("claude", ["plugin", "marketplace", "list", "--json"], env));
export const listPlugins = (host: Host, env?: RunEnv) =>
  json<ClaudePlugin[]>(host.run("claude", ["plugin", "list", "--json"], env));
export const userPlugin = (plugins: readonly ClaudePlugin[] | undefined) =>
  plugins?.find((p) => p.id === PLUGIN_ID && p.scope === "user");

// Claude Code's own enable, written as one `claude` argv so the decision 77 guard
// (test/approve-only.test.ts) can tell it from Orca's.
export const enableClaudePlugin = (host: Host, env?: RunEnv) =>
  host.run("claude", ["plugin", "enable", PLUGIN_ID, "--scope", "user"], env);

/** A Claude Code configuration directory and the env that points `claude` at it. */
export type ClaudeProfile = { dir: string; env?: RunEnv };

/** The directory `claude` run from here uses: `CLAUDE_CONFIG_DIR`, else `~/.claude`. */
export function currentProfile(host: Host): ClaudeProfile {
  const set = host.env.CLAUDE_CONFIG_DIR;
  return { dir: set ? resolve(set) : join(host.env.HOME ?? homedir(), ".claude") };
}

type OrcaClaudeAccounts = {
  accounts?: { id?: string; home?: string }[];
  activeAccountId?: string | null;
  systemDefaultHome?: string;
};

/**
 * The profile Orca starts new Claude sessions with, from Orca's own `account list` (decision 167).
 * No selected account means Orca's system default home, which `claude` reaches with
 * `CLAUDE_CONFIG_DIR` unset. Undefined when Orca's answer cannot be read: never taken as "same".
 */
export function orcaProfile(host: Host): ClaudeProfile | undefined {
  const c = json<{ result?: { claude?: OrcaClaudeAccounts } }>(host.run("orca", ["account", "list", "--json"]))?.result?.claude;
  if (!c) return undefined;
  if (!c.activeAccountId) {
    return c.systemDefaultHome ? { dir: resolve(c.systemDefaultHome), env: { CLAUDE_CONFIG_DIR: undefined } } : undefined;
  }
  const home = c.accounts?.find((a) => a.id === c.activeAccountId)?.home;
  return home ? { dir: resolve(home), env: { CLAUDE_CONFIG_DIR: resolve(home) } } : undefined;
}

export type OrcaPlugin = { pluginKey: string; version?: string; status?: string; isDev?: boolean; needsReconsent?: boolean };
export const listOrcaPlugins = (host: Host) =>
  json<{ result?: { plugins?: OrcaPlugin[] } }>(host.run("orca", ["plugin", "list", "--json"]))?.result?.plugins;
// A dev load overrides an installed plugin with the same key, so a dev entry wins whatever the order.
export function sangsoeOrca(plugins: readonly OrcaPlugin[]): OrcaPlugin | undefined {
  const ours = plugins.filter((x) => x.pluginKey === "sangsoe" || x.pluginKey.endsWith(".sangsoe"));
  return ours.find((x) => x.isDev) ?? ours[0];
}

// A list we could not read is not an empty list: acting on it would add twice or report a false removal.
export const UNREADABLE = (what: string) => `cannot read \`${what}\`, so this step was not done`;
