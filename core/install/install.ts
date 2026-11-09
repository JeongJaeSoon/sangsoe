import { doctor } from "./doctor.ts";
import {
  type Host,
  json,
  lastLine,
  listMarketplaces,
  listPlugins,
  MARKETPLACE,
  orcaManifest,
  orcaPluginDir,
  PLUGIN_ID,
  userPlugin,
} from "./host.ts";

export type Outcome = { code: number; lines: string[] };

// Approval stays with `sangsoe plugin approve` (decision 90): install only reports the fingerprint.
function findFingerprint(v: unknown): string | undefined {
  if (!v || typeof v !== "object") return undefined;
  for (const [k, x] of Object.entries(v)) {
    if (/fingerprint/i.test(k) && typeof x === "string") return x;
    const inner = findFingerprint(x);
    if (inner) return inner;
  }
  return undefined;
}

function orcaStep(host: Host, root: string, lines: string[]): boolean {
  if (!host.exists(orcaManifest(root))) {
    lines.push("orca: skipped — this build carries no Orca plugin (orca-plugin/orca-plugin.json)");
    return true;
  }
  const r = host.run("orca", ["plugin", "dev", "load", orcaPluginDir(root), "--json"]);
  if (r.code === 0) {
    lines.push(`orca: loaded ${orcaPluginDir(root)}`);
    return true;
  }
  if (r.code === 3) {
    const fp = findFingerprint(json({ ...r, code: 0 })) ?? "(see `orca plugin inspect`)";
    lines.push(`orca: loaded, approval waits — fingerprint ${fp}; next: sangsoe plugin approve`);
    return true;
  }
  lines.push(`orca: dev load failed (exit ${r.code}): ${lastLine(r)}`);
  return false;
}

// Idempotent: each step reads current state first and picks add/update or install/update.
export function install(host: Host, root: string): Outcome {
  const lines: string[] = [];
  const step = (label: string, args: string[]) => {
    const r = host.run("claude", args);
    lines.push(r.code === 0 ? `claude: ${label}` : `claude: ${label} failed (exit ${r.code}): ${lastLine(r)}`);
    return r.code === 0;
  };

  const markets = listMarketplaces(host);
  if (!markets) {
    lines.push("claude: cannot read `claude plugin marketplace list --json`; is Claude Code on PATH?");
    return { code: 1, lines };
  }
  let m = markets.find((x) => x.name === MARKETPLACE);
  if (m && m.path !== root) {
    if (!step(`removed marketplace ${MARKETPLACE} (pointed at ${m.path ?? m.source})`, ["plugin", "marketplace", "remove", MARKETPLACE])) {
      return { code: 1, lines };
    }
    m = undefined;
  }
  const ok = m
    ? step(`updated marketplace ${MARKETPLACE}`, ["plugin", "marketplace", "update", MARKETPLACE])
    : step(`added marketplace ${MARKETPLACE} → ${root}`, ["plugin", "marketplace", "add", root, "--scope", "user"]);
  if (!ok) return { code: 1, lines };

  const installed = userPlugin(listPlugins(host));
  const pluginOk = installed
    ? step(`updated ${PLUGIN_ID} (open a new session to use it)`, ["plugin", "update", PLUGIN_ID, "--scope", "user"])
    : step(`installed ${PLUGIN_ID}`, ["plugin", "install", PLUGIN_ID, "--scope", "user"]);
  if (!pluginOk) return { code: 1, lines };

  if (!orcaStep(host, root, lines)) return { code: 1, lines };

  const d = doctor(host, root);
  return { code: d.code, lines: [...lines, "", "sangsoe doctor:", ...d.lines] };
}

export function uninstall(host: Host, root: string): Outcome {
  const lines: string[] = [];
  let code = 0;
  const step = (cmd: string, label: string, args: string[]) => {
    const r = host.run(cmd, args);
    if (r.code !== 0) code = 1;
    lines.push(r.code === 0 ? `${cmd}: ${label}` : `${cmd}: ${label} failed (exit ${r.code}): ${lastLine(r)}`);
  };

  if (userPlugin(listPlugins(host))) {
    step("claude", `uninstalled ${PLUGIN_ID}`, ["plugin", "uninstall", PLUGIN_ID, "--scope", "user", "--keep-data"]);
  } else {
    lines.push(`claude: ${PLUGIN_ID} was not installed`);
  }
  if (listMarketplaces(host)?.some((x) => x.name === MARKETPLACE)) {
    step("claude", `removed marketplace ${MARKETPLACE}`, ["plugin", "marketplace", "remove", MARKETPLACE]);
  } else {
    lines.push(`claude: marketplace ${MARKETPLACE} was not added`);
  }
  if (host.exists(orcaManifest(root))) {
    step("orca", `unloaded ${orcaPluginDir(root)}`, ["plugin", "dev", "unload", orcaPluginDir(root), "--json"]);
  } else {
    lines.push("orca: skipped — this build carries no Orca plugin");
  }
  lines.push("kept: ~/.local/share/sangsoe (data) and ~/.config/sangsoe (settings); `brew uninstall sangsoe` removes the tree");
  return { code, lines };
}
