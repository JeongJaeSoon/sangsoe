import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FULL_SHA, SANGSOE_REPO } from "../approve/approve.ts";
import { resolveCommit } from "../approve/ports.ts";
import { type CheckContext, type CheckResult, DOCTOR_CHECKS, type PluginBuild, runChecks } from "../checks/index.ts";
import { landAllowClause, landAllowRules } from "../checks/land-allowed.ts";
import type { Exec } from "../contract/orca.ts";
import { createOrcaAdapter } from "../orca/adapter.ts";
import { nodeExec } from "../orca/exec.ts";
import { VERSION } from "../version.ts";
import {
  type ClaudeProfile,
  currentProfile,
  type Host,
  lastLine,
  listMarketplaces,
  listOrcaPlugins,
  listPlugins,
  MARKETPLACE,
  orcaManifest,
  orcaPluginDir,
  orcaProfile,
  PLUGIN_ID,
  sangsoeOrca,
  UNREADABLE,
  userPlugin,
} from "./host.ts";
import { AUTO_COMPACT_DOCTOR_FIX, autoCompactRow } from "./auto-compact.ts";
import { PERMISSIONS_DOCTOR_FIX, permissionsRow, userSettingsPaths } from "./permissions.ts";
import { stageCore } from "./stage.ts";

// `warn` and `notice` print their fix but leave the exit code alone, as at the start.
export type Check =
  | { state: "ok" | "not yet"; name: string; detail: string }
  | { state: "fail" | "warn" | "notice"; name: string; detail: string; fix: string };

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

// Decision 167: the rows above read the profile doctor runs under; this one reads the profile Orca
// starts sessions with, through the same `claude plugin list` pointed at that directory.
function orcaProfileCheck(host: Host, root: string, current: ClaudeProfile): Check {
  const name = "orca claude profile";
  const fix = "sangsoe install";
  const orca = orcaProfile(host);
  if (!orca) return { state: "warn", name, detail: `${UNREADABLE("orca account list --json")}: Orca's selected profile is unchecked`, fix: "orca open" };
  // Decision 198: the same profile is read too, so this row always says whether sangsoe is enabled there.
  const same = orca.dir === current.dir;
  const where = same ? `${orca.dir} (the checked profile)` : orca.dir;
  const plugins = listPlugins(host, same ? undefined : orca.env);
  if (!plugins) return { state: "warn", name, detail: `${where}: ${UNREADABLE("claude plugin list --json")}`, fix };
  const p = userPlugin(plugins);
  const want = readManifest(host, join(root, "package.json"))?.version;
  if (!p) return { state: "warn", name, detail: `Orca starts sessions with ${where}, where ${PLUGIN_ID} is not installed`, fix };
  if (p.enabled === false) {
    return { state: "fail", name, detail: `Orca starts sessions with ${where}, where ${PLUGIN_ID} is disabled`, fix };
  }
  if (p.enabled !== true) return { state: "warn", name, detail: `Orca starts sessions with ${where}: whether ${PLUGIN_ID} is enabled is unknown`, fix: "claude plugin list --json" };
  if (p.version !== want) return { state: "warn", name, detail: `Orca starts sessions with ${where}, where ${PLUGIN_ID} is ${p.version}, tree is ${want}`, fix };
  return { state: "ok", name, detail: `Orca starts sessions with ${where}: ${PLUGIN_ID} ${p.version}, sangsoe enabled` };
}

// Decisions 198, 221 and 228: one read-only row, never `fail`. The profile Orca starts workers with is the one that matters.
function settingsChecks(host: Host, current: ClaudeProfile): Check[] {
  const dir = orcaProfile(host)?.dir ?? current.dir;
  const path = join(dir, "settings.json");
  let settings: unknown;
  try {
    settings = JSON.parse(host.readText(path));
  } catch {
    settings = undefined;
  }
  const perms = permissionsRow(path, settings);
  if (perms.all) return [{ state: "ok", name: "permissions", detail: perms.detail }];
  const land = landAllowClause(settings === undefined ? undefined : landAllowRules(settings));
  return [{ state: "warn", name: "permissions", detail: `${perms.detail}: sangsoe's sessions may stop on permission prompts${land}`, fix: PERMISSIONS_DOCTOR_FIX }];
}

// Decision 264: one warn-only row over the same profiles install --auto-compact writes; a higher value passes.
function autoCompactCheck(host: Host): Check {
  const name = "auto-compact window";
  const paths = userSettingsPaths(host, "auto-compact", []);
  const rows = paths.map((path) => {
    let settings: unknown;
    try {
      settings = JSON.parse(host.readText(path));
    } catch {
      settings = undefined;
    }
    return autoCompactRow(path, settings);
  });
  const detail = rows.map((r) => r.detail).join("; ");
  if (rows.every((r) => r.ok)) return { state: "ok", name, detail };
  return { state: "warn", name, detail: `${detail}: a long session compacts earlier than it should`, fix: AUTO_COMPACT_DOCTOR_FIX };
}

// The plugin row itself is the start check `claude-plugin-version`.
function claudeChecks(host: Host, root: string): Check[] {
  const v = host.run("claude", ["--version"]);
  if (v.code !== 0) {
    return [{ state: "fail", name: "claude", detail: `not runnable: ${lastLine(v)}`, fix: "install Claude Code and put `claude` on PATH" }];
  }
  const current = currentProfile(host);
  const out: Check[] = [
    { state: "ok", name: "claude", detail: v.stdout.trim() },
    {
      state: "ok",
      name: "claude profile",
      detail: `checked ${current.dir} (${host.env.CLAUDE_CONFIG_DIR ? "CLAUDE_CONFIG_DIR" : "CLAUDE_CONFIG_DIR unset"})`,
    },
    orcaProfileCheck(host, root, current),
    ...settingsChecks(host, current),
    autoCompactCheck(host),
  ];

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

const fromStart = (r: CheckResult): Check =>
  r.status === "ok"
    ? { state: "ok", name: r.id, detail: r.summary }
    : { state: r.status, name: r.id, detail: r.summary, fix: r.fix ?? "sangsoe doctor" };

const FETCH_TIMEOUT_MS = 120_000;

function download(cmd: string, args: readonly string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(cmd, [...args], { encoding: "buffer", maxBuffer: 256 * 1024 * 1024, timeout: FETCH_TIMEOUT_MS }, (err, out) =>
      err ? reject(err) : resolve(out),
    );
  });
}

// The same tarball and trust root as approve's fetch, but bounded: a stalled gh must not hang doctor.
async function fetchPluginTree(exec: Exec, commit: string, staged: boolean): Promise<{ dir: string; dispose(): Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "sangsoe-doctor-"));
  const dispose = () => rm(root, { recursive: true, force: true });
  try {
    await writeFile(join(root, "tree.tgz"), await download("gh", ["api", `repos/${SANGSOE_REPO}/tarball/${commit}`]));
    const tar = await exec("tar", ["-xzf", join(root, "tree.tgz"), "-C", root]);
    if (tar.code !== 0) throw new Error(`tar: ${tar.stderr.trim()}`);
    const tops = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory());
    if (tops.length !== 1 || !tops[0]) throw new Error("unexpected tarball layout");
    if (staged) await stageCore(join(root, tops[0].name));
    return { dir: join(root, tops[0].name, "orca-plugin"), dispose };
  } catch (e) {
    await dispose();
    throw e;
  }
}

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    return undefined;
  }
}

export function realPluginBuild(root: string, exec: Exec): PluginBuild {
  const dir = orcaPluginDir(root);
  // HEAD's tree, not the index or the folder, so a removal (staged or not) still names its commit.
  // A tree that is not such a checkout is a release, whose folder carries the core (decision 152).
  let checkout: Promise<boolean> | undefined;
  const isCheckout = () => {
    checkout ??= exec("git", ["-C", root, "cat-file", "-e", "HEAD:./orca-plugin/orca-plugin.json"]).then((r) => r.code === 0);
    return checkout;
  };
  return {
    dir,
    async buildCommit() {
      // Unlike approve, a dirty checkout still names HEAD: its edits are the drift to report.
      const head = (await isCheckout()) ? await exec("git", ["-C", root, "rev-parse", "HEAD"]) : undefined;
      if (head?.code === 0) return head.stdout.trim();
      return (
        (await resolveCommit(dir)) ?? {
          error: `${dir} 의 빌드 커밋을 모른다 (git checkout 도, build-info.json 도 아니다)`,
          fix: REINSTALL,
        }
      );
    },
    async reviewedHead(commit) {
      const cmp = await exec("gh", ["api", `repos/${SANGSOE_REPO}/compare/${commit}...main`, "--jq", ".status"]);
      const status = cmp.stdout.trim();
      if (cmp.code !== 0 || (status !== "ahead" && status !== "identical")) {
        return { error: `빌드 커밋 ${commit} 이 main 위에 없어 리뷰된 빌드가 아니다 (${status || cmp.code})`, fix: REINSTALL };
      }
      const jq = '[.[] | select(.merged_at != null and .base.ref == "main") | .head.sha]';
      const r = await exec("gh", ["api", `repos/${SANGSOE_REPO}/commits/${commit}/pulls`, "--jq", jq]);
      const heads = r.code === 0 ? parseJson(r.stdout) : undefined;
      if (Array.isArray(heads) && heads.length === 1 && FULL_SHA.test(String(heads[0]))) return String(heads[0]);
      return { error: `빌드 커밋 ${commit} 을 main 으로 머지한 PR 하나를 찾지 못해 리뷰된 head 를 모른다`, fix: `gh api repos/${SANGSOE_REPO}/commits/${commit}/pulls` };
    },
    async fetchTree(commit) {
      try {
        return await fetchPluginTree(exec, commit, !(await isCheckout()));
      } catch (e) {
        return { error: `${commit} 트리를 받지 못했다: ${e instanceof Error ? e.message : String(e)}`, fix: "gh auth status" };
      }
    },
  };
}

// The release always carries orca-plugin/, so the check runs even when the folder is gone.
export function realCheckContext(root: string, exec: Exec = nodeExec()): CheckContext {
  return { orca: createOrcaAdapter(exec), exec, coreVersion: VERSION, pluginBuild: realPluginBuild(root, exec) };
}

export type DoctorOptions = { offline: true } | { ctx: CheckContext };

export async function doctorChecks(host: Host, root: string, opts: DoctorOptions): Promise<Check[]> {
  const tree = treeChecks(host, root);
  if ("offline" in opts) return tree;
  const start = await runChecks(DOCTOR_CHECKS, opts.ctx);
  return [...tree, ...claudeChecks(host, root), orcaChecks(host, root), ...start.map(fromStart)];
}

export function formatChecks(checks: readonly Check[]): string[] {
  return checks.map((c) =>
    "fix" in c
      ? `${(c.state === "fail" ? "FAIL" : c.state).padEnd(8)} ${c.name}: ${c.detail} — fix: ${c.fix}`
      : `${c.state.padEnd(8)} ${c.name}: ${c.detail}`,
  );
}

export async function doctor(host: Host, root: string, opts: DoctorOptions): Promise<{ code: number; lines: string[] }> {
  const checks = await doctorChecks(host, root, opts);
  return { code: checks.some((c) => c.state === "fail") ? 1 : 0, lines: formatChecks(checks) };
}
