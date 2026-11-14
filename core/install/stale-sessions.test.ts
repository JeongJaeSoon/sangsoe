import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Host, RunResult } from "./host.ts";
import { installedTree, type InstalledTree, staleSessions } from "./stale-sessions.ts";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const OPT = "/opt/homebrew/opt/sangsoe/libexec/claude-plugin/../dist/claude-plugin/mcp/server.js";
const RC = "/opt/homebrew/opt/sangsoe-rc/libexec/claude-plugin/../dist/claude-plugin/mcp/server.js";
const NODE = "/usr/local/bin/node";

/** A host whose process table is `ps` and whose working directories are `cwd`; it records every call. */
function processHost(ps: string, cwd: Record<number, string> = {}, psCode = 0) {
  const calls: string[] = [];
  const host: Host = {
    env: { HOME: "/home/u" },
    nodeVersion: "26.13.0",
    exists: () => false,
    readText: () => "",
    run(cmd, args, env): RunResult {
      calls.push([cmd, ...args].join(" ") + (env?.LC_ALL ? ` (LC_ALL=${env.LC_ALL})` : ""));
      if (cmd === "ps") return { code: psCode, stdout: psCode === 0 ? ps : "", stderr: psCode === 0 ? "" : "ps: denied" };
      if (cmd === "lsof") {
        const out = Object.entries(cwd).map(([pid, dir]) => `p${pid}\nfcwd\nn${dir}\n`);
        return { code: 0, stdout: out.join(""), stderr: "" };
      }
      return { code: 127, stdout: "", stderr: "unexpected" };
    },
  };
  return { host, calls };
}

// Installed now: 0.1.5 at the stable path since 1h ago, 0.1.6-rc.1 at the rc path since 10 minutes ago.
const trees: Record<string, InstalledTree> = {
  [OPT]: { version: "0.1.5", at: NOW - 3_600_000 },
  [RC]: { version: "0.1.6-rc.1", at: NOW - 600_000 },
};
const installed = (entry: string) => trees[entry] ?? null;

test("decision 247: two servers started before their install are two rows and one restart line", () => {
  const ps = [
    // Started 2 days ago under the stable path: older than that install.
    `  101  2-00:00:00 ${NODE} ${OPT}`,
    // Started 30 minutes ago under the rc path: older than the rc install.
    `  102     30:00 ${NODE} ${RC}`,
    // Started 5 minutes ago under the rc path: runs what is installed.
    `  103     05:00 ${NODE} ${RC}`,
    // Not a sangsoe server.
    `  104  1-00:00:00 ${NODE} /somewhere/else/server.js`,
    `  105     01:00:00 /bin/zsh -l`,
    // An editor open on a checkout's server.ts: its install would read as gone, but it is no server.
    `  106     10:00 /usr/bin/vim /home/u/src/sangsoe/claude-plugin/mcp/server.ts`,
  ].join("\n");
  const { host, calls } = processHost(ps, { 101: "/home/u/work/acme-api", 102: "/home/u/work/acme-web" });
  const lines = staleSessions(host, { installed, now: () => NOW });
  assert.deepEqual(lines, [
    "stale sessions: 2 sangsoe MCP servers run code older than what is installed now",
    "  pid 101  ~/work/acme-api  runs an install older than sangsoe 0.1.5  installed 0.1.5",
    "  pid 102  ~/work/acme-web  runs an install older than sangsoe 0.1.6-rc.1  installed 0.1.6-rc.1",
    "restart each with claude --continue in its terminal (quit the session, then start it again in the same directory with the flags it was started with, such as --agent); /reload-plugins does not restart the server",
  ]);
  // Read-only: the process table and the two stale servers' working directories, nothing else.
  assert.deepEqual(calls, ["ps -axo pid=,etime=,args= (LC_ALL=C)", "lsof -a -d cwd -Fpn -p 101,102"]);
});

test("decision 247: no server older than its install is one line, and no cwd read", () => {
  const { host, calls } = processHost(`  103     05:00 ${NODE} ${RC}\n`);
  assert.deepEqual(staleSessions(host, { installed, now: () => NOW }), ["stale sessions: none"]);
  assert.deepEqual(calls, ["ps -axo pid=,etime=,args= (LC_ALL=C)"]);
  assert.deepEqual(staleSessions(processHost("").host, { installed, now: () => NOW }), ["stale sessions: none"]);
});

test("decision 247: a server whose install is gone is stale with no installed version", () => {
  const gone = "/old/tree/claude-plugin/mcp/server.js";
  const { host } = processHost(`  201     10:00 ${NODE} ${gone}\n`, { 201: "/home/u/w" });
  const lines = staleSessions(host, { installed, now: () => NOW });
  assert.equal(lines[1], "  pid 201  ~/w  runs an install that is gone  installed none");
});

test("decision 247: a process table that cannot be read is one line, not an error; a cwd that cannot be read is named", () => {
  assert.deepEqual(staleSessions(processHost("", {}, 1).host, { installed, now: () => NOW }), [
    "stale sessions: cannot read `ps -axo pid=,etime=,args=`, so running sessions were not checked",
  ]);
  const { host } = processHost(`  101  2-00:00:00 ${NODE} ${OPT}\n`);
  assert.equal(staleSessions(host, { installed, now: () => NOW })[1], "  pid 101  (working directory unreadable)  runs an install older than sangsoe 0.1.5  installed 0.1.5");
});

test("decision 247: installedTree reads the version and change time of the package.json the entry resolves to now", (t) => {
  const root = mkdtempSync(join(tmpdir(), "sangsoe-stale-sessions-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [dir, name, version] of [["a", "sangsoe", "0.1.5"], ["b", "other", "9.9.9"]] as const) {
    mkdirSync(join(root, dir, "dist", "claude-plugin", "mcp"), { recursive: true });
    writeFileSync(join(root, dir, "dist", "package.json"), JSON.stringify({ name, version }));
  }
  const opt = join(root, "opt");
  symlinkSync(join(root, "a"), opt);
  const entry = join(opt, "dist", "claude-plugin", "mcp", "server.js");
  const tree = installedTree(entry);
  assert.equal(tree?.version, "0.1.5");
  assert.ok(tree && Math.abs(tree.at - Date.now()) < 60_000, "the change time of a file written just now");

  unlinkSync(opt);
  symlinkSync(join(root, "b"), opt);
  assert.equal(installedTree(entry), null, "another package's package.json is not sangsoe's install");
  unlinkSync(opt);
  assert.equal(installedTree(entry), null, "a removed install");
});
