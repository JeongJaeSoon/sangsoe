import type { CheckContext } from "../checks/index.ts";
import { doctor } from "./doctor.ts";
import {
  type ClaudeProfile,
  currentProfile,
  enableClaudePlugin,
  type Host,
  json,
  lastLine,
  listMarketplaces,
  listOrcaPlugins,
  listPlugins,
  MARKETPLACE,
  orcaManifest,
  orcaPluginDir,
  orcaProfile,
  PLUGIN_ID,
  type RunEnv,
  type RunResult,
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

const tag = (p: ClaudeProfile, current: boolean) => (current ? "claude" : `claude (Orca profile ${p.dir})`);

// Decision 208: no `--scope`. `marketplace add --scope user` can leave the entry only in the profile's
// known_marketplaces.json, and a remove scoped to user then fails with "not declared in user settings".
// A failed remove after which the list no longer has the marketplace counts as removed.
function removeMarketplace(host: Host, env?: RunEnv): RunResult {
  const r = host.run("claude", ["plugin", "marketplace", "remove", MARKETPLACE], env);
  if (r.code === 0) return r;
  const after = listMarketplaces(host, env);
  return after && !after.some((x) => x.name === MARKETPLACE) ? { ...r, code: 0 } : r;
}

// Idempotent: each step reads current state first and picks add/update or install/update.
function registerClaude(host: Host, root: string, profile: ClaudeProfile, current: boolean, lines: string[]): boolean {
  const who = tag(profile, current);
  const report = (label: string, r: RunResult) => {
    lines.push(r.code === 0 ? `${who}: ${label}` : `${who}: ${label} failed (exit ${r.code}): ${lastLine(r)}`);
    return r.code === 0;
  };
  const step = (label: string, args: string[]) => report(label, host.run("claude", args, profile.env));

  const markets = listMarketplaces(host, profile.env);
  if (!markets) {
    lines.push(`${who}: ${UNREADABLE("plugin marketplace list --json")}`);
    return false;
  }
  let m = markets.find((x) => x.name === MARKETPLACE);
  if (m && m.path !== root) {
    const removed = report(`removed marketplace ${MARKETPLACE} (pointed at ${m.path ?? m.source})`, removeMarketplace(host, profile.env));
    if (!removed) return false;
    m = undefined;
  }
  const ok = m
    ? step(`updated marketplace ${MARKETPLACE}`, ["plugin", "marketplace", "update", MARKETPLACE])
    : step(`added marketplace ${MARKETPLACE} → ${root}`, ["plugin", "marketplace", "add", root, "--scope", "user"]);
  if (!ok) return false;

  const plugins = listPlugins(host, profile.env);
  if (!plugins) {
    lines.push(`${who}: ${UNREADABLE("plugin list --json")}`);
    return false;
  }
  const installed = userPlugin(plugins);
  const pluginOk = installed
    ? step(`updated ${PLUGIN_ID} (open a new session to use it)`, ["plugin", "update", PLUGIN_ID, "--scope", "user"])
    : step(`installed ${PLUGIN_ID}`, ["plugin", "install", PLUGIN_ID, "--scope", "user"]);
  if (!pluginOk) return false;

  // Decision 166: `claude plugin update` keeps a disabled plugin disabled, and `claude plugin enable`
  // on an enabled one exits 1, so enable only what a fresh list shows off.
  const after = listPlugins(host, profile.env);
  if (!after) {
    lines.push(`${who}: ${UNREADABLE("plugin list --json")}`);
    return false;
  }
  if (userPlugin(after)?.enabled === false) return report(`enabled ${PLUGIN_ID}`, enableClaudePlugin(host, profile.env));
  return true;
}

export async function install(host: Host, root: string, ctx: CheckContext): Promise<Outcome> {
  const lines: string[] = [];
  const current = currentProfile(host);
  if (!registerClaude(host, root, current, true, lines)) return { code: 1, lines };

  // Decision 167: Orca starts sangsoe's sessions, so the profile it selects must carry the plugin too.
  const orca = orcaProfile(host);
  if (!orca) lines.push(`claude: ${UNREADABLE("orca account list --json")} for Orca's selected profile`);
  else if (orca.dir === current.dir) lines.push(`claude: Orca starts new sessions with this profile (${current.dir})`);
  else if (!registerClaude(host, root, orca, false, lines)) return { code: 1, lines };

  if (!orcaStep(host, root, lines)) return { code: 1, lines };

  const d = await doctor(host, root, { ctx });
  return { code: d.code, lines: [...lines, "", "sangsoe doctor:", ...d.lines] };
}

export function uninstall(host: Host): Outcome {
  const lines: string[] = [];
  let code = 0;
  const report = (who: string, label: string, r: RunResult) => {
    if (r.code !== 0) code = 1;
    lines.push(r.code === 0 ? `${who}: ${label}` : `${who}: ${label} failed (exit ${r.code}): ${lastLine(r)}`);
    return r.code === 0;
  };
  const step = (who: string, label: string, args: string[], env?: RunEnv) => report(who, label, host.run(who === "orca" ? "orca" : "claude", args, env));
  let uninstalled = false;

  const unreadable = (who: string, what: string) => {
    code = 1;
    lines.push(`${who}: ${UNREADABLE(what)}`);
  };

  // Mirrors install: Orca's selected profile is unregistered too when it is another directory.
  const current = currentProfile(host);
  const orcaSide = orcaProfile(host);
  const profiles: [ClaudeProfile, boolean][] = [[current, true]];
  if (!orcaSide) lines.push(`claude: ${UNREADABLE("orca account list --json")} for Orca's selected profile`);
  else if (orcaSide.dir !== current.dir) profiles.push([orcaSide, false]);

  for (const [profile, isCurrent] of profiles) {
    const who = tag(profile, isCurrent);
    const plugins = listPlugins(host, profile.env);
    if (!plugins) unreadable(who, "plugin list --json");
    else if (userPlugin(plugins)) {
      if (step(who, `uninstalled ${PLUGIN_ID}`, ["plugin", "uninstall", PLUGIN_ID, "--scope", "user", "--keep-data"], profile.env)) uninstalled = true;
    } else lines.push(`${who}: ${PLUGIN_ID} was not installed`);

    const markets = listMarketplaces(host, profile.env);
    if (!markets) unreadable(who, "plugin marketplace list --json");
    else if (markets.some((x) => x.name === MARKETPLACE)) {
      report(who, `removed marketplace ${MARKETPLACE}`, removeMarketplace(host, profile.env));
    } else lines.push(`${who}: marketplace ${MARKETPLACE} was not added`);
  }
  // A running session keeps the hooks it loaded at start, uninstalled or not (decision 208).
  if (uninstalled) lines.push(`claude: restart every running Claude Code session that loaded ${PLUGIN_ID}; until then it keeps the plugin's hooks`);

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
