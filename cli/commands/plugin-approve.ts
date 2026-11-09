import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ApprovePorts, type ApproveResult, approvePlugin, nodePorts, resolveCommit } from "../../core/index.ts";

export const USAGE = `usage: sangsoe plugin approve [--dry-run] [--dir <orca plugin folder>] [--commit <sha>]

Enables the sangsoe Orca plugin only when (1) its commit is on main through a PR reviewed with
0 Act-on findings, (2) the folder's content equals that commit's tree, and (3) Orca's key and
fingerprint are for this sangsoe folder. --dry-run checks and prints, and never enables.`;

// The plugin folder beside this install: <root>/orca-plugin, whether run from source or dist/.
export function defaultPluginDir(from: string = fileURLToPath(import.meta.url)): string | null {
  for (let d = dirname(from); d !== dirname(d); d = dirname(d)) {
    if (existsSync(join(d, "orca-plugin", "orca-plugin.json"))) return join(d, "orca-plugin");
  }
  return null;
}

type Parsed = { dryRun: boolean; dir: string | null; commit: string | null } | { help: true } | { error: string };

export function parseArgs(args: readonly string[]): Parsed {
  const out = { dryRun: false, dir: null as string | null, commit: null as string | null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") return { help: true };
    if (a === "--dry-run") out.dryRun = true;
    else if ((a === "--dir" || a === "--commit") && args[i + 1] && !args[i + 1]?.startsWith("--")) {
      out[a === "--dir" ? "dir" : "commit"] = args[++i] ?? null;
    } else return { error: `unknown or incomplete argument: ${a}` };
  }
  return out;
}

export function render(r: ApproveResult): string {
  const lines = [
    `key: ${r.key ?? "-"}`,
    `fingerprint: ${r.fingerprint ?? "-"}`,
    ...r.checks.map((c) => `${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`),
  ];
  if (r.command) lines.push(`${r.enabled ? "ran" : "would run"}: ${r.command.join(" ")}`);
  lines.push(r.note);
  return lines.join("\n");
}

export async function pluginApprove(
  args: readonly string[],
  write: (line: string) => void,
  ports: ApprovePorts = nodePorts(write),
): Promise<{ code: number; out: string }> {
  const p = parseArgs(args);
  if ("help" in p) return { code: 0, out: USAGE };
  if ("error" in p) return { code: 2, out: `${p.error}\n${USAGE}` };
  const found = p.dir ?? defaultPluginDir();
  if (!found || !existsSync(join(found, "orca-plugin.json"))) return { code: 2, out: "no sangsoe Orca plugin folder found; pass --dir" };
  const dir = realpathSync(found);
  const commit = p.commit ?? (await resolveCommit(dir));
  if (!commit) return { code: 1, out: `cannot tell which commit ${dir} was built from (dirty checkout, no build-info.json); pass --commit` };
  const r = await approvePlugin({ dir, commit, dryRun: p.dryRun }, ports);
  return { code: r.ok ? 0 : 1, out: render(r) };
}
