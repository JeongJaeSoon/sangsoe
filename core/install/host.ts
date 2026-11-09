import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type RunResult = { code: number; stdout: string; stderr: string };

// Everything install/uninstall/doctor read from or do to the machine, so tests run with no claude or orca.
export type Host = {
  run(cmd: string, args: readonly string[]): RunResult;
  exists(path: string): boolean;
  readText(path: string): string;
  env: Readonly<Record<string, string | undefined>>;
  nodeVersion: string;
};

export const realHost: Host = {
  run(cmd, args) {
    const r = spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
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

export const listMarketplaces = (host: Host) =>
  json<Marketplace[]>(host.run("claude", ["plugin", "marketplace", "list", "--json"]));
export const listPlugins = (host: Host) => json<ClaudePlugin[]>(host.run("claude", ["plugin", "list", "--json"]));
export const userPlugin = (plugins: readonly ClaudePlugin[] | undefined) =>
  plugins?.find((p) => p.id === PLUGIN_ID && p.scope === "user");

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
