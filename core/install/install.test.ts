import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createFakeOrca, type FakeReply } from "../../test/fake-orca/index.ts";
import type { CheckContext, PluginBuild } from "../checks/index.ts";
import { createOrcaAdapter } from "../orca/adapter.ts";
import { doctor, realCheckContext, realPluginBuild } from "./doctor.ts";
import { type Host, type Marketplace, type RunResult, sangsoeOrca, treeRoot } from "./host.ts";
import { install, uninstall } from "./install.ts";

const ROOT = "/opt/homebrew/opt/sangsoe/libexec";
// A fixture tree's version, deliberately not the release's: these tests must not need a bump per release.
const V = "9.9.9-fixture";

// The start checks run against the fake Orca, whose sangsoe plugins are 0.1.0.
function orcaCtx(o: { scenario?: string; replies?: Record<string, FakeReply>; pluginBuild?: PluginBuild } = {}) {
  const fake = createFakeOrca({ scenario: o.scenario ?? "local", ...(o.replies ? { replies: o.replies } : {}) });
  const ctx: CheckContext = {
    orca: createOrcaAdapter(fake.exec),
    exec: fake.exec,
    coreVersion: "0.1.0",
    ...(o.pluginBuild ? { pluginBuild: o.pluginBuild } : {}),
  };
  return { ctx, fake };
}
const online = (scenario?: string) => ({ ctx: orcaCtx(scenario ? { scenario } : {}).ctx });

type State = { markets: Marketplace[]; plugins: { id: string; version: string; scope: string; enabled: boolean }[]; orca: boolean };

// A stand-in for claude and orca that keeps just enough state to show idempotence.
function fakeHost(
  opts: {
    orcaManifest?: boolean;
    state?: Partial<State>;
    fail?: string;
    devLoadCode?: number;
    orcaPlugin?: { status: string; isDev: boolean };
    files?: Record<string, string>;
  } = {},
) {
  const state: State = { markets: [], plugins: [], orca: false, ...opts.state };
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
    env: { SANGSOE_ROOT: ROOT },
    nodeVersion: "26.13.0",
    exists: (p) => files.has(p),
    readText: (p) => files.get(p) ?? "",
    run(cmd, args) {
      const line = [cmd, ...args].join(" ");
      calls.push(line);
      if (opts.fail && line.startsWith(opts.fail)) return { code: 1, stdout: "", stderr: "boom" };
      const a = args.join(" ");
      if (cmd === "claude") {
        if (a === "--version") return ok("2.1.319 (Claude Code)\n");
        if (a === "plugin marketplace list --json") return ok(JSON.stringify(state.markets));
        if (a === "plugin list --json") return ok(JSON.stringify(state.plugins));
        if (a.startsWith("plugin marketplace add ")) state.markets.push({ name: "sangsoe", source: "directory", path: args[3] ?? "" });
        if (a.startsWith("plugin marketplace remove ")) state.markets = state.markets.filter((m) => m.name !== "sangsoe");
        if (a.startsWith("plugin install ")) state.plugins.push({ id: "sangsoe@sangsoe", version: V, scope: "user", enabled: true });
        if (a.startsWith("plugin uninstall ")) state.plugins = [];
        return ok();
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
  return { host, calls, state };
}

const writes = (calls: string[]) => calls.filter((c) => !/ list --json$|--version$/.test(c));

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

test("a marketplace named sangsoe pointing elsewhere is replaced", async () => {
  const { host, calls } = fakeHost({ state: { markets: [{ name: "sangsoe", source: "directory", path: "/elsewhere" }] } });
  await install(host, ROOT, online().ctx);
  assert.deepEqual(writes(calls).slice(0, 2), [
    "claude plugin marketplace remove sangsoe --scope user",
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
  assert.ok(!calls.some((c) => c.includes("enable")), "install never approves");
});

test("uninstall removes the three registrations and keeps data", async () => {
  const { host, calls, state } = fakeHost({ orcaManifest: true });
  await install(host, ROOT, online().ctx);
  calls.length = 0;
  const r = uninstall(host);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.deepEqual(writes(calls), [
    "claude plugin uninstall sangsoe@sangsoe --scope user --keep-data",
    "claude plugin marketplace remove sangsoe --scope user",
    "orca plugin dev unload local.sangsoe --json",
  ]);
  assert.deepEqual(state.markets, []);
  assert.match(r.lines.join("\n"), /kept: ~\/\.local\/share\/sangsoe/);
});

test("uninstall with nothing registered changes nothing", () => {
  const { host, calls } = fakeHost();
  const r = uninstall(host);
  assert.equal(r.code, 0);
  assert.deepEqual(writes(calls), []);
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
