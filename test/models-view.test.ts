// Decision 200: the catalog view, docs/models.md and the advisor spend all read core/models/table.ts.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { run } from "../cli/main.ts";
import {
  advisorCallCost,
  advisorCalls,
  advisorSpend,
  advisorSpendText,
  dedupeKey,
  EVENTS,
  localDay,
  MODEL_CATALOG,
  MODEL_KINDS,
  MODEL_POLICY,
  MODEL_SOURCES,
  modelsMarkdown,
  modelsView,
  recordHook,
  Store,
} from "../core/index.ts";

const ROOT = new URL("..", import.meta.url).pathname;

test("docs/models.md is the table's own Markdown: regenerate it with `sangsoe models --markdown` when this fails", () => {
  assert.equal(readFileSync(join(ROOT, "docs/models.md"), "utf8"), modelsMarkdown());
});

test("sangsoe models shows every catalog row, every case with its why and source, the pins and the age", async () => {
  const out = modelsView({ now: new Date(`${MODEL_CATALOG[0]?.verified}T12:00:00Z`), pins: ["ANTHROPIC_DEFAULT_OPUS_MODEL=x"] });
  for (const c of MODEL_CATALOG) {
    assert.ok(out.includes(c.currentId), c.tier);
    assert.ok(out.includes(`$${c.price.input} / $${c.price.output}`), `${c.tier} price`);
    assert.ok(out.includes(c.verified), `${c.tier} verified`);
  }
  for (const k of MODEL_KINDS) {
    const r = MODEL_POLICY[k];
    assert.ok(out.includes(r.label) && out.includes(r.why) && out.includes(MODEL_SOURCES[r.cite]), k);
  }
  assert.match(out, /지금 걸린 고정 1개: ANTHROPIC_DEFAULT_OPUS_MODEL=x/);
  assert.match(out, /확인한 지 0일/);
  const old = modelsView({ now: new Date("2099-01-01T00:00:00Z"), pins: [] });
  assert.match(old, /⚠ 확인한 지 \d+일 지났다/);
  assert.match(old, /지금 걸린 고정: 없음/);
  // The CLI prints the same Markdown the docs file holds.
  const md = await run(["models", "--markdown"]);
  assert.deepEqual(md, { code: 0, out: modelsMarkdown() });
  assert.match((await run(["models"])).out, /^모델 카탈로그/);
});

// A transcript in Claude Code 2.1.322's shape: the assistant record repeats once per content block, and
// the advisor call is a usage.iterations entry of type advisor_message carrying its model and tokens.
const advisorModel = MODEL_CATALOG.find((c) => c.tier === "primary")?.currentId ?? "";
const usage = { iterations: [{ type: "message", input_tokens: 2 }, { type: "advisor_message", model: advisorModel, input_tokens: 29631, output_tokens: 282 }] };
const records = [
  { type: "assistant", message: { id: "msg_a", content: [{ type: "server_tool_use", name: "advisor" }], usage } },
  { type: "assistant", message: { id: "msg_a", content: [{ type: "advisor_tool_result" }], usage } },
  { type: "assistant", message: { id: "msg_a", content: [{ type: "text" }], usage } },
  { type: "assistant", message: { id: "msg_b", usage: { iterations: [{ type: "message", input_tokens: 5 }] } } },
  { type: "user", message: { content: "advisor_message" } },
];

test("advisorCalls counts each advisor iteration once, and its cost is the catalog's list price", () => {
  const calls = advisorCalls(records);
  assert.deepEqual(calls, [{ key: "msg_a:1", model: advisorModel, input: 29631, output: 282 }]);
  const price = MODEL_CATALOG.find((c) => c.currentId === advisorModel)?.price;
  assert.ok(price);
  const usd = advisorCallCost(calls[0] ?? { model: "", input: 0, output: 0 });
  assert.equal(usd, (29631 * price.input + 282 * price.output) / 1_000_000);
  assert.equal(advisorCallCost({ model: "unknown-model", input: 1, output: 1 }), undefined);
});

test("the Stop hook records each advisor call once per session, and spend sums by unit and by day", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sangsoe-spend-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const transcript = join(dir, "t.jsonl");
  writeFileSync(transcript, `${records.map((r) => JSON.stringify(r)).join("\n")}\n`);
  const store = Store.open({ path: ":memory:" });
  store.append({
    type: "session_started",
    source: "SessionStart",
    entity: "task",
    entity_id: "task_1",
    dedupe_key: dedupeKey(EVENTS.session_started, "sess-1", "startup"),
    payload: { session: "sess-1", role: "worker", model: "m" },
  });
  const deps = { store, orca: { dispatchShow: async () => ({ ok: false, error: { code: "x", message: "x" } }) } } as never;
  await recordHook("stop", deps, { session_id: "sess-1", transcript_path: transcript } as never);
  await recordHook("stop", deps, { session_id: "sess-1", transcript_path: transcript } as never);
  const used = store.events({ type: "advisor_used" });
  assert.equal(used.length, 1, "the tail overlaps between turns; the call's key keeps it one row");
  assert.equal(used[0]?.entity_id, "task_1");
  const today = localDay(new Date(used[0]?.ts ?? ""));
  const s = advisorSpend(used, { task: "task_1", day: today });
  assert.equal(s.calls, 1);
  assert.equal(advisorSpend(used, { task: "task_2" }).calls, 0);
  assert.equal(advisorSpend(used, { day: "1999-01-01" }).calls, 0);
  assert.match(advisorSpendText(s), /^advisor 1회 · 약 \$0\.\d\d$/);
});
