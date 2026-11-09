import { doctor } from "./doctor.ts";
import {
  type Host,
  json,
  lastLine,
  listMarketplaces,
  listOrcaPlugins,
  listPlugins,
  MARKETPLACE,
  orcaManifest,
  orcaPluginDir,
  PLUGIN_ID,
  sangsoeOrca,
  UNREADABLE,
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
    lines.push(`claude: ${UNREADABLE("plugin marketplace list --json")}`);
    return { code: 1, lines };
  }
  let m = markets.find((x) => x.name === MARKETPLACE);
  if (m && m.path !== root) {
    const removed = step(`removed marketplace ${MARKETPLACE} (pointed at ${m.path ?? m.source})`, [
      "plugin",
      "marketplace",
      "remove",
      MARKETPLACE,
      "--scope",
      "user",
    ]);
    if (!removed) return { code: 1, lines };
    m = undefined;
  }
  const ok = m
    ? step(`updated marketplace ${MARKETPLACE}`, ["plugin", "marketplace", "update", MARKETPLACE])
    : step(`added marketplace ${MARKETPLACE} → ${root}`, ["plugin", "marketplace", "add", root, "--scope", "user"]);
  if (!ok) return { code: 1, lines };

  const plugins = listPlugins(host);
  if (!plugins) {
    lines.push(`claude: ${UNREADABLE("plugin list --json")}`);
    return { code: 1, lines };
  }
  const installed = userPlugin(plugins);
  const pluginOk = installed
    ? step(`updated ${PLUGIN_ID} (open a new session to use it)`, ["plugin", "update", PLUGIN_ID, "--scope", "user"])
    : step(`installed ${PLUGIN_ID}`, ["plugin", "install", PLUGIN_ID, "--scope", "user"]);
  if (!pluginOk) return { code: 1, lines };

  if (!orcaStep(host, root, lines)) return { code: 1, lines };

  const d = doctor(host, root);
  return { code: d.code, lines: [...lines, "", "sangsoe doctor:", ...d.lines] };
}

export function uninstall(host: Host): Outcome {
  const lines: string[] = [];
  let code = 0;
  const step = (cmd: string, label: string, args: string[]) => {
    const r = host.run(cmd, args);
    if (r.code !== 0) code = 1;
    lines.push(r.code === 0 ? `${cmd}: ${label}` : `${cmd}: ${label} failed (exit ${r.code}): ${lastLine(r)}`);
  };

  const unreadable = (cmd: string, what: string) => {
    code = 1;
    lines.push(`${cmd}: ${UNREADABLE(what)}`);
  };

  const plugins = listPlugins(host);
  if (!plugins) unreadable("claude", "plugin list --json");
  else if (userPlugin(plugins)) {
    step("claude", `uninstalled ${PLUGIN_ID}`, ["plugin", "uninstall", PLUGIN_ID, "--scope", "user", "--keep-data"]);
  } else lines.push(`claude: ${PLUGIN_ID} was not installed`);

  const markets = listMarketplaces(host);
  if (!markets) unreadable("claude", "plugin marketplace list --json");
  else if (markets.some((x) => x.name === MARKETPLACE)) {
    step("claude", `removed marketplace ${MARKETPLACE}`, ["plugin", "marketplace", "remove", MARKETPLACE, "--scope", "user"]);
  } else lines.push(`claude: marketplace ${MARKETPLACE} was not added`);

  // Decided from Orca's own list, not the tree: an older tree may have loaded a plugin this one lacks.
  const orca = listOrcaPlugins(host);
  const loaded = orca && sangsoeOrca(orca);
  if (!orca) unreadable("orca", "plugin list --json");
  else if (loaded?.isDev) {
    step("orca", `unloaded ${loaded.pluginKey}`, ["plugin", "dev", "unload", loaded.pluginKey, "--json"]);
  } else lines.push("orca: no sangsoe development plugin loaded");
  lines.push("kept: ~/.local/share/sangsoe (data) and ~/.config/sangsoe (settings); `brew uninstall sangsoe` removes the tree");
  return { code, lines };
}
