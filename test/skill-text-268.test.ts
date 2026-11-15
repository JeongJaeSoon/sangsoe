// R-20 (decision 268): the brief rules that keep a unit off someone else's stack until a read-only
// precheck passed, and that name a repository's required checks as a command. The rule the precheck
// rests on (a `blocks` predecessor keeps the send item out of ready) is GRAPH's and is tested there
// (`precheck_blocks_send`, test/graph/regressions.test.ts); here the sentences that tell a lead to use it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const brief = readFileSync(join(ROOT, "claude-plugin/skills/write-brief/SKILL.md"), "utf8");

/** The table row whose first cell is `cell`. */
function row(cell: string): string {
  const line = brief.split("\n").find((l) => l.startsWith(`| ${cell} |`));
  assert.ok(line, `no table row "${cell}"`);
  return line;
}

test("R-20: write-brief has a 사전 확인 field: a read-only precheck item that blocks the unit", () => {
  const precheck = row("사전 확인");
  // Only an Orca dep keeps the Task from starting, and a made Task's brief cannot gain the wait line: the field is set at creation.
  // The brief is written before the precheck ends, so it names the precheck item and cannot carry what it found.
  for (const want of [
    "남이 가진 스택·서비스",
    "읽기 전용 사전 확인 항목",
    "`item_create` 가 돌려준 그 항목의 `task` id 를 `deps` 에 넣어 선행(`blocks`)으로 건다(같은 Run 의 Task 여야 한다)",
    "Orca 가 이 항목의 Task 를 시작하지 못하게 잡는다",
    "이미 만든 항목에는 이 칸을 뒤늦게 달지 못한다",
    "이 칸과 `deps` 를 넣은 항목을 새로 만들어 그것을 시작하고, 옛 항목은 시작하지 않는다",
    "리드의 사전 확인 메시지를 받기 전에는 그 스택·서비스를 바꾸지 않는다고 적는다",
    "거기서 본 것은 싣지 못한다",
    "리드가 이 항목을 시작한 뒤 Orca 메시지로 보낸다",
  ]) {
    assert.ok(precheck.includes(want), `사전 확인 row lacks ${want}`);
  }
});

test("R-20: write-brief's 머지 field names the required checks as a command", () => {
  const land = row("머지");
  assert.ok(land.includes("필수 체크는 이름이 아니라 확인하는 명령으로 적는다"), "머지 row lacks the required-check sentence");
});

test("R-20: the scenario the precheck field rests on is still a test", () => {
  const graph = readFileSync(join(ROOT, "test/graph/regressions.test.ts"), "utf8");
  assert.match(graph, /^test\("precheck_blocks_send: /m);
});
