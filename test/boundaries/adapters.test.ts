import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { collect } from "../../claude-plugin/mcp/collect.ts";
import type * as Mcp from "../../claude-plugin/mcp/contract.ts";
import { createServer } from "../../claude-plugin/mcp/server.ts";
import type * as Cli from "../../cli/contract.ts";
import { collectCommands, run } from "../../cli/main.ts";
import { VERSION } from "../../core/index.ts";
import { expectSameViaBothEntrances, viaCli, viaMcp } from "./both-entrances.ts";
import { writes } from "./fixtures/greet.ts";

const fixtures = new URL("./fixtures/", import.meta.url);
const dirs = { tools: new URL("tools/", fixtures), commands: new URL("commands/", fixtures) };
const call = (name: string, args: Record<string, unknown>) =>
  ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) as const;

// Compile-time: the two slots' Refusal/Outcome must stay assignable both ways.
const _refusal: [Mcp.Refusal, Cli.Refusal] = [{} as Cli.Refusal, {} as Mcp.Refusal];
const _outcome: [Mcp.Outcome, Cli.Outcome] = [{} as Cli.Outcome, {} as Mcp.Outcome];
void _refusal;
void _outcome;

test("(1) an empty tool and an empty command are collected and run", async () => {
  const server = await createServer({ tools: dirs.tools });
  assert.deepEqual([...server.tools.keys()], ["empty", "greet", "throws"]);
  assert.deepEqual(await viaMcp("empty", {}, dirs), { ok: true, value: null });
  assert.deepEqual([...(await collectCommands(dirs.commands)).keys()], ["empty", "greet"]);
  assert.deepEqual(await run(["empty"], { commands: dirs.commands }), { code: 0, out: "null" });
});

test("(1) the shipped folders collect: the shipped tools, the version command", async () => {
  assert.deepEqual(
    [...(await createServer()).tools.keys()],
    [
      "decision_answer",
      "decision_open",
      "edge_add",
      "edge_remove",
      "flow_expand",
      "handoff_save",
      "item_create",
      "land",
      "resource_record",
      "review_ask_record",
      "start_unit",
    ],
  );
  assert.deepEqual(await run(["--version"]), { code: 0, out: `sangsoe ${VERSION}` });
});

test("(1) a file whose export names another item is rejected", async () => {
  await assert.rejects(collect(new URL("misnamed/", fixtures)), /default export must have name "wrong"/);
  await assert.rejects(collectCommands(new URL("misnamed/", fixtures)), /default export must have name "wrong"/);
});

test("(2) a refusal carries code, reason and fix through both entrances", async () => {
  const o = await expectSameViaBothEntrances({ tool: "greet", input: { refuse: true }, argv: ["greet", "--refuse"], dirs });
  assert.deepEqual(o, {
    ok: false,
    refusal: { code: "greet_refused", reason: "the caller asked for a refusal", fix: "call greet without refuse" },
  });
  const server = await createServer({ tools: dirs.tools });
  const res = await server.handle(call("greet", { refuse: true }));
  assert.equal((res as { result: { isError: boolean } }).result.isError, true);
  const human = await run(["greet", "--refuse"], { commands: dirs.commands });
  assert.equal(human.code, 1);
  assert.equal(human.out, "sangsoe greet: the caller asked for a refusal [greet_refused]\nfix: call greet without refuse");
});

test("(3) expectSameViaBothEntrances: one core function, same value", async () => {
  const o = await expectSameViaBothEntrances({ tool: "greet", input: { who: "acme" }, argv: ["greet", "--who", "acme"], dirs });
  assert.deepEqual(o, { ok: true, value: { greeting: "hello acme", version: VERSION } });
});

test("(3) expectSameViaBothEntrances fails when the entrances disagree", async () => {
  await assert.rejects(
    expectSameViaBothEntrances({ tool: "greet", input: { who: "acme" }, argv: ["greet", "--who", "other"], dirs }),
    assert.AssertionError,
  );
});

test("(4) unknown commands, arguments and tools write nothing and show the right form", async () => {
  const before = writes.length;
  const c = { commands: dirs.commands };

  const bogus = await run(["bogus-subcommand"], c);
  assert.equal(bogus.code, 2);
  assert.match(bogus.out, /^usage: sangsoe <command>/);

  const flag = await run(["greet", "--nope"], c);
  assert.equal(flag.code, 2);
  assert.match(flag.out, /^usage: sangsoe greet \[--who NAME\] \[--refuse\]\n.*--nope/);

  assert.equal((await run(["greet", "extra"], c)).code, 2);
  assert.deepEqual(await run(["greet", "--help"], c), {
    code: 0,
    out: "usage: sangsoe greet [--who NAME] [--refuse]\ngreet someone, or refuse when asked",
  });
  assert.equal((await run(["--help"], c)).code, 0);
  assert.equal((await run([], c)).code, 2);
  const asJson = await viaCli(["greet", "--nope"], dirs);
  assert.equal(!asJson.ok && asJson.refusal.code, "invalid_input");
  assert.equal(!asJson.ok && asJson.refusal.fix, "usage: sangsoe greet [--who NAME] [--refuse]");

  const server = await createServer({ tools: dirs.tools });
  const unknownTool = await server.handle(call("bogus", {}));
  assert.deepEqual((unknownTool as { error: unknown }).error, { code: -32602, message: "Unknown tool: bogus" });
  const extra = await viaMcp("greet", { nope: 1 }, dirs);
  assert.equal(extra.ok, false);
  assert.equal(!extra.ok && extra.refusal.code, "invalid_input");
  assert.match(!extra.ok ? extra.refusal.fix : "", /"who","refuse"/);
  const wrongType = await viaMcp("greet", { who: 3 }, dirs);
  assert.equal(!wrongType.ok && wrongType.refusal.reason, 'argument "who" must be string');
  const arrayArgs = await server.handle({ ...call("greet", {}), params: { name: "greet", arguments: [] } });
  assert.equal((arrayArgs as { result: { isError: boolean } }).result.isError, true);
  for (const bad of [null, [], { jsonrpc: "1.0", id: 1, method: "ping" }, { jsonrpc: "2.0", id: 1 }, { jsonrpc: "2.0", id: {}, method: "ping" }]) {
    assert.deepEqual(await server.handle(bad), { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
  }
  assert.equal((await server.handle({ jsonrpc: "2.0", id: 1, method: "toString" }) as { error: { code: number } }).error.code, -32601);

  assert.equal(writes.length, before, "an entrance reached the core on a bad call");
});

test("(5) tools/README.md lists the eleven tools of design #mcp (decision 160) and the MCP-only rule", () => {
  const readme = readFileSync(new URL("../../claude-plugin/mcp/tools/README.md", import.meta.url), "utf8");
  const rows = [...readme.matchAll(/^\| `([a-z_]+)` \| ([^|]+) \| `\{[^`]*\}` \| (U\d+|미정) \|$/gm)].map((m) => m[1]);
  assert.deepEqual(rows, [
    "item_create",
    "start_unit",
    "edge_add",
    "edge_remove",
    "flow_expand",
    "decision_open",
    "decision_answer",
    "land",
    "handoff_save",
    "review_ask_record",
    "resource_record",
  ]);
  assert.match(readme, /에이전트는 sangsoe 를 MCP 로만 부른다/);
});

test("initialize keeps a served protocol version and answers any other with the newest served", async () => {
  const server = await createServer({ tools: dirs.tools });
  const init = async (protocolVersion: string) =>
    ((await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion, capabilities: {}, clientInfo: { name: "t", version: "0" } } })) as {
      result: { protocolVersion: string };
    }).result.protocolVersion;
  assert.equal(await init("2025-06-18"), "2025-06-18");
  assert.equal(await init("2026-07-28"), "2025-11-25");
  assert.equal(await init("1999-01-01"), "2025-11-25");
});

test("malformed params are -32602 and a non-Error throw is -32603 with a message", async () => {
  const server = await createServer({ tools: dirs.tools });
  const error = async (method: string, params: Record<string, unknown>) =>
    ((await server.handle({ jsonrpc: "2.0", id: 1, method, params })) as { error: { code: number; message: string } }).error;
  assert.equal((await error("initialize", {})).code, -32602);
  const empty = { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: {} };
  assert.equal((await error("initialize", empty)).code, -32602);
  assert.deepEqual(await error("tools/call", { name: "throws", arguments: { bare: true } }), {
    code: -32603,
    message: "internal error",
  });
  assert.equal((await error("resources/read", { uri: 123 })).code, -32602);
  assert.equal((await error("tools/call", { name: 5 })).code, -32602);
  assert.deepEqual(await error("tools/call", { name: "throws", arguments: {} }), { code: -32603, message: "null" });
});

test("the server answers initialize and tools/list over stdio", async () => {
  const server = fileURLToPath(new URL("../../claude-plugin/mcp/server.ts", import.meta.url));
  const child = spawn(process.execPath, [server], { stdio: ["pipe", "pipe", "inherit"] });
  const lines: unknown[] = [];
  let buf = "";
  const done = new Promise<void>((resolve) => {
    child.stdout.on("data", (d: Buffer) => {
      buf += d;
      for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
        lines.push(JSON.parse(buf.slice(0, i)));
        buf = buf.slice(i + 1);
      }
      if (lines.length === 2) resolve();
    });
  });
  const send = (m: object) => child.stdin.write(`${JSON.stringify(m)}\n`);
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  await done;
  child.stdin.end();
  assert.deepEqual(lines[0], {
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: "sangsoe", version: VERSION },
    },
  });
  const listed = lines[1] as { id: number; result: { tools: { name: string }[] } };
  assert.equal(listed.id, 2);
  assert.deepEqual(
    listed.result.tools.map((t) => t.name),
    [
      "decision_answer",
      "decision_open",
      "edge_add",
      "edge_remove",
      "flow_expand",
      "handoff_save",
      "item_create",
      "land",
      "resource_record",
      "review_ask_record",
      "start_unit",
    ],
  );
});
