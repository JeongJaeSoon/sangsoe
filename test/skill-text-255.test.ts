// Decision 255: what a session does when an act is refused lives in sangsoe's own skills: one paragraph
// in write-brief that every brief and subagent prompt carries, and the places that point at it.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const skill = (name: string) => read(`claude-plugin/skills/${name}/SKILL.md`);

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

const paragraph = () => section(skill("write-brief"), "거부 문단");
const has = (text: string, want: string, where: string) => assert.ok(text.includes(want), `${where} lacks: ${want}`);

test("the refusal paragraph names every source: permission rule, the safety check with no verdict, a guard hook, the human", () => {
  const p = paragraph();
  for (const want of ["권한 규칙", "Claude Code 의 안전 검사", "판정 없이 끝난 오류", "가드 hook", "사람이 거부한 행위는 거기서 멈춘다"]) {
    has(p, want, "거부 문단");
  }
});

test("the refusal paragraph forbids the same act another way, a split command included", () => {
  const p = paragraph();
  has(p, "다른 세션·스크립트·도구·래퍼·대상으로, 명령을 쪼개서", "거부 문단");
  has(p, "그 안의 행위가 모두 거부된 것이다", "거부 문단");
});

test("the refusal paragraph allows one text-only reword, never for a file the command opens", () => {
  const p = paragraph();
  has(p, "hook 이 명령의 글만 맞춰 막았고 그 글이 명령이 여는 파일을 가리키지 않으면", "거부 문단");
  has(p, "그 글만 한 번 고쳐 쓰고 보고에 그렇게 했다고 적는다", "거부 문단");
  has(p, "스크립트나 다른 경로는 고쳐 쓰기가 아니다", "거부 문단");
});

test("the refusal paragraph writes the command to a file under orch-refusal/ with the Act: and Category: lines", () => {
  const p = paragraph();
  has(p, "/orch-refusal/<worktree 폴더 이름>/", "거부 문단");
  has(p, "`Act:` 로 시작하는 줄", "거부 문단");
  has(p, "`Category:` 로 시작하는 줄", "거부 문단");
  has(p, "그 Write 마저 거부되면", "거부 문단");
});

test("the refusal paragraph reports once, in the same turn, as an escalation, without quoting the command", () => {
  const p = paragraph();
  has(p, "보고는 같은 턴에 한 번", "거부 문단");
  has(p, "Orca escalation 으로", "거부 문단");
  has(p, "명령은 인용하지 않는다", "거부 문단");
});

test("the refusal paragraph says how a subagent's refusal reaches the session that started it", () => {
  const p = paragraph();
  has(p, "서브에이전트는 Orca 메일을 보내지 못하므로 같은 것을 자기 결과에 쓴다", "거부 문단");
  has(p, "`Act:`·`Category:` 줄은 결과에 옮겨 적지 않는다", "거부 문단");
  has(p, "그 행위를 대신하지 않는다", "거부 문단");
});

test("the refusal paragraph leaves the next step to the lead or the orchestrator", () => {
  has(paragraph(), "다음 걸음은 리드나 오케스트레이터가 정한다", "거부 문단");
});

test("the refusal paragraph says a failing check is not a refusal", () => {
  has(paragraph(), "실패한 검사(git hook·lint·시험·CI)는 거부가 아니다", "거부 문단");
});

test("each sangsoe gate the refusal paragraph names exists, with the step the paragraph says it names", () => {
  const p = paragraph();
  const named = [...p.matchAll(/\[gate:([a-z-]+)\]/g)].map((m) => m[1] ?? "");
  assert.deepEqual([...new Set(named)].sort(), ["delegate", "pressure", "self-land", "sleep-loop"]);
  const gates = readdirSync(join(ROOT, "core/gates")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  const source = gates.map((f) => read(`core/gates/${f}`)).join("\n");
  for (const g of named) assert.match(source, new RegExp(`["\`]\\[gate:${g}\\] `), `no gate reason starts [gate:${g}]`);
  has(read("core/gates/pressure.ts"), "run the same call again once the load drops", "pressure gate");
  has(read("core/gates/sleep-loop.ts"), "Run the same command with run_in_background: true", "sleep-loop gate");
  has(p, "부하가 내려간 뒤 같은 호출", "거부 문단");
  has(p, "같은 명령을 `run_in_background: true` 로", "거부 문단");
});

test("the refusal paragraph allows one same-form retry, never on a human's refusal, and every other hook block is a refusal", () => {
  const p = paragraph();
  has(p, "(2) 같은 꼴로 한 번 더", "거부 문단");
  has(p, "사람의 거부에는 증거로 다시 하지 않는다", "거부 문단");
  has(p, "그 밖의 hook 거부는 다른 길을 일러 줘도 거부다", "거부 문단");
});

test("the refusal paragraph lets the orchestrator hand work down after [gate:delegate], as that gate asks", () => {
  const p = paragraph();
  has(p, "(4) 사람이 거부하지 않은 행위를 브리프나 skill 이 그 일에 이미 정한 길", "거부 문단");
  has(p, "`[gate:delegate]` 에 막힌 오케스트레이터가 그 일을 워커나 서브에이전트에게 넘기는 것은 다른 길이 아니다", "거부 문단");
  has(read("core/gates/delegate.ts"), "Hand it down", "delegate gate");
  has(read("core/gates/self-land.ts"), "Send it as `--type worker_done`", "self-land gate");
  has(p, "`merge_ready` 대신 worker_done", "거부 문단");
});

test("the refusal paragraph gives a session with no Dispatch its own report path", () => {
  const p = paragraph();
  has(p, "Task 없는 리드는 브리프의 보고 칸이 적은 오케스트레이터의 Run 에 `send --type question` 으로", "거부 문단");
  has(p, "오케스트레이터는 `decision_open` 으로 오너에게 올린다", "거부 문단");
  has(p, "펼친 절대 경로", "거부 문단");
});

test("the refusal paragraph restarts a unit whose subagent's Edit or Write got no verdict", () => {
  has(paragraph(), "시작한 세션이 그 단위를 처음부터 한 번 다시 한다. 거기서 다시 판정이 없으면 오너에게 간다", "거부 문단");
  has(row(skill("orchestrate"), "거부 보고"), "너는 다시 시작하지 않는다", "거부 보고 row");
});

test("orchestrate's 거부 보고 row trashes the refusal file it read and grants no second retry", () => {
  const r = row(skill("orchestrate"), "거부 보고");
  has(r, "`orch-refusal/` 파일은 코어가 그 메시지의 `refusal_report` 를 남긴 뒤", "거부 보고 row");
  has(r, "먼저 옮기면 코어가 읽지 못해 거부가 보이지 않는다", "거부 보고 row");
  has(r, "이미 \"재시도 1회\" 가 있거나 사람이 거부했으면 이 길은 없다", "거부 보고 row");
});

test("write-brief's subagent prompt section pastes the refusal paragraph", () => {
  has(section(skill("write-brief"), "서브에이전트 지시문"), "아래 거부 문단도 통째로 붙인다", "서브에이전트 지시문");
});

test("deliver-ticket: a subagent's refusal, the reviewer prompt and a refused merge all go by the refusal paragraph", () => {
  const text = skill("deliver-ticket");
  has(section(text, "2. 구현과 시험"), "서브에이전트의 결과가 거부를 알리면", "§2");
  has(section(text, "3. 독립 리뷰"), "`write-brief` 의 거부 문단을 통째로 붙인다", "§3");
  const s6 = section(text, "6. land 와 머지 대기 보고");
  has(s6, "`write-brief` 의 거부 문단대로", "§6");
  has(s6, "같은 턴에 escalation 한 번", "§6");
  has(s6, "`refusal.code` 는 이 거부가 아니다", "§6");
});

test("orchestrate's 거부 보고 row: no other session, no coached form, a rule goes to the owner, the check stays unverified", () => {
  const r = row(skill("orchestrate"), "거부 보고");
  for (const want of [
    "어느 세션도, 너도",
    "통과할 꼴",
    "일러 주지 않는다",
    "가장 작은 규칙을 오너 몫으로",
    "'확인 못 함(거부)'",
    "land 하지 않고 되돌린다",
    "그 서브에이전트를 띄운 세션(워커가 띄웠으면 그 워커)이 단위째 한 번",
    "`decision_open`",
  ]) {
    has(r, want, "거부 보고 row");
  }
});

test("end-session: a refusal is not held for worker_done, and the refusal file is left for its reader", () => {
  const text = skill("end-session");
  has(section(text, "5. 한 번 보고"), "거부된 행위는 worker_done 까지 미루지 않는다", "§5");
  has(section(text, "2. 내가 띄운 것을 내린다"), "거부 보고 파일(`orch-refusal/` 아래)은 치우지 않는다", "§2");
});
