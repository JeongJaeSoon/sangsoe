import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { diskHash } from "../../test/dir-hash.ts";
import { createFakeOrca, type FakeReply } from "../../test/fake-orca/index.ts";
import { scratchDir } from "../../test/scratch.ts";
import type { CheckContext, PluginBuild } from "../checks/index.ts";
import { landAllowRules } from "../checks/land-allowed.ts";
import { createOrcaAdapter } from "../orca/adapter.ts";
import { doctor, realCheckContext, realPluginBuild } from "./doctor.ts";
import { type Host, type Marketplace, type RunResult, realHost, sangsoeOrca, treeRoot } from "./host.ts";
import { install, uninstall } from "./install.ts";
import { type Files, SANGSOE_RULES } from "./permissions.ts";

const ROOT = "/opt/homebrew/opt/sangsoe/libexec";
// A fixture tree's version, deliberately not the release's: these tests must not need a bump per release.
const V = "9.9.9-fixture";

// Never created: the config-reading rows see no file instead of the real home's.
const NO_HOME = join(tmpdir(), "sangsoe-install-test-no-home");

// The start checks run against the fake Orca, whose sangsoe plugins are 0.1.0.
function orcaCtx(o: { scenario?: string; replies?: Record<string, FakeReply>; pluginBuild?: PluginBuild } = {}) {
  const fake = createFakeOrca({ scenario: o.scenario ?? "local", ...(o.replies ? { replies: o.replies } : {}) });
  const ctx: CheckContext = {
    orca: createOrcaAdapter(fake.exec),
    exec: fake.exec,
    coreVersion: "0.1.0",
    home: NO_HOME,
    env: {},
    ...(o.pluginBuild ? { pluginBuild: o.pluginBuild } : {}),
  };
  return { ctx, fake };
}
const online = (scenario?: string) => ({ ctx: orcaCtx(scenario ? { scenario } : {}).ctx });

type Profile = { markets: Marketplace[]; plugins: { id: string; version: string; scope: string; enabled: boolean }[] };
type State = Profile & { orca: boolean };

const HOME = "/home/u";
const DEFAULT_DIR = join(HOME, ".claude");
const ORCA_DIR = "/orca/claude-profiles/p1/home";

// A stand-in for claude and orca that keeps just enough state to show idempotence. `state` is the
// profile install runs under; `profiles` holds other Claude config dirs, keyed by directory.
function fakeHost(
  opts: {
    orcaManifest?: boolean;
    state?: Partial<State>;
    fail?: string;
    devLoadCode?: number;
    orcaPlugin?: { status: string; isDev: boolean };
    files?: Record<string, string>;
    /** Orca's selected Claude home: the default dir when unset, `null` when `orca account list` fails. */
    orcaHome?: string | null;
    env?: Record<string, string>;
    profiles?: Record<string, Partial<Profile>>;
    /** The marketplace disappears under the remove (another remover got there first), which then fails. */
    removeGoneAlready?: boolean;
  } = {},
) {
  const state: State = { markets: [], plugins: [], orca: false, ...opts.state };
  const hostEnv: Record<string, string> = { SANGSOE_ROOT: ROOT, HOME, ...opts.env };
  const own = hostEnv.CLAUDE_CONFIG_DIR ?? DEFAULT_DIR;
  const profiles = new Map<string, Profile>([[own, state]]);
  for (const [dir, p] of Object.entries(opts.profiles ?? {})) profiles.set(dir, { markets: [], plugins: [], ...p });
  const profileFor = (env?: Readonly<Record<string, string | undefined>>): Profile => {
    const dir = env && "CLAUDE_CONFIG_DIR" in env ? (env.CLAUDE_CONFIG_DIR ?? DEFAULT_DIR) : own;
    const p = profiles.get(dir) ?? { markets: [], plugins: [] };
    profiles.set(dir, p);
    return p;
  };
  const orcaHome = opts.orcaHome === undefined ? DEFAULT_DIR : opts.orcaHome;
  const accounts =
    orcaHome === DEFAULT_DIR
      ? { accounts: [], activeAccountId: null, systemDefaultHome: DEFAULT_DIR }
      : { accounts: [{ id: "p1", home: orcaHome }], activeAccountId: "p1", systemDefaultHome: DEFAULT_DIR };
  const calls: string[] = [];
  const files = new Map<string, string>([
    [join(ROOT, "package.json"), JSON.stringify({ version: V, engines: { node: ">=24.15" } })],
    [join(ROOT, "claude-plugin/.claude-plugin/plugin.json"), JSON.stringify({ version: V })],
    [join(ROOT, ".claude-plugin/marketplace.json"), "{}"],
  ]);
  if (opts.orcaManifest) files.set(join(ROOT, "orca-plugin/orca-plugin.json"), JSON.stringify({ version: V }));
  for (const [rel, text] of Object.entries(opts.files ?? {})) files.set(join(ROOT, rel), text);
  const orcaPlugin = opts.orcaPlugin ?? { status: "running", isDev: true };
  const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" });
  const host: Host = {
    env: hostEnv,
    nodeVersion: "26.13.0",
    exists: (p) => files.has(p),
    readText: (p) => files.get(p) ?? "",
    run(cmd, args, env) {
      const line = [cmd, ...args].join(" ");
      const pinned = env && "CLAUDE_CONFIG_DIR" in env ? `CLAUDE_CONFIG_DIR=${env.CLAUDE_CONFIG_DIR ?? "(unset)"} ` : "";
      calls.push(pinned + line);
      if (opts.fail && line.startsWith(opts.fail)) return { code: 1, stdout: "", stderr: "boom" };
      const a = args.join(" ");
      if (cmd === "claude") {
        const p = profileFor(env);
        if (a === "--version") return ok("2.1.319 (Claude Code)\n");
        if (a === "plugin marketplace list --json") return ok(JSON.stringify(p.markets));
        if (a === "plugin list --json") return ok(JSON.stringify(p.plugins));
        if (a.startsWith("plugin marketplace add ")) p.markets.push({ name: "sangsoe", source: "directory", path: args[3] ?? "" });
        if (a.startsWith("plugin marketplace remove ")) {
          // As recorded in T6 0.1.1: the marketplace lives in known_marketplaces.json, not in user settings.
          if (args.includes("--scope")) {
            return { code: 1, stdout: "", stderr: "✘ Failed to remove marketplace: Marketplace 'sangsoe' is not declared in user settings. Omit --scope to remove it from all scopes." };
          }
          if (opts.removeGoneAlready) {
            p.markets = p.markets.filter((m) => m.name !== "sangsoe");
            return { code: 1, stdout: "", stderr: "✘ Marketplace 'sangsoe' not found" };
          }
          p.markets = p.markets.filter((m) => m.name !== "sangsoe");
        }
        if (a.startsWith("plugin install ")) p.plugins.push({ id: "sangsoe@sangsoe", version: V, scope: "user", enabled: true });
        if (a.startsWith("plugin uninstall ")) p.plugins = [];
        if (a.startsWith("plugin enable ")) {
          const row = p.plugins.find((x) => x.id === args[2]);
          if (!row || row.enabled) return { code: 1, stdout: "", stderr: "already enabled" };
          row.enabled = true;
        }
        return ok();
      }
      if (a === "account list --json") {
        return orcaHome === null ? { code: 1, stdout: "", stderr: "orca is not running" } : ok(JSON.stringify({ ok: true, result: { claude: accounts } }));
      }
      if (a === "plugin list --json") {
        const plugins = state.orca ? [{ pluginKey: "local.sangsoe", version: V, ...orcaPlugin }] : [];
        return ok(JSON.stringify({ ok: true, result: { plugins } }));
      }
      if (a.startsWith("plugin dev load ")) {
        state.orca = true;
        const code = opts.devLoadCode ?? 0;
        return { code, stdout: JSON.stringify({ error: { approval: { fingerprint: "sha256-abc" } } }), stderr: "" };
      }
      if (a.startsWith("plugin dev unload ")) state.orca = false;
      return ok();
    },
  };
  return { host, calls, state, profiles };
}

// `ps` is decision 247's read of the process table.
const writes = (calls: string[]) => calls.filter((c) => !/ list --json$|--version$|^ps /.test(c));

test("decision 247: install ends with the stale-session list, one line when none, and it never changes the exit code", async () => {
  const { host } = fakeHost();
  const none = await install(host, ROOT, online().ctx);
  assert.equal(none.code, 0, none.lines.join("\n"));
  assert.equal(none.lines.at(-1), "stale sessions: none");

  const gone = join(tmpdir(), "sangsoe-install-test-gone", "claude-plugin", "mcp", "server.js");
  const run = host.run;
  host.run = (cmd, args, env) =>
    cmd === "ps" ? { code: 0, stdout: `  11  1-00:00:00 node ${gone}\n  12  00:05 node ${gone}\n  13  00:05 node /x/other.js\n`, stderr: "" } : run(cmd, args, env);
  const two = await install(host, ROOT, online().ctx);
  assert.equal(two.code, 0, two.lines.join("\n"));
  const tail = two.lines.slice(two.lines.indexOf("") + 1).filter((l) => /^stale sessions|^ {2}pid |^restart each/.test(l));
  assert.equal(tail.length, 4, two.lines.join("\n"));
  assert.match(tail[0] ?? "", /^stale sessions: 2 sangsoe MCP servers/);
  assert.match(tail[1] ?? "", /^ {2}pid 11 .*installed none$/);
  assert.match(tail[2] ?? "", /^ {2}pid 12 /);
  assert.match(tail[3] ?? "", /^restart each with claude --continue in its terminal/);
  assert.equal(two.lines.at(-1), tail[3], "the list is the last thing install prints");
});

test("first install adds the marketplace at the tree root and installs the plugin at user scope", async () => {
  const { host, calls } = fakeHost();
  const r = await install(host, ROOT, online().ctx);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.deepEqual(writes(calls), [
    `claude plugin marketplace add ${ROOT} --scope user`,
    "claude plugin install sangsoe@sangsoe --scope user",
  ]);
  assert.match(r.lines.join("\n"), /orca: skipped/);
  assert.match(r.lines.join("\n"), /not yet +orca plugin/);
});

test("a second install updates instead of adding again", async () => {
  const { host, calls } = fakeHost();
  await install(host, ROOT, online().ctx);
  calls.length = 0;
  const r = await install(host, ROOT, online().ctx);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.deepEqual(writes(calls), ["claude plugin marketplace update sangsoe", "claude plugin update sangsoe@sangsoe --scope user"]);
});

const disabledPlugin = () => [{ id: "sangsoe@sangsoe", version: V, scope: "user", enabled: false }];
const added = (): Marketplace[] => [{ name: "sangsoe", source: "directory", path: ROOT }];

test("decision 166: install enables a plugin that update left disabled, once, through claude plugin enable", async () => {
  const { host, calls, state } = fakeHost({ state: { markets: added(), plugins: disabledPlugin() } });
  const r = await install(host, ROOT, online().ctx);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.deepEqual(writes(calls), [
    "claude plugin marketplace update sangsoe",
    "claude plugin update sangsoe@sangsoe --scope user",
    "claude plugin enable sangsoe@sangsoe --scope user",
  ]);
  assert.equal(state.plugins[0]?.enabled, true);
  assert.match(r.lines.join("\n"), /claude: enabled sangsoe@sangsoe/);
});

test("a failed enable fails install", async () => {
  const { host } = fakeHost({ state: { markets: added(), plugins: disabledPlugin() }, fail: "claude plugin enable" });
  const r = await install(host, ROOT, online().ctx);
  assert.equal(r.code, 1);
  assert.match(r.lines.join("\n"), /enabled sangsoe@sangsoe failed/);
});

test("decision 167: install also registers and enables in the Claude profile Orca selects, through CLAUDE_CONFIG_DIR", async () => {
  const { host, calls, profiles } = fakeHost({ orcaHome: ORCA_DIR, profiles: { [ORCA_DIR]: { markets: added(), plugins: disabledPlugin() } } });
  const r = await install(host, ROOT, online().ctx);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.deepEqual(writes(calls), [
    `claude plugin marketplace add ${ROOT} --scope user`,
    "claude plugin install sangsoe@sangsoe --scope user",
    `CLAUDE_CONFIG_DIR=${ORCA_DIR} claude plugin marketplace update sangsoe`,
    `CLAUDE_CONFIG_DIR=${ORCA_DIR} claude plugin update sangsoe@sangsoe --scope user`,
    `CLAUDE_CONFIG_DIR=${ORCA_DIR} claude plugin enable sangsoe@sangsoe --scope user`,
  ]);
  assert.equal(profiles.get(ORCA_DIR)?.plugins[0]?.enabled, true);
  assert.match(r.lines.join("\n"), new RegExp(`claude \\(Orca profile ${ORCA_DIR}\\): enabled sangsoe@sangsoe`));
  assert.match(r.lines.join("\n"), new RegExp(`ok +orca claude profile: Orca starts sessions with ${ORCA_DIR}: sangsoe@sangsoe ${V}, sangsoe enabled`));
});

test("an Orca selection of the default home runs claude with CLAUDE_CONFIG_DIR unset", async () => {
  const { host, calls } = fakeHost({ env: { CLAUDE_CONFIG_DIR: ORCA_DIR } });
  const r = await install(host, ROOT, online().ctx);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.ok(writes(calls).includes("CLAUDE_CONFIG_DIR=(unset) claude plugin install sangsoe@sangsoe --scope user"), calls.join("\n"));
});

test("Orca selecting the profile install runs under adds no second registration", async () => {
  const { host, calls } = fakeHost({ env: { CLAUDE_CONFIG_DIR: ORCA_DIR }, orcaHome: ORCA_DIR });
  const r = await install(host, ROOT, online().ctx);
  assert.ok(!calls.some((c) => c.startsWith("CLAUDE_CONFIG_DIR=")), calls.join("\n"));
  assert.match(r.lines.join("\n"), new RegExp(`Orca starts new sessions with this profile \\(${ORCA_DIR}\\)`));
});

test("doctor names the profile it checked", async () => {
  for (const [env, want] of [
    [{}, `checked ${DEFAULT_DIR} \\(CLAUDE_CONFIG_DIR unset\\)`],
    [{ CLAUDE_CONFIG_DIR: ORCA_DIR }, `checked ${ORCA_DIR} \\(CLAUDE_CONFIG_DIR\\)`],
  ] as const) {
    const { host } = fakeHost({ env });
    const r = await doctor(host, ROOT, online());
    assert.ok(r.lines.some((l) => new RegExp(`^ok +claude profile: ${want}$`).test(l)), r.lines.join("\n"));
  }
});

test("doctor fails a disabled plugin and warns on a missing one in Orca's selected profile, with sangsoe install as the fix", async () => {
  for (const [plugins, state, level] of [
    [disabledPlugin(), "is disabled", "FAIL"],
    [[], "is not installed", "warn"],
  ] as const) {
    const { host, calls } = fakeHost({ orcaHome: ORCA_DIR, profiles: { [ORCA_DIR]: { markets: added(), plugins: [...plugins] } } });
    const r = await doctor(host, ROOT, online());
    const row = new RegExp(`^${level} +orca claude profile: Orca starts sessions with ${ORCA_DIR}, where sangsoe@sangsoe ${state} — fix: sangsoe install$`);
    assert.ok(r.lines.some((l) => row.test(l)), r.lines.join("\n"));
    assert.ok(!calls.some((c) => /\benable\b/.test(c)), "doctor never enables");
  }
});

const settingsRows = (lines: readonly string[]) => lines.filter((l) => /^\S+ +(permissions|land allow): /.test(l));

function withSettings(host: Host, dir: string, settings: unknown): Host {
  const read = host.readText;
  host.readText = (p) => (p === join(dir, "settings.json") ? JSON.stringify(settings) : read(p));
  return host;
}

test("decision 228: after install --permissions, doctor states the permission and land facts in one row", async () => {
  const m = SANGSOE_RULES.length;
  assert.ok(landAllowRules({ permissions: { allow: [...SANGSOE_RULES] } }).permissions.length > 0, "sangsoe's rules allow land, so the full row covers it");
  // The live profile after U82: the 16 rules beside an older land rule the owner had added.
  const host = withSettings(fakeHost().host, DEFAULT_DIR, { permissions: { allow: ["Bash(sangsoe land:*)", ...SANGSOE_RULES] } });
  const r = await doctor(host, ROOT, online());
  assert.deepEqual(settingsRows(r.lines), [`ok       permissions: ${m} of ${m} sangsoe rules present in ${DEFAULT_DIR}/settings.json`], r.lines.join("\n"));
});

test("decision 228: with rules missing the one row still warns with its fix and says whether land is allowed", async () => {
  const m = SANGSOE_RULES.length;
  const fix = " — fix: sangsoe install --permissions (from a Claude Code ! line: read the diff it prints, then run sangsoe install --permissions --yes)";

  const { host, calls } = fakeHost({ orcaHome: ORCA_DIR, profiles: { [ORCA_DIR]: { markets: added(), plugins: [{ id: "sangsoe@sangsoe", version: V, scope: "user", enabled: true }] } } });
  const missing = await doctor(host, ROOT, online());
  assert.deepEqual(
    settingsRows(missing.lines),
    [`warn     permissions: 0 of ${m} sangsoe rules present in ${ORCA_DIR}/settings.json (missing or not JSON): sangsoe's sessions may stop on permission prompts, and auto mode may refuse a worker's land${fix}`],
    missing.lines.join("\n"),
  );
  assert.ok(!calls.some((c) => /\b(config|settings)\b.*\bset\b/.test(c)), "nothing is written");

  const partial = withSettings(fakeHost().host, DEFAULT_DIR, { permissions: { allow: [...SANGSOE_RULES.slice(1)] }, autoMode: { allow: ["Allow sangsoe land for workers"] } });
  const r = await doctor(partial, ROOT, online());
  assert.deepEqual(
    settingsRows(r.lines),
    [`warn     permissions: ${m - 1} of ${m} sangsoe rules present in ${DEFAULT_DIR}/settings.json: sangsoe's sessions may stop on permission prompts; sangsoe land is allowed (permissions.allow 0, autoMode.allow 1)${fix}`],
    r.lines.join("\n"),
  );

  const noLand = await doctor(withSettings(fakeHost().host, DEFAULT_DIR, { permissions: { allow: [...SANGSOE_RULES.slice(1)] } }), ROOT, online());
  assert.deepEqual(
    settingsRows(noLand.lines),
    [`warn     permissions: ${m - 1} of ${m} sangsoe rules present in ${DEFAULT_DIR}/settings.json: sangsoe's sessions may stop on permission prompts, and auto mode may refuse a worker's land${fix}`],
    noLand.lines.join("\n"),
  );
});

test("decision 221: uninstall removes the rules sangsoe recorded adding, and says so", () => {
  const record = join(HOME, ".local/share/sangsoe/permissions.json");
  const settingsPath = join(DEFAULT_DIR, "settings.json");
  const disk = new Map<string, string>([
    [record, JSON.stringify({ targets: { [settingsPath]: { rules: ["mcp__plugin_sangsoe_sangsoe"], created: [] } } })],
    [settingsPath, '{\n  "permissions": {\n    "allow": [\n      "Bash(ls:*)",\n      "mcp__plugin_sangsoe_sangsoe"\n    ]\n  }\n}\n'],
  ]);
  const files: Files = {
    read: (p) => disk.get(p),
    write: (p, t) => void disk.set(p, t),
    remove: (p) => void disk.delete(p),
  };
  const r = uninstall(fakeHost().host, files);
  assert.ok(r.lines.includes(`permissions: removed 1 rules sangsoe added from ${settingsPath}`), r.lines.join("\n"));
  assert.equal(disk.get(settingsPath), '{\n  "permissions": {\n    "allow": [\n      "Bash(ls:*)"\n    ]\n  }\n}\n');
  assert.ok(!disk.has(record));
  assert.match(r.lines.at(-1) ?? "", /^kept: /);
});

test("decision 198: Orca on the checked profile still reads whether sangsoe is enabled there, and a disabled one is not green", async () => {
  const { host, calls } = fakeHost({ env: { CLAUDE_CONFIG_DIR: ORCA_DIR }, orcaHome: ORCA_DIR, profiles: { [ORCA_DIR]: { markets: added(), plugins: [...disabledPlugin()] } } });
  const r = await doctor(host, ROOT, online());
  assert.ok(r.lines.some((l) => /^FAIL +orca claude profile: .*\(the checked profile\), where sangsoe@sangsoe is disabled/.test(l)), r.lines.join("\n"));
  assert.equal(r.code, 1);
  assert.ok(!calls.some((c) => c.startsWith("CLAUDE_CONFIG_DIR=")), "the same profile is read without a second CLAUDE_CONFIG_DIR");
});

test("doctor warns on a plugin version in Orca's selected profile that differs from the tree", async () => {
  const plugins = [{ id: "sangsoe@sangsoe", version: "0.0.1", scope: "user", enabled: true }];
  const { host } = fakeHost({ orcaHome: ORCA_DIR, profiles: { [ORCA_DIR]: { markets: added(), plugins } } });
  const r = await doctor(host, ROOT, online());
  const row = new RegExp(`^warn +orca claude profile: .* sangsoe@sangsoe is 0\\.0\\.1, tree is ${V} — fix: sangsoe install$`);
  assert.ok(r.lines.some((l) => row.test(l)), r.lines.join("\n"));
});

test("a failed step in Orca's selected profile fails install before the Orca plugin step", async () => {
  const { host, calls } = fakeHost({ orcaManifest: true, orcaHome: ORCA_DIR, profiles: { [ORCA_DIR]: { markets: added(), plugins: disabledPlugin() } } });
  const run = host.run;
  host.run = (cmd, args, env) =>
    env && args.join(" ").startsWith("plugin enable") ? { code: 1, stdout: "", stderr: "boom" } : run(cmd, args, env);
  const r = await install(host, ROOT, online().ctx);
  assert.equal(r.code, 1);
  assert.match(r.lines.join("\n"), new RegExp(`claude \\(Orca profile ${ORCA_DIR}\\): enabled sangsoe@sangsoe failed`));
  assert.ok(!calls.some((c) => c.startsWith("orca plugin dev load")));
});

test("realHost.run passes env overrides to the child and removes a variable set to undefined", () => {
  process.env.SANGSOE_TEST_KEEP = "kept";
  process.env.SANGSOE_TEST_DROP = "dropped";
  try {
    const script = "console.log([process.env.SANGSOE_TEST_KEEP, process.env.SANGSOE_TEST_SET, 'SANGSOE_TEST_DROP' in process.env].join(','))";
    const r = realHost.run(process.execPath, ["-e", script], { SANGSOE_TEST_SET: "set", SANGSOE_TEST_DROP: undefined });
    assert.equal(r.stdout.trim(), "kept,set,false");
    assert.equal(process.env.SANGSOE_TEST_DROP, "dropped", "the parent's env is untouched");
  } finally {
    delete process.env.SANGSOE_TEST_KEEP;
    delete process.env.SANGSOE_TEST_DROP;
  }
});

test("an unreadable Orca account list is a doctor warning and an install line, never taken as the same profile", async () => {
  const { host, calls } = fakeHost({ orcaHome: null });
  const r = await install(host, ROOT, online().ctx);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.ok(!calls.some((c) => c.startsWith("CLAUDE_CONFIG_DIR=")));
  const text = r.lines.join("\n");
  assert.match(text, /cannot read `orca account list --json`.* for Orca's selected profile/);
  assert.match(text, /warn +orca claude profile: cannot read `orca account list --json`.* — fix: orca open/);
});

test("uninstall also unregisters Orca's selected profile", async () => {
  const { host, calls, profiles } = fakeHost({ orcaHome: ORCA_DIR });
  await install(host, ROOT, online().ctx);
  calls.length = 0;
  const r = uninstall(host);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.deepEqual(writes(calls), [
    "claude plugin uninstall sangsoe@sangsoe --scope user --keep-data",
    "claude plugin marketplace remove sangsoe",
    `CLAUDE_CONFIG_DIR=${ORCA_DIR} claude plugin uninstall sangsoe@sangsoe --scope user --keep-data`,
    `CLAUDE_CONFIG_DIR=${ORCA_DIR} claude plugin marketplace remove sangsoe`,
  ]);
  assert.deepEqual(profiles.get(ORCA_DIR), { markets: [], plugins: [] });
});

test("a marketplace named sangsoe pointing elsewhere is replaced", async () => {
  const { host, calls } = fakeHost({ state: { markets: [{ name: "sangsoe", source: "directory", path: "/elsewhere" }] } });
  await install(host, ROOT, online().ctx);
  assert.deepEqual(writes(calls).slice(0, 2), [
    "claude plugin marketplace remove sangsoe",
    `claude plugin marketplace add ${ROOT} --scope user`,
  ]);
});

test("a failing claude step stops install with exit 1", async () => {
  const { host, calls } = fakeHost({ fail: "claude plugin marketplace add" });
  const r = await install(host, ROOT, online().ctx);
  assert.equal(r.code, 1);
  assert.ok(!calls.some((c) => c.startsWith("claude plugin install")));
});

test("with an Orca plugin, install dev-loads it and reads exit 3 as waiting for approval", async () => {
  const { host, calls } = fakeHost({ orcaManifest: true, devLoadCode: 3 });
  const r = await install(host, ROOT, online().ctx);
  assert.ok(calls.includes(`orca plugin dev load ${join(ROOT, "orca-plugin")} --json`));
  assert.match(r.lines.join("\n"), /approval waits — fingerprint sha256-abc/);
  assert.ok(!calls.some((c) => c.startsWith("orca ") && c.includes("enable")), "install never approves");
});

test("uninstall removes the three registrations and keeps data", async () => {
  const { host, calls, state } = fakeHost({ orcaManifest: true });
  await install(host, ROOT, online().ctx);
  calls.length = 0;
  const r = uninstall(host);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.deepEqual(writes(calls), [
    "claude plugin uninstall sangsoe@sangsoe --scope user --keep-data",
    "claude plugin marketplace remove sangsoe",
    "orca plugin dev unload local.sangsoe --json",
  ]);
  assert.deepEqual(state.markets, []);
  // README's Uninstall section quotes these lines.
  assert.deepEqual(r.lines, [
    "claude: uninstalled sangsoe@sangsoe",
    "claude: removed marketplace sangsoe",
    "claude: restart every running Claude Code session that loaded sangsoe@sangsoe; until then it keeps the plugin's hooks",
    "orca: unloaded local.sangsoe",
    "permissions: sangsoe added no permission rules",
    "kept: ~/.local/share/sangsoe (data) and ~/.config/sangsoe (settings); `brew uninstall sangsoe` removes the tree",
  ]);
});

test("decision 208: a marketplace remove that fails but leaves no marketplace counts as removed", async () => {
  const { host, profiles } = fakeHost({ removeGoneAlready: true });
  await install(host, ROOT, online().ctx);
  const r = uninstall(host);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.ok(r.lines.includes("claude: removed marketplace sangsoe"), r.lines.join("\n"));
  assert.deepEqual(profiles.get(DEFAULT_DIR)?.markets, []);
});

test("a marketplace remove that fails and leaves the marketplace fails uninstall", async () => {
  const { host } = fakeHost({ fail: "claude plugin marketplace remove" });
  await install(host, ROOT, online().ctx);
  const r = uninstall(host);
  assert.equal(r.code, 1);
  assert.ok(r.lines.some((l) => /^claude: removed marketplace sangsoe failed \(exit 1\): boom$/.test(l)), r.lines.join("\n"));
});

test("uninstall with nothing registered changes nothing", () => {
  const { host, calls } = fakeHost();
  const r = uninstall(host);
  assert.equal(r.code, 0);
  assert.deepEqual(writes(calls), []);
  assert.ok(!r.lines.some((l) => /restart/.test(l)), "nothing was uninstalled, so no session needs a restart");
});

test("doctor --offline reads only the tree", async () => {
  const { host, calls } = fakeHost();
  const r = await doctor(host, ROOT, { offline: true });
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.deepEqual(calls, []);
  assert.match(r.lines.join("\n"), /ok +node: 26\.13\.0 \(needs >= 24\.15\)/);
});

// The printed run is the PR's evidence of what doctor shows a person.
const show = (t: { diagnostic(m: string): void }, r: { code: number; lines: string[] }) =>
  t.diagnostic(`exit ${r.code}\n${r.lines.join("\n")}`);

test("on the recorded local Orca, doctor runs the start checks and passes", async (t) => {
  const { host } = fakeHost();
  await install(host, ROOT, online().ctx);
  const r = await doctor(host, ROOT, online("local"));
  show(t, r);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.ok(r.lines.some((l) => /^ok +orca-capabilities: /.test(l)), r.lines.join("\n"));
  assert.ok(!r.lines.some((l) => l.startsWith("FAIL")));
  assert.ok(!r.lines.some((l) => /start checks/.test(l)), "no placeholder once the start checks run");
  assert.ok(r.lines.some((l) => /^ok +sqlite-version: SQLite \d/.test(l)), r.lines.join("\n"));
  assert.ok(!r.lines.some((l) => /^not yet +sqlite/.test(l)), "no sqlite placeholder once the floor check runs");
});

test("a missing Orca capability fails doctor with the capabilities row and its fix", async (t) => {
  const { host } = fakeHost();
  await install(host, ROOT, online().ctx);
  const r = await doctor(host, ROOT, online("missing-capability"));
  show(t, r);
  assert.equal(r.code, 1, r.lines.join("\n"));
  assert.ok(r.lines.some((l) => /^FAIL +orca-capabilities: .*worker-auto-release.* — fix: .+$/.test(l)), r.lines.join("\n"));
});

test("a missing Orca capability fails install too", async (t) => {
  const { host } = fakeHost();
  const r = await install(host, ROOT, online("missing-capability").ctx);
  show(t, r);
  assert.equal(r.code, 1, r.lines.join("\n"));
  assert.ok(r.lines.some((l) => /^FAIL +orca-capabilities: /.test(l)), r.lines.join("\n"));
});

test("a start-check warning is printed with its fix but keeps exit 0", async () => {
  const { host } = fakeHost();
  await install(host, ROOT, online().ctx);
  const r = await doctor(host, ROOT, online("version-drift"));
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.ok(r.lines.some((l) => /^warn +claude-plugin-version: .* — fix: sangsoe install$/.test(l)), r.lines.join("\n"));
});

test("doctor prints exactly one claude-plugin-version row", async () => {
  const { host } = fakeHost();
  await install(host, ROOT, online().ctx);
  const r = await doctor(host, ROOT, online());
  assert.equal(r.lines.filter((l) => /claude-plugin-version|claude plugin:/.test(l)).length, 1, r.lines.join("\n"));
});

const DIR = join(ROOT, "orca-plugin");
const BUILT = "b".repeat(40);
const HEAD = "d".repeat(40);
// contentHash per folder: the installed one, and each fetched commit's tree at /trees/<sha>.
function hashes(o: { installed: string | null; built: string; head?: string; reviewedHead?: PluginBuild["reviewedHead"] }) {
  const disposed: string[] = [];
  const byDir: Record<string, string | null> = { [DIR]: o.installed, [`/trees/${BUILT}`]: o.built, [`/trees/${HEAD}`]: o.head ?? o.built };
  const replies = {
    "plugin-inspect": (args: readonly string[]): RunResult => {
      const hash = byDir[args[2] ?? ""];
      return hash
        ? { code: 0, stdout: JSON.stringify({ ok: true, result: { contentHash: hash } }), stderr: "" }
        : { code: 1, stdout: JSON.stringify({ ok: false, error: { code: "invalid_plugin" } }), stderr: "" };
    },
  };
  const pluginBuild: PluginBuild = {
    dir: DIR,
    buildCommit: async () => BUILT,
    reviewedHead: o.reviewedHead ?? (async () => HEAD),
    fetchTree: async (commit) => ({ dir: `/trees/${commit}`, dispose: async () => void disposed.push(commit) }),
  };
  return { ...orcaCtx({ replies, pluginBuild }), disposed };
}

test("an installed plugin folder that differs from its build fails doctor with sangsoe plugin approve", async (t) => {
  const { host, calls } = fakeHost({ orcaManifest: true });
  await install(host, ROOT, online().ctx);
  const { ctx, fake, disposed } = hashes({ installed: "sha256-edited", built: "sha256-reviewed" });
  const r = await doctor(host, ROOT, { ctx });
  show(t, r);
  assert.equal(r.code, 1, r.lines.join("\n"));
  assert.ok(
    r.lines.some((l) => /^FAIL +orca-plugin-content: .*sha256-edited.* — fix: sangsoe plugin approve$/.test(l)),
    r.lines.join("\n"),
  );
  assert.ok(![...calls, ...fake.calls.map((c) => c.join(" "))].some((c) => /\benable\b/.test(c)), "doctor never enables");
  assert.deepEqual(disposed, [BUILT], "the fetched tree is removed");
});

test("a build commit whose tree differs from the reviewed PR head fails, as approve would", async () => {
  const { host } = fakeHost({ orcaManifest: true });
  const { ctx, disposed } = hashes({ installed: "sha256-main", built: "sha256-main", head: "sha256-reviewed" });
  const r = await doctor(host, ROOT, { ctx });
  assert.ok(
    r.lines.some((l) => new RegExp(`^FAIL +orca-plugin-content: .*리뷰된 head ${HEAD}.* — fix: sangsoe plugin approve$`).test(l)),
    r.lines.join("\n"),
  );
  assert.deepEqual(disposed, [BUILT, HEAD]);
});

test("an installed plugin folder equal to its build and reviewed head is green", async () => {
  const { host } = fakeHost({ orcaManifest: true });
  const { ctx } = hashes({ installed: "sha256-same", built: "sha256-same" });
  const r = await doctor(host, ROOT, { ctx });
  assert.ok(r.lines.some((l) => /^ok +orca-plugin-content: /.test(l)), r.lines.join("\n"));
});

// Real folders and an inspect that hashes what is on disk, `.orca/` included, as Orca's does.
function onDisk(edit?: (installed: string) => void) {
  const root = scratchDir("sangsoe-u128-doctor-");
  const built = join(root, "tree", "orca-plugin");
  const installed = join(root, "libexec", "orca-plugin");
  for (const d of [built, installed]) {
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "orca-plugin.json"), '{"id":"sangsoe"}');
    writeFileSync(join(d, "main.ts"), "export {};");
  }
  edit?.(installed);
  const replies = {
    "plugin-inspect": (args: readonly string[]): RunResult => {
      const hash = diskHash(args[2] ?? "");
      return hash
        ? { code: 0, stdout: JSON.stringify({ ok: true, result: { contentHash: hash } }), stderr: "" }
        : { code: 1, stdout: JSON.stringify({ ok: false, error: { code: "invalid_plugin" } }), stderr: "" };
    },
  };
  const pluginBuild: PluginBuild = {
    dir: installed,
    buildCommit: async () => BUILT,
    reviewedHead: async () => BUILT,
    fetchTree: async () => ({ dir: built, dispose: async () => {} }),
  };
  return { installed, ...orcaCtx({ replies, pluginBuild }) };
}

// What `orca plugin dev load` writes into the folder it loads (`orca plugin types --help`).
function orcaWritesTypes(dir: string): void {
  mkdirSync(join(dir, ".orca", "types", "orca"), { recursive: true });
  writeFileSync(join(dir, ".orca", ".gitignore"), "*");
  writeFileSync(join(dir, ".orca", "types", "orca", "index.d.ts"), "declare const orca: unknown;");
}

test("install, Orca's dev load writes .orca/ into the folder, install again: doctor stays green (U128)", async (t) => {
  const { host } = fakeHost({ orcaManifest: true });
  const { ctx, installed } = onDisk();
  await install(host, ROOT, online().ctx);
  const before = await doctor(host, ROOT, { ctx });
  assert.ok(before.lines.some((l) => /^ok +orca-plugin-content: /.test(l)), before.lines.join("\n"));
  orcaWritesTypes(installed);
  await install(host, ROOT, online().ctx);
  const r = await doctor(host, ROOT, { ctx });
  show(t, r);
  assert.ok(r.lines.some((l) => /^ok +orca-plugin-content: /.test(l)), r.lines.join("\n"));
});

test("an edit outside .orca/ still fails doctor when Orca's .orca/ is there too (U128)", async () => {
  const { host } = fakeHost({ orcaManifest: true });
  const { ctx } = onDisk((installed) => {
    orcaWritesTypes(installed);
    writeFileSync(join(installed, "main.ts"), "export const edited = 1;");
  });
  const r = await doctor(host, ROOT, { ctx });
  assert.ok(r.lines.some((l) => /^FAIL +orca-plugin-content: .* — fix: sangsoe plugin approve$/.test(l)), r.lines.join("\n"));
});

test("an installed folder Orca cannot inspect, while its build has a plugin, fails", async () => {
  const { host } = fakeHost({ orcaManifest: true });
  const { ctx } = hashes({ installed: null, built: "sha256-reviewed" });
  const r = await doctor(host, ROOT, { ctx });
  assert.ok(r.lines.some((l) => /^FAIL +orca-plugin-content: .*inspect .* — fix: brew reinstall sangsoe$/.test(l)), r.lines.join("\n"));
});

test("a reviewed head that cannot be found is a warning, not a pass or a failure", async () => {
  const { host } = fakeHost({ orcaManifest: true });
  await install(host, ROOT, online().ctx);
  const { ctx } = hashes({
    installed: "sha256-same",
    built: "sha256-same",
    reviewedHead: async () => ({ error: "no merged PR", fix: "gh api x" }),
  });
  const r = await doctor(host, ROOT, { ctx });
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.ok(r.lines.some((l) => /^warn +orca-plugin-content: no merged PR — fix: gh api x$/.test(l)), r.lines.join("\n"));
});

test("the real build commit of a checkout is its HEAD when dirty or when the folder is gone", async () => {
  const root = mkdtempSync(join(tmpdir(), "sangsoe-doctor-"));
  try {
    mkdirSync(join(root, "orca-plugin"));
    writeFileSync(join(root, "orca-plugin", "orca-plugin.json"), "{}");
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], {
        cwd: root,
        encoding: "utf8",
      }).trim();
    git("init", "-q");
    git("add", ".");
    git("commit", "-q", "-m", "x");
    const build = realCheckContext(root).pluginBuild;
    writeFileSync(join(root, "orca-plugin", "main.ts"), "edited");
    assert.equal(await build?.buildCommit(), git("rev-parse", "HEAD"));
    rmSync(join(root, "orca-plugin"), { recursive: true });
    assert.equal(await build?.buildCommit(), git("rev-parse", "HEAD"));
    git("rm", "-r", "-q", "--cached", "orca-plugin");
    assert.equal(await build?.buildCommit(), git("rev-parse", "HEAD"), "a staged removal still names HEAD");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a build commit that is not on main has no reviewed head, as approve requires", async () => {
  const seen: string[] = [];
  const exec = async (cmd: string, args: readonly string[]): Promise<RunResult> => {
    seen.push([cmd, ...args].join(" "));
    if (args[1]?.includes("/compare/")) return { code: 0, stdout: "diverged\n", stderr: "" };
    return { code: 0, stdout: JSON.stringify([HEAD]), stderr: "" };
  };
  const head = await realPluginBuild(ROOT, exec).reviewedHead(BUILT);
  assert.ok(typeof head !== "string" && /main 위에 없어/.test(head.error), JSON.stringify(head));
  assert.ok(!seen.some((c) => c.includes("/pulls")), "the PR lookup waits for the main check");
});

test("a build commit on main names its one merged PR's head", async () => {
  const exec = async (_cmd: string, args: readonly string[]): Promise<RunResult> =>
    args[1]?.includes("/compare/") ? { code: 0, stdout: "ahead\n", stderr: "" } : { code: 0, stdout: JSON.stringify([HEAD]), stderr: "" };
  assert.equal(await realPluginBuild(ROOT, exec).reviewedHead(BUILT), HEAD);
});

test("doctor flags a node below the engines floor", async () => {
  const { host } = fakeHost();
  const r = await doctor({ ...host, nodeVersion: "24.2.0" }, ROOT, { offline: true });
  assert.equal(r.code, 1);
});

test("doctor fails with a fix command when nothing is registered", async () => {
  const { host } = fakeHost();
  const r = await doctor(host, ROOT, online());
  assert.equal(r.code, 1);
  assert.ok(r.lines.some((l) => /^FAIL +claude marketplace: .* — fix: sangsoe install$/.test(l)));
});

test("an unreadable plugin list stops install before installing anything", async () => {
  const { host, calls } = fakeHost({ fail: "claude plugin list" });
  const r = await install(host, ROOT, online().ctx);
  assert.equal(r.code, 1);
  assert.ok(!calls.some((c) => c.startsWith("claude plugin install") || c.startsWith("claude plugin update")));
});

test("uninstall fails, not succeeds, when it cannot read what is registered", () => {
  const { host } = fakeHost({ fail: "claude plugin list" });
  const r = uninstall(host);
  assert.equal(r.code, 1);
  assert.match(r.lines.join("\n"), /cannot read `plugin list --json`/);
});

test("uninstall unloads a sangsoe dev plugin even when this tree has no Orca manifest", () => {
  const { host, calls } = fakeHost({ state: { orca: true } });
  uninstall(host);
  assert.ok(calls.includes("orca plugin dev unload local.sangsoe --json"));
});

test("uninstall fails when Orca's plugin list is unreadable, manifest or not", () => {
  const { host } = fakeHost({ fail: "orca plugin list" });
  const r = uninstall(host);
  assert.equal(r.code, 1);
  assert.match(r.lines.join("\n"), /^orca: cannot read/m);
});

test("the sangsoe dev load is picked even when an installed sangsoe is listed first", () => {
  const installed = { pluginKey: "acme.sangsoe", isDev: false };
  const dev = { pluginKey: "local.sangsoe", isDev: true };
  assert.equal(sangsoeOrca([installed, dev]), dev);
  assert.equal(sangsoeOrca([installed]), installed);
  assert.equal(sangsoeOrca([{ pluginKey: "acme.other", isDev: true }]), undefined);
});

test("doctor reports a malformed manifest as FAIL instead of throwing", async () => {
  const { host } = fakeHost({ files: { "claude-plugin/.claude-plugin/plugin.json": "{" } });
  const r = await doctor(host, ROOT, { offline: true });
  assert.equal(r.code, 1);
  assert.match(r.lines[0] ?? "", /^FAIL +tree: .*plugin\.json is unreadable/);
});

for (const [orcaPlugin, why] of [
  [{ status: "errored", isDev: true }, /is errored/],
  [{ status: "pending", isDev: true }, /waits for approval/],
  [{ status: "running", isDev: false }, /not the Homebrew tree's development load/],
] as const) {
  test(`doctor fails an Orca plugin that is ${orcaPlugin.status}${orcaPlugin.isDev ? "" : ", not dev"}`, async () => {
    const { host } = fakeHost({ orcaManifest: true, orcaPlugin });
    await install(host, ROOT, online().ctx);
    const r = await doctor(host, ROOT, online());
    assert.equal(r.code, 1);
    assert.ok(r.lines.some((l) => /^FAIL +orca plugin/.test(l) && why.test(l)), r.lines.join("\n"));
  });
}

test("treeRoot prefers SANGSOE_ROOT, else walks up to the marketplace file", () => {
  const { host } = fakeHost();
  assert.equal(treeRoot(host), ROOT);
  const noEnv = { ...host, env: {} };
  assert.equal(treeRoot(noEnv, join(ROOT, "dist/core/install")), ROOT);
});
