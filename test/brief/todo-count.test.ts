import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createServer } from "../../claude-plugin/mcp/server.ts";
import { run } from "../../cli/main.ts";
import { type BriefSnapshot, buildBrief, owner_todo, replayJsonl } from "../../core/index.ts";

const FIX = new URL("../fixtures/brief/", import.meta.url);
const NOW = "2026-11-10T12:00:00.000Z";
const files = ["--events", fileURLToPath(new URL("sample.events.jsonl", FIX)), "--orca", fileURLToPath(new URL("sample.orca.json", FIX)), "--now", NOW];
const count = (s: string) => Number(/내가 할 일 (\d+)/.exec(s)?.[1]);

test("PN3: `sangsoe todo`, the brief's top line and owner_todo give one number", async () => {
  const todo = await run(["todo", ...files]);
  const brief = await run(["brief", ...files]);
  assert.equal(todo.code, 0, todo.out);
  assert.equal(brief.code, 0, brief.out);
  const input = {
    events: replayJsonl(readFileSync(new URL("sample.events.jsonl", FIX), "utf8")),
    orca: JSON.parse(readFileSync(new URL("sample.orca.json", FIX), "utf8")) as BriefSnapshot,
    now: NOW,
  };
  const view = owner_todo(input).length;
  assert.equal(count(todo.out.split("\n")[0] ?? ""), view);
  assert.equal(count(brief.out.split("\n")[0] ?? ""), view);
  assert.equal(buildBrief(input).todo.total, view);
  assert.equal(brief.out, readFileSync(new URL("sample.md", FIX), "utf8"), "the CLI prints the golden text unchanged");
});

test("stages 2 and 3 through the CLI; an unknown group is refused", async () => {
  assert.match((await run(["brief", "api-migration", ...files])).out, /^묶음 상세 · api-migration P0/);
  assert.match((await run(["brief", "api-migration", "i031", ...files])).out, /^항목 상세 · i031/);
  const miss = await run(["brief", "nope", ...files]);
  assert.equal(miss.code, 1);
  assert.match(miss.out, /\[not_found\]/);
});

test("the MCP server lists the brief resource", async () => {
  const server = await createServer();
  const res = (await server.handle({ jsonrpc: "2.0", id: 1, method: "resources/list" })) as {
    result: { resources: { uri: string; name: string }[] };
  };
  assert.deepEqual(
    res.result.resources.map((r) => [r.name, r.uri]),
    [
      ["brief", "sangsoe://brief"],
      ["ready", "sangsoe://ready"],
    ],
  );
});
