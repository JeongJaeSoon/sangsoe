import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { VERSION } from "../../core/index.ts";
import { staleServer } from "./stale.ts";

/** An install laid out as Homebrew's: <version>/libexec/dist/{package.json,claude-plugin/mcp/server.js}. */
function install(root: string, version: string, name = "sangsoe") {
  const dist = join(root, version, "libexec", "dist");
  mkdirSync(join(dist, "claude-plugin", "mcp"), { recursive: true });
  writeFileSync(join(dist, "package.json"), JSON.stringify({ name, version }));
  writeFileSync(join(dist, "claude-plugin", "mcp", "server.js"), "");
}

test("decision 211: a server whose install was upgraded or removed under it is stale; the same version is not", (t) => {
  const root = mkdtempSync(join(tmpdir(), "sangsoe-stale-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  install(root, "0.1.0");
  install(root, "0.1.3");
  const opt = join(root, "opt");
  symlinkSync(join(root, "0.1.0"), opt);
  // The path the plugin's .mcp.json launches: through the opt link and the plugin's own `..`.
  const entry = join(opt, "libexec", "claude-plugin", "..", "dist", "claude-plugin", "mcp", "server.js");
  assert.equal(staleServer(entry, "0.1.0"), null);

  unlinkSync(opt);
  symlinkSync(join(root, "0.1.3"), opt);
  assert.match(staleServer(entry, "0.1.0") ?? "", /runs sangsoe 0\.1\.0, but sangsoe 0\.1\.3 is installed/);

  unlinkSync(opt);
  assert.match(staleServer(entry, "0.1.0") ?? "", /the install it started from is gone/);

  install(root, "9.9.9", "other");
  symlinkSync(join(root, "9.9.9"), opt);
  assert.match(staleServer(entry, "9.9.9") ?? "", /gone/, "another package's package.json is not sangsoe's install");
});

test("decision 211: a running server refuses start_unit once the install under it moves, before the store or Orca", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "sangsoe-stale-run-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = fileURLToPath(new URL("../..", import.meta.url));
  for (const [dir, version] of [["a", VERSION], ["b", `${VERSION}-next`]] as const) {
    mkdirSync(join(root, dir));
    writeFileSync(join(root, dir, "package.json"), JSON.stringify({ name: "sangsoe", version }));
    symlinkSync(join(repo, "claude-plugin"), join(root, dir, "claude-plugin"));
  }
  const opt = join(root, "opt");
  symlinkSync(join(root, "a"), opt);
  // HOME here: past the check the handler opens the default store under it.
  const env = { ...process.env, HOME: root };
  const server = spawn(process.execPath, [join(opt, "claude-plugin", "mcp", "server.ts")], { stdio: ["pipe", "pipe", "inherit"], env });
  t.after(() => server.kill());
  const lines = createInterface({ input: server.stdout })[Symbol.asyncIterator]();
  const call = async (id: number, method: string, params: object) => {
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    const line = await lines.next();
    assert.ok(!line.done, "the server answered");
    return JSON.parse(line.value);
  };
  await call(1, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  // No task or spec: past the stale check, handle refuses before it opens the store or calls Orca.
  const args = { name: "start_unit", arguments: { role: "orchestrator", runId: "run_x", childRole: "worker" } };
  assert.equal(JSON.parse((await call(2, "tools/call", args)).result.content[0].text).code, "invalid_input");

  unlinkSync(opt);
  symlinkSync(join(root, "b"), opt);
  const refusal = JSON.parse((await call(3, "tools/call", args)).result.content[0].text);
  assert.equal(refusal.code, "server_stale");
  assert.match(refusal.reason, new RegExp(`runs sangsoe ${VERSION}, but sangsoe ${VERSION}-next is installed`));
});

test("decision 211: outside the server entry (tests, the CLI) there is no install to compare", () => {
  assert.equal(staleServer("/somewhere/cli/sangsoe.js", "0.0.0"), null);
  assert.equal(staleServer(undefined, "0.0.0"), null);
  assert.equal(staleServer(), null, "this test process");
});
