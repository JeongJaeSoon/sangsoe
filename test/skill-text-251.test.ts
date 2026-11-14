// Decision 251: a brief names sangsoe's own tools for lineage, review and landing, and the three
// v0.1.5 retro lessons sit in the skills that write briefs, wake on messages and run reviews.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const skill = (name: string) => readFileSync(join(ROOT, `claude-plugin/skills/${name}/SKILL.md`), "utf8");

/** The body of the `## <heading>` section, up to the next `## `. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}\n`);
  assert.ok(start >= 0, `no section "## ${heading}"`);
  const end = text.indexOf("\n## ", start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}

/** The table row whose first cell is `cell`. */
function row(text: string, cell: string): string {
  const line = text.split("\n").find((l) => l.startsWith(`| ${cell} |`));
  assert.ok(line, `no table row "${cell}"`);
  return line;
}

const WAIT_IS_QUESTION = "답을 기다릴 메시지는 question 이다";
const STATUS_ONLY = "답을 기다리지 않는 보고만 status 다";
const READ_SAVED = "하네스가 저장한 파일(tool-results, 백그라운드 task 출력)은 Read tool 로만 읽는다";
const NO_SECRET_LINES = "꼴의 줄로 쓰지 않는다";

test("write-brief's 계보 field opens sessions with start_unit", () => {
  assert.match(row(skill("write-brief"), "계보"), /`start_unit`/);
});

test("write-brief's 머지 field names review_record, land, merge_ready and the READY-WAIT line", () => {
  const land = row(skill("write-brief"), "머지");
  for (const want of ["`review_record`", "`land`", "`merge_ready`", "`READY-WAIT: <kind>`"]) {
    assert.ok(land.includes(want), `머지 row lacks ${want}`);
  }
});

test("write-brief's 검증 field has the lead record evidence with evidence_record", () => {
  assert.match(row(skill("write-brief"), "검증"), /`evidence_record`/);
});

for (const [name, where] of [
  ["orchestrate", () => section(skill("orchestrate"), "결정과 오너")],
  ["write-brief", () => row(skill("write-brief"), "보고")],
] as const) {
  test(`sangsoe-1 (${name}): a message you will wait on goes as a question`, () => {
    const text = where();
    assert.ok(text.includes(WAIT_IS_QUESTION), `lacks: ${WAIT_IS_QUESTION}`);
    assert.ok(text.includes(STATUS_ONLY), `lacks: ${STATUS_ONLY}`);
  });
}

test("sangsoe-1 (deliver-ticket): the request to record a verdict goes by ask", () => {
  assert.match(section(skill("deliver-ticket"), "3. 독립 리뷰"), /리드에게 `ask` 로 보낸다/);
});

for (const [name, where] of [
  ["write-brief", () => section(skill("write-brief"), "서브에이전트 지시문")],
  ["deliver-ticket", () => section(skill("deliver-ticket"), "3. 독립 리뷰")],
] as const) {
  test(`sangsoe-4 and sangsoe-5 (${name}): subagent prompts say Read for harness files and no secret-shaped lines`, () => {
    const text = where();
    assert.ok(text.includes(READ_SAVED), `lacks: ${READ_SAVED}`);
    assert.ok(text.includes(NO_SECRET_LINES) && text.includes("`KEY=value`"), "lacks the secret-shaped line rule");
  });
}

test("orchestrate's judge subagent line points at write-brief's subagent prompt rules", () => {
  const line = skill("orchestrate").split("\n").find((l) => l.includes("subagents.judge"));
  assert.ok(line?.includes("서브에이전트 지시문"), "the subagents.judge line does not point at the subagent prompt rules");
});
