import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { readyText } from "../../claude-plugin/mcp/resources/ready.ts";
import { timelineText } from "../../claude-plugin/mcp/resources/item_timeline.ts";
import { createServer } from "../../claude-plugin/mcp/server.ts";
import { type BriefSnapshot, item_timeline, ready, replayJsonl } from "../../core/index.ts";

// Decision 162: the judgment layer's `ready` and `item_timeline` are resources over the core views,
// with nothing stored; a view that takes an item is a resource template.
const FIX = new URL("../fixtures/brief/", import.meta.url);
const events = replayJsonl(readFileSync(new URL("sample.events.jsonl", FIX), "utf8"));
const orca = JSON.parse(readFileSync(new URL("sample.orca.json", FIX), "utf8")) as BriefSnapshot;
const input = { events, orca, now: "2026-11-10T12:00:00.000Z" };

const call = async (method: string, params: Record<string, unknown> = {}) => {
  const server = await createServer({ resources: new URL("./fixtures/", import.meta.url) });
  return server.handle({ jsonrpc: "2.0", id: 1, method, params });
};

test("ready starts with the core ready() rows and explains each waiting item", () => {
  const text = readyText(input);
  const head = text.split("\n\n")[0]?.split("\n") ?? [];
  assert.deepEqual(
    head,
    ready(input).map((r) => `🟢 ${r.alias ?? r.task}  ${r.task}`),
  );
  assert.match(text, /i029: 📅 예정\n\| 항목 \| 막는 선행 \|[^\n]*\n[^\n]*\n\| i029 \| item:task_33 \| blocks \|/);
});

test("item_timeline returns the core view's rows for an alias or a Task id", () => {
  const byAlias = JSON.parse(timelineText(events, "i021"));
  const byId = JSON.parse(timelineText(events, "task_21"));
  assert.deepEqual(byAlias, byId);
  assert.equal(byAlias.task, "task_21");
  assert.deepEqual(byAlias.rows, JSON.parse(JSON.stringify(item_timeline(input, "task_21"))));
  assert.ok(byAlias.rows.some((r: { type: string }) => r.type === "owner_class"));
});

test("the server lists templates apart from fixed resources and reads a template by its uri", async () => {
  const list = (await call("resources/list")) as { result: { resources: unknown[] } };
  assert.deepEqual(list.result.resources, []);
  const templates = (await call("resources/templates/list")) as { result: { resourceTemplates: { uriTemplate: string }[] } };
  assert.deepEqual(templates.result.resourceTemplates.map((t) => t.uriTemplate), ["test://item/{task}/timeline"]);
  const read = (await call("resources/read", { uri: "test://item/i%20021/timeline" })) as { result: { contents: { uri: string; text: string }[] } };
  assert.deepEqual(read.result.contents.map((c) => [c.uri, JSON.parse(c.text)]), [["test://item/i%20021/timeline", { task: "i 021" }]]);
  for (const uri of ["test://item/a/b/timeline", "test://item//timeline", "test://item/i021/timelines", "test://item/%E0%A4/timeline"]) {
    const miss = (await call("resources/read", { uri })) as { error: { code: number } };
    assert.equal(miss.error.code, -32002, uri);
  }
});

test("the real server lists brief and ready, and item_timeline as a template", async () => {
  const server = await createServer();
  const list = (await server.handle({ jsonrpc: "2.0", id: 1, method: "resources/list" })) as { result: { resources: { uri: string }[] } };
  assert.deepEqual(list.result.resources.map((r) => r.uri), ["sangsoe://brief", "sangsoe://ready"]);
  const templates = (await server.handle({ jsonrpc: "2.0", id: 2, method: "resources/templates/list" })) as {
    result: { resourceTemplates: { name: string; uriTemplate: string }[] };
  };
  assert.deepEqual(templates.result.resourceTemplates.map((t) => [t.name, t.uriTemplate]), [["item_timeline", "sangsoe://item/{task}/timeline"]]);
});
