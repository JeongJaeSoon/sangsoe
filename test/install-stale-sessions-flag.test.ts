import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "../cli/main.ts";
import type { Host } from "../core/index.ts";

// Decision 247: --stale-sessions prints the list and nothing else; it registers nothing and runs no doctor.
function listOnly(ps: string) {
  const calls: string[] = [];
  const host: Host = {
    run: (cmd) => {
      calls.push(cmd);
      return cmd === "ps" ? { code: 0, stdout: ps, stderr: "" } : { code: 0, stdout: "", stderr: "" };
    },
    exists: () => assert.fail("must not read the tree"),
    readText: () => assert.fail("must not read the tree"),
    env: { HOME: "/home/u" },
    nodeVersion: "26.0.0",
  };
  return { host, calls };
}
const noChecks = () => assert.fail("must not build the start-check context");

test("decision 247: install --stale-sessions prints only the list and runs only ps (and lsof when one is stale)", async () => {
  const none = listOnly("");
  assert.deepEqual(await run(["install", "--stale-sessions"], { host: none.host, checkContext: noChecks }), { code: 0, out: "stale sessions: none" });
  assert.deepEqual(none.calls, ["ps"]);

  const gone = "/nowhere/sangsoe-flag-test/claude-plugin/mcp/server.js";
  const one = listOnly(`  7  1-00:00:00 /usr/local/bin/node ${gone}\n`);
  const r = await run(["install", "--stale-sessions"], { host: one.host, checkContext: noChecks });
  assert.equal(r.code, 0);
  const lines = r.out.split("\n");
  assert.equal(lines.length, 3, r.out);
  assert.match(lines[0] ?? "", /^stale sessions: 1 sangsoe MCP server runs/);
  assert.match(lines[1] ?? "", /^ {2}pid 7 /);
  assert.match(lines[2] ?? "", /^restart each with claude --continue in its terminal/);
  assert.deepEqual(one.calls, ["ps", "lsof"]);
});

for (const extra of [["--yes"], ["--permissions"], ["--scope", "user"]]) {
  test(`decision 247: install --stale-sessions ${extra.join(" ")} is refused and touches nothing`, async () => {
    const { host, calls } = listOnly("");
    const r = await run(["install", "--stale-sessions", ...extra], { host, checkContext: noChecks });
    assert.equal(r.code, 1);
    assert.match(r.out, /\[invalid_input\]\nfix: sangsoe install --stale-sessions$/);
    assert.deepEqual(calls, []);
  });
}
