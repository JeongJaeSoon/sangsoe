// Decision 324: a secretary subagent the orchestrator and a lead hand non-coordination work to by default.
// Text tests: each sentence fails on a tree without it.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "");
const has = (text: string, wants: string[], where: string) => {
  for (const want of wants) assert.ok(text.includes(want), `${where} lacks: ${want}`);
};

const SECRETARY = "claude-plugin/agents/secretary.md";
const secretary = read(SECRETARY);
const head = /^---\n([\s\S]*?)\n---\n/.exec(secretary)?.[1] ?? "";
const body = secretary.slice(head.length);

test("324-1: the secretary is a plugin agent that only a principal spawns, and its principal's records stay out of its tools", () => {
  assert.match(head, /^name: secretary$/m);
  assert.match(head, /^description: .*subagent/m);
  for (const tool of ["decision_answer", "decision_open", "start_unit", "land", "review_record", "evidence_record", "stage_record", "unit_close", "item_create"]) {
    assert.match(head, new RegExp(`^disallowedTools: .*mcp__plugin_sangsoe_sangsoe__${tool}\\b`, "m"), `disallowedTools lacks ${tool}`);
  }
});

test("324-2: the secretary's work, what it leaves to its principal, its authority and its report shape", () => {
  has(body, ["읽기·조사·요약", "증거 대조", "리뷰 의뢰", "주인의 단위", "Orca 메시지"], "맡는 일");
  has(body, ["decision_answer", "start_unit", "`land`", "prod", "초안과 dry run", "review_record", "evidence_record", "주인의 증명"], "하지 않는 일");
  has(
    body,
    ["주인의 권한 안에서만", "전해 들은 말", "권한 프롬프트", "주인에게 돌아간다", "원문 그대로", "다른 길", "일 하나에 비서 하나", "id", "되돌릴 수"],
    "권한",
  );
  has(body, ["OK", "MISMATCH", "증거", "남은 것", "언어", "길이"], "보고 꼴");
  has(body, ["읽는 길이 없으면", "작업 폴더 밖"], "길이 없을 때");
  // Every rule from the dogfooding notes carries the observation it came from.
  assert.ok((body.match(/근거:/g) ?? []).length >= 8, "fewer than eight rules carry a 근거 line");
});

const orchestrator = read("claude-plugin/agents/orchestrator.md");
const lead = read("claude-plugin/agents/lead.md");
const orchestrate = read("claude-plugin/skills/orchestrate/SKILL.md");
const intake = read("claude-plugin/skills/intake/SKILL.md");

test("324-3: the orchestrator and a lead keep coordination in their own turn and hand the rest to a secretary by default", () => {
  for (const [where, text] of Object.entries({ orchestrator, lead, orchestrate })) {
    has(text, ["`sangsoe:secretary`", "(결정 324)"], where);
  }
  has(orchestrate, ["한 메시지에", "subagents.collect", "subagents.judge", "확인할 값", "OK/MISMATCH", "다섯 줄", "거부 문단", "`[gate:delegate]`"], "orchestrate 비서");
  assert.ok(!orchestrate.includes("지시문 두 줄"), "orchestrate still names two lines where write-brief has five");
  has(intake, ["`sangsoe:secretary`"], "intake 읽기·조사");
  assert.ok(!intake.includes("바로 답과 읽기·조사 말고는 모두 다른 세션의 일이다"), "intake still keeps 읽기·조사 as the orchestrator's own work");
  has(orchestrator, ["비서나 워커"], "orchestrator.md 직접 하지 않는 것");
  // Orca's preamble tells a dispatched lead "no subagents ... unless the task asks"; the role asks.
  has(lead, ["unless the task asks", "도우미 워커"], "lead.md 비서");
});

test("324-4: a secretary is no way around a refusal", () => {
  has(orchestrate, ["거부를 돌아가는 길이 아니다"], "orchestrate");
  has(body, ["거부를 돌아가는 길이 아니다"], "secretary");
});

test("324-5: the delegate gate's refusal names the secretary", () => {
  has(read("core/gates/delegate.ts"), ["sangsoe:secretary"], "delegate gate");
});

test("324-6: the agents folder label names the secretary", () => {
  has(read("claude-plugin/agents/.layout"), ["secretary"], ".layout");
  has(read("claude-plugin/README.md"), ["비서"], "claude-plugin/README.md agents row");
});
