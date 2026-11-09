import { join } from "node:path";
import {
  type Host,
  lastLine,
  listMarketplaces,
  listOrcaPlugins,
  listPlugins,
  MARKETPLACE,
  orcaManifest,
  PLUGIN_ID,
  sangsoeOrca,
  UNREADABLE,
  userPlugin,
} from "./host.ts";

export type Check =
  | { state: "ok"; name: string; detail: string }
  | { state: "fail"; name: string; detail: string; fix: string }
  | { state: "not yet"; name: string; detail: string };

type Manifest = { version?: string; engines?: { node?: string } };
const REINSTALL = "brew reinstall sangsoe";

function readManifest(host: Host, path: string): Manifest | undefined {
  try {
    return JSON.parse(host.readText(path)) as Manifest;
  } catch {
    return undefined;
  }
}

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
  const pkg = readManifest(host, join(root, "package.json"));
  if (!pkg?.version) {
    return [{ state: "fail", name: "tree", detail: `${root}/package.json is missing or unreadable`, fix: REINSTALL }];
  }
  const want = pkg.version;
  const problems: string[] = [];
  const claudeManifest = join("claude-plugin", ".claude-plugin", "plugin.json");
  const orcaManifestRel = join("orca-plugin", "orca-plugin.json");
  for (const m of [claudeManifest, orcaManifestRel, join(".claude-plugin", "marketplace.json")]) {
    const path = join(root, m);
    if (!host.exists(path)) {
      if (m !== orcaManifestRel) problems.push(`${m} is missing`);
      continue;
    }
    const got = readManifest(host, path);
    if (!got) problems.push(`${m} is unreadable`);
    else if (m !== join(".claude-plugin", "marketplace.json") && got.version !== want) problems.push(`${m} says ${got.version}`);
  }
  const out: Check[] = [
    problems.length === 0
      ? { state: "ok", name: "tree", detail: `${root} (sangsoe ${want})` }
      : { state: "fail", name: "tree", detail: `sangsoe ${want}: ${problems.join("; ")}`, fix: REINSTALL },
  ];
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

function claudeChecks(host: Host, root: string, want: string | undefined): Check[] {
  const where = host.env.CLAUDE_CONFIG_DIR ? ` (CLAUDE_CONFIG_DIR=${host.env.CLAUDE_CONFIG_DIR})` : "";
  const v = host.run("claude", ["--version"]);
  if (v.code !== 0) {
    return [{ state: "fail", name: "claude", detail: `not runnable: ${lastLine(v)}`, fix: "install Claude Code and put `claude` on PATH" }];
  }
  const out: Check[] = [{ state: "ok", name: "claude", detail: `${v.stdout.trim()}${where}` }];

  const markets = listMarketplaces(host);
  const m = markets?.find((x) => x.name === MARKETPLACE);
  out.push(
    !markets
      ? { state: "fail", name: "claude marketplace", detail: UNREADABLE("claude plugin marketplace list --json"), fix: "claude plugin marketplace list" }
      : !m
        ? { state: "fail", name: "claude marketplace", detail: `${MARKETPLACE} not added`, fix: "sangsoe install" }
        : m.path !== root
          ? { state: "fail", name: "claude marketplace", detail: `${MARKETPLACE} points at ${m.path ?? m.source}`, fix: "sangsoe install" }
          : { state: "ok", name: "claude marketplace", detail: `${MARKETPLACE} → ${m.path}` },
  );

  const plugins = listPlugins(host);
  const p = userPlugin(plugins);
  out.push(
    !plugins
      ? { state: "fail", name: "claude plugin", detail: UNREADABLE("claude plugin list --json"), fix: "claude plugin list" }
      : !p
        ? { state: "fail", name: "claude plugin", detail: `${PLUGIN_ID} not installed (user scope)`, fix: "sangsoe install" }
        : p.version !== want
          ? { state: "fail", name: "claude plugin", detail: `${PLUGIN_ID} is ${p.version}, tree is ${want}`, fix: "sangsoe install" }
          : p.enabled === false
            ? { state: "fail", name: "claude plugin", detail: `${PLUGIN_ID} is disabled`, fix: `claude plugin enable ${PLUGIN_ID}` }
            : { state: "ok", name: "claude plugin", detail: `${PLUGIN_ID} ${p.version}, enabled` },
  );
  return out;
}

const ORCA_RUNNING = new Set(["running", "idle"]);

function orcaChecks(host: Host, root: string): Check {
  const name = "orca plugin";
  if (!host.exists(orcaManifest(root))) return { state: "not yet", name, detail: "this build carries no Orca plugin" };
  const want = readManifest(host, orcaManifest(root))?.version;
  const list = listOrcaPlugins(host);
  if (!list) return { state: "fail", name, detail: UNREADABLE("orca plugin list --json"), fix: "orca open" };
  const p = sangsoeOrca(list);
  if (!p) return { state: "fail", name, detail: "sangsoe is not loaded", fix: "sangsoe install" };
  if (!p.isDev) return { state: "fail", name, detail: `${p.pluginKey} is not the Homebrew tree's development load`, fix: "sangsoe install" };
  if (p.version !== want) return { state: "fail", name, detail: `${p.pluginKey} is ${p.version}, tree is ${want}`, fix: "sangsoe install" };
  if (p.status === "pending" || p.needsReconsent) {
    return { state: "fail", name, detail: `${p.pluginKey} waits for approval`, fix: "sangsoe plugin approve" };
  }
  if (!ORCA_RUNNING.has(p.status ?? "")) {
    return { state: "fail", name, detail: `${p.pluginKey} is ${p.status}`, fix: `orca plugin logs ${p.pluginKey}` };
  }
  return { state: "ok", name, detail: `${p.pluginKey} ${p.version}, ${p.status}` };
}

// Placeholders until the start checks (Orca capabilities, status hooks, host filter, SQLite floor) land.
const NOT_YET: Check[] = [
  { state: "not yet", name: "start checks", detail: "Orca capabilities, status hooks and host filter arrive with a later build" },
  { state: "not yet", name: "sqlite", detail: "the SQLite version floor check arrives with a later build" },
];

export function doctorChecks(host: Host, root: string, opts: { offline?: boolean } = {}): Check[] {
  const tree = treeChecks(host, root);
  if (opts.offline) return tree;
  const want = readManifest(host, join(root, "package.json"))?.version;
  return [...tree, ...claudeChecks(host, root, want), orcaChecks(host, root), ...NOT_YET];
}

export function formatChecks(checks: readonly Check[]): string[] {
  return checks.map((c) =>
    c.state === "fail" ? `FAIL     ${c.name}: ${c.detail} — fix: ${c.fix}` : `${c.state.padEnd(8)} ${c.name}: ${c.detail}`,
  );
}

export function doctor(host: Host, root: string, opts: { offline?: boolean } = {}): { code: number; lines: string[] } {
  const checks = doctorChecks(host, root, opts);
  return { code: checks.some((c) => c.state === "fail") ? 1 : 0, lines: formatChecks(checks) };
}
