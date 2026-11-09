import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { doctor } from "./doctor.ts";
import { type Host, type Marketplace, type RunResult, treeRoot } from "./host.ts";
import { install, uninstall } from "./install.ts";

const ROOT = "/opt/homebrew/opt/sangsoe/libexec";
const V = "0.1.0-rc.1";

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

test("first install adds the marketplace at the tree root and installs the plugin at user scope", () => {
  const { host, calls } = fakeHost();
  const r = install(host, ROOT);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.deepEqual(writes(calls), [
    `claude plugin marketplace add ${ROOT} --scope user`,
    "claude plugin install sangsoe@sangsoe --scope user",
  ]);
  assert.match(r.lines.join("\n"), /orca: skipped/);
  assert.match(r.lines.join("\n"), /not yet +orca plugin/);
});

test("a second install updates instead of adding again", () => {
  const { host, calls } = fakeHost();
  install(host, ROOT);
  calls.length = 0;
  const r = install(host, ROOT);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.deepEqual(writes(calls), ["claude plugin marketplace update sangsoe", "claude plugin update sangsoe@sangsoe --scope user"]);
});

test("a marketplace named sangsoe pointing elsewhere is replaced", () => {
  const { host, calls } = fakeHost({ state: { markets: [{ name: "sangsoe", source: "directory", path: "/elsewhere" }] } });
  install(host, ROOT);
  assert.deepEqual(writes(calls).slice(0, 2), [
    "claude plugin marketplace remove sangsoe --scope user",
    `claude plugin marketplace add ${ROOT} --scope user`,
  ]);
});

test("a failing claude step stops install with exit 1", () => {
  const { host, calls } = fakeHost({ fail: "claude plugin marketplace add" });
  const r = install(host, ROOT);
  assert.equal(r.code, 1);
  assert.ok(!calls.some((c) => c.startsWith("claude plugin install")));
});

test("with an Orca plugin, install dev-loads it and reads exit 3 as waiting for approval", () => {
  const { host, calls } = fakeHost({ orcaManifest: true, devLoadCode: 3 });
  const r = install(host, ROOT);
  assert.ok(calls.includes(`orca plugin dev load ${join(ROOT, "orca-plugin")} --json`));
  assert.match(r.lines.join("\n"), /approval waits — fingerprint sha256-abc/);
  assert.ok(!calls.some((c) => c.includes("enable")), "install never approves");
});

test("uninstall removes the three registrations and keeps data", () => {
  const { host, calls, state } = fakeHost({ orcaManifest: true });
  install(host, ROOT);
  calls.length = 0;
  const r = uninstall(host, ROOT);
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
  const r = uninstall(host, ROOT);
  assert.equal(r.code, 0);
  assert.deepEqual(writes(calls), []);
});

test("doctor --offline reads only the tree", () => {
  const { host, calls } = fakeHost();
  const r = doctor(host, ROOT, { offline: true });
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.deepEqual(calls, []);
  assert.match(r.lines.join("\n"), /ok +node: 26\.13\.0 \(needs >= 24\.15\)/);
});

test("doctor marks unbuilt parts as not yet and passes when registered", () => {
  const { host } = fakeHost();
  install(host, ROOT);
  const r = doctor(host, ROOT);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.ok(r.lines.some((l) => l.startsWith("not yet  start checks")));
  assert.ok(!r.lines.some((l) => l.startsWith("FAIL")));
});

test("doctor fails with a fix command when nothing is registered", () => {
  const { host } = fakeHost();
  const r = doctor(host, ROOT);
  assert.equal(r.code, 1);
  assert.ok(r.lines.some((l) => /^FAIL +claude plugin: .* — fix: sangsoe install$/.test(l)));
});

test("doctor flags a node below the engines floor", () => {
  const { host } = fakeHost();
  const r = doctor({ ...host, nodeVersion: "24.2.0" }, ROOT, { offline: true });
  assert.equal(r.code, 1);
});

test("an unreadable plugin list stops install before installing anything", () => {
  const { host, calls } = fakeHost({ fail: "claude plugin list" });
  const r = install(host, ROOT);
  assert.equal(r.code, 1);
  assert.ok(!calls.some((c) => c.startsWith("claude plugin install") || c.startsWith("claude plugin update")));
});

test("uninstall fails, not succeeds, when it cannot read what is registered", () => {
  const { host } = fakeHost({ fail: "claude plugin list" });
  const r = uninstall(host, ROOT);
  assert.equal(r.code, 1);
  assert.match(r.lines.join("\n"), /cannot read `plugin list --json`/);
});

test("uninstall unloads a sangsoe dev plugin even when this tree has no Orca manifest", () => {
  const { host, calls } = fakeHost({ state: { orca: true } });
  uninstall(host, ROOT);
  assert.ok(calls.includes("orca plugin dev unload local.sangsoe --json"));
});

test("doctor reports a malformed manifest as FAIL instead of throwing", () => {
  const { host } = fakeHost({ files: { "claude-plugin/.claude-plugin/plugin.json": "{" } });
  const r = doctor(host, ROOT, { offline: true });
  assert.equal(r.code, 1);
  assert.match(r.lines[0] ?? "", /^FAIL +tree: .*plugin\.json is unreadable/);
});

for (const [orcaPlugin, why] of [
  [{ status: "errored", isDev: true }, /is errored/],
  [{ status: "pending", isDev: true }, /waits for approval/],
  [{ status: "running", isDev: false }, /not the Homebrew tree's development load/],
] as const) {
  test(`doctor fails an Orca plugin that is ${orcaPlugin.status}${orcaPlugin.isDev ? "" : ", not dev"}`, () => {
    const { host } = fakeHost({ orcaManifest: true, orcaPlugin });
    install(host, ROOT);
    const r = doctor(host, ROOT);
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
