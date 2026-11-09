import { join } from "node:path";
import {
  type Host,
  json,
  lastLine,
  listMarketplaces,
  listPlugins,
  MARKETPLACE,
  orcaManifest,
  PLUGIN_ID,
  userPlugin,
} from "./host.ts";

export type Check =
  | { state: "ok"; name: string; detail: string }
  | { state: "fail"; name: string; detail: string; fix: string }
  | { state: "not yet"; name: string; detail: string };

type OrcaPlugin = { pluginKey: string; version?: string; status?: string; isDev?: boolean };

const version = (host: Host, path: string) =>
  JSON.parse(host.readText(path)) as { version?: string; engines?: { node?: string } };

function atLeast(have: string, floor: string): boolean {
  const a = have.split(".").map(Number);
  const b = floor.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

// What can be checked from the tree alone; the formula's `test do` runs only this (`--offline`).
function treeChecks(host: Host, root: string): Check[] {
  const pkg = version(host, join(root, "package.json"));
  const want = pkg.version ?? "?";
  const out: Check[] = [];
  const manifests = [join("claude-plugin", ".claude-plugin", "plugin.json"), join("orca-plugin", "orca-plugin.json")];
  const off: string[] = [];
  for (const m of manifests) {
    if (!host.exists(join(root, m))) continue;
    const got = version(host, join(root, m)).version;
    if (got !== want) off.push(`${m} says ${got}`);
  }
  out.push(
    off.length === 0
      ? { state: "ok", name: "tree", detail: `${root} (sangsoe ${want})` }
      : { state: "fail", name: "tree", detail: `package.json says ${want}; ${off.join(", ")}`, fix: "reinstall: brew reinstall sangsoe" },
  );
  if (!host.exists(join(root, ".claude-plugin", "marketplace.json"))) {
    out.push({ state: "fail", name: "marketplace file", detail: "missing in the tree", fix: "brew reinstall sangsoe" });
  }
  const floor = /(\d+(?:\.\d+)*)/.exec(pkg.engines?.node ?? "")?.[1];
  if (floor) {
    out.push(
      atLeast(host.nodeVersion, floor)
        ? { state: "ok", name: "node", detail: `${host.nodeVersion} (needs >= ${floor})` }
        : { state: "fail", name: "node", detail: `${host.nodeVersion} is below ${floor}`, fix: "brew upgrade node" },
    );
  }
  return out;
}

function claudeChecks(host: Host, root: string): Check[] {
  const where = host.env.CLAUDE_CONFIG_DIR ? ` (CLAUDE_CONFIG_DIR=${host.env.CLAUDE_CONFIG_DIR})` : "";
  const v = host.run("claude", ["--version"]);
  if (v.code !== 0) {
    return [{ state: "fail", name: "claude", detail: `not runnable: ${lastLine(v)}`, fix: "install Claude Code and put `claude` on PATH" }];
  }
  const out: Check[] = [{ state: "ok", name: "claude", detail: `${v.stdout.trim()}${where}` }];
  const m = listMarketplaces(host)?.find((x) => x.name === MARKETPLACE);
  out.push(
    !m
      ? { state: "fail", name: "claude marketplace", detail: `${MARKETPLACE} not added`, fix: "sangsoe install" }
      : m.path !== root
        ? { state: "fail", name: "claude marketplace", detail: `${MARKETPLACE} points at ${m.path ?? m.source}`, fix: "sangsoe install" }
        : { state: "ok", name: "claude marketplace", detail: `${MARKETPLACE} → ${m.path}` },
  );
  const want = version(host, join(root, "package.json")).version;
  const p = userPlugin(listPlugins(host));
  out.push(
    !p
      ? { state: "fail", name: "claude plugin", detail: `${PLUGIN_ID} not installed (user scope)`, fix: "sangsoe install" }
      : p.version !== want
        ? { state: "fail", name: "claude plugin", detail: `${PLUGIN_ID} is ${p.version}, tree is ${want}`, fix: "sangsoe install" }
        : p.enabled === false
          ? { state: "fail", name: "claude plugin", detail: `${PLUGIN_ID} is disabled`, fix: `claude plugin enable ${PLUGIN_ID}` }
          : { state: "ok", name: "claude plugin", detail: `${PLUGIN_ID} ${p.version}, enabled` },
  );
  return out;
}

function orcaChecks(host: Host, root: string): Check[] {
  if (!host.exists(orcaManifest(root))) {
    return [{ state: "not yet", name: "orca plugin", detail: "this build carries no Orca plugin" }];
  }
  const want = version(host, orcaManifest(root)).version;
  const r = host.run("orca", ["plugin", "list", "--json"]);
  const list = json<{ result?: { plugins?: OrcaPlugin[] } }>(r)?.result?.plugins;
  if (!list) return [{ state: "fail", name: "orca plugin", detail: `orca plugin list: ${lastLine(r)}`, fix: "orca open" }];
  const p = list.find((x) => x.pluginKey === "sangsoe" || x.pluginKey.endsWith(".sangsoe"));
  if (!p) return [{ state: "fail", name: "orca plugin", detail: "sangsoe is not loaded", fix: "sangsoe install" }];
  if (p.version !== want) {
    return [{ state: "fail", name: "orca plugin", detail: `${p.pluginKey} is ${p.version}, tree is ${want}`, fix: "sangsoe install" }];
  }
  if (p.status === "pending") {
    return [{ state: "fail", name: "orca plugin", detail: `${p.pluginKey} waits for approval`, fix: "sangsoe plugin approve" }];
  }
  return [{ state: "ok", name: "orca plugin", detail: `${p.pluginKey} ${p.version}, ${p.status}` }];
}

// Placeholders until the start checks (Orca capabilities, status hooks, host filter, SQLite floor) land.
const NOT_YET: Check[] = [
  { state: "not yet", name: "start checks", detail: "Orca capabilities, status hooks and host filter arrive with a later build" },
  { state: "not yet", name: "sqlite", detail: "the SQLite version floor check arrives with a later build" },
];

export function doctorChecks(host: Host, root: string, opts: { offline?: boolean } = {}): Check[] {
  const tree = treeChecks(host, root);
  if (opts.offline) return tree;
  return [...tree, ...claudeChecks(host, root), ...orcaChecks(host, root), ...NOT_YET];
}

export function formatChecks(checks: readonly Check[]): string[] {
  return checks.map((c) =>
    c.state === "fail"
      ? `FAIL     ${c.name}: ${c.detail} — fix: ${c.fix}`
      : `${c.state.padEnd(8)} ${c.name}: ${c.detail}`,
  );
}

export function doctor(host: Host, root: string, opts: { offline?: boolean } = {}): { code: number; lines: string[] } {
  const checks = doctorChecks(host, root, opts);
  return { code: checks.some((c) => c.state === "fail") ? 1 : 0, lines: formatChecks(checks) };
}
