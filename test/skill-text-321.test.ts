// Decision 321: the orchestrator re-arms its wait before every turn end, and a cut-off MCP call is read as a cut, not a refusal.
// Text tests: each sentence fails on a tree without it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const has = (text: string, wants: string[], where: string) => {
  for (const want of wants) assert.ok(text.includes(want), `${where} lacks: ${want}`);
};

const orchestrate = read("claude-plugin/skills/orchestrate/SKILL.md");
const orchestrator = read("claude-plugin/agents/orchestrator.md");
const start = read("claude-plugin/skills/start/SKILL.md");

const ALWAYS = "깨움을 처리한 뒤 턴을 끝내기 전에 늘";
const ONE = "앞 대기가 아직 돌고 있으면 새로 걸지 않는다";

test("321-1: the orchestrator re-arms the wait by default before ending a turn, and never stacks a second one", () => {
  has(orchestrate, [ALWAYS, "앞 대기가 끝났으면", ONE, "도는 대기가 있으면 Orca 는 터미널에 `You have N orchestration message` 줄을 넣지 않고", "(결정 321)"], "orchestrate 깨움 처리");
  has(orchestrator, [ALWAYS, "앞 대기가 끝났으면", ONE, "tool 호출", "(결정 321)"], "orchestrator.md 깨어날 때마다");
  assert.ok(!orchestrate.includes("오케스트레이터는 대기를 걸 때 이것을 건다"), "orchestrate still says the orchestrator waits only when it chooses to");
  assert.ok(!orchestrator.includes("대기를 걸어 둔다면"), "orchestrator.md still makes the wait optional");
});

test("321-2: a tool call that comes back as a refusal nobody gave is a cut, and start_unit retries the same Task", () => {
  for (const [where, text] of Object.entries({ "orchestrate": orchestrate, "start": start })) {
    has(text, ["사람이 거부하지 않았", "interrupt", "끊김으로 읽는다", "Task id 를 알", "`task` 로 다시 부른다", "같은 spec 을 다시 보내지 않는다", "모르면 같은 spec·title 로 한 번 다시 부른다", "\"채택:\""], `${where} 결과 표`);
  }
});
