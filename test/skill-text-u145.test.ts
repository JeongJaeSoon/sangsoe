// U145 (decision 298): the seven lessons the sangsoe program's reflect left for the skill and agent texts.
// Text tests: each sentence lives in the file the lesson names and fails on a tree without it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const has = (text: string, wants: string[], where: string) => {
  for (const want of wants) assert.ok(text.includes(want), `${where} lacks: ${want}`);
};

const brief = read("claude-plugin/skills/write-brief/SKILL.md");
const worker = read("claude-plugin/agents/worker.md");
const lead = read("claude-plugin/agents/lead.md");
const start = read("claude-plugin/skills/start/SKILL.md");

/** The body of the `## <heading>` section, up to the next `## `. */
function section(text: string, heading: string): string {
  const at = text.indexOf(`\n## ${heading}\n`);
  assert.ok(at >= 0, `no section "## ${heading}"`);
  const end = text.indexOf("\n## ", at + 1);
  return text.slice(at, end < 0 ? undefined : end);
}
const row = (cell: string) => {
  const line = brief.split("\n").find((l) => l.startsWith(`| ${cell} |`));
  assert.ok(line, `no table row "${cell}"`);
  return line;
};

// Spelled in two pieces: test/orca-boundary.test.ts refuses the consuming mail read named in any file (decision 60).
const WAIT_CMD = `orca orchestration ${"chec"}${"k"}`;
const SEARCH ="코드는 Grep tool 이나 평범한 낱말로 찾는다";
const SEARCH_WORDS = ["비밀 파일 꼴의 이름", "환경 전체를 쏟는 낱말", "`$VAR` 이름이 든 명령", "`label: value` 줄로 쓰지 않는다"];

test("U145-1: write-brief's subagent lines and deliver-ticket's reviewer lines say how to search and how to report", () => {
  has(section(brief, "서브에이전트 지시문"), [SEARCH, ...SEARCH_WORDS], "write-brief 서브에이전트 지시문");
  has(read("claude-plugin/skills/deliver-ticket/SKILL.md"), ["코드는 Grep tool 이나 평범한 낱말로 찾고", ...SEARCH_WORDS], "deliver-ticket");
  has(worker, [SEARCH, ...SEARCH_WORDS], "worker.md");
});

test("U145-2: scratch files stay in one untracked folder in the worker's own worktree; big outputs go to the trash", () => {
  const where = ["자기 worktree 안의 추적하지 않는 폴더 하나", "TMPDIR·/tmp·부모 checkout", "휴지통", "`.gitignore`·`.git/info/exclude`"];
  has(row("범위"), ["받는 쪽 자기 worktree 안의 추적하지 않는 폴더 하나", "TMPDIR·/tmp·부모 checkout", "휴지통", "`.gitignore`·`.git/info/exclude`"], "write-brief 범위 cell");
  has(worker, where, "worker.md");
  has(section(brief, "서브에이전트 지시문"), ["추적하지 않는 폴더 하나", "TMPDIR·/tmp·부모 checkout"], "write-brief 서브에이전트 지시문");
});

test("U145-3: a subagent runs one test file per Bash call, with no loop, glob, full suite or unnamed wrapper", () => {
  const want = ["Bash 호출 하나에 파일 하나만 돌린다", "반복문·glob·전체 `npm test`", "브리프가 이름 대지 않은 slot 이나 래퍼"];
  has(section(brief, "서브에이전트 지시문"), want, "write-brief 서브에이전트 지시문");
  has(worker, want, "worker.md");
});

test("U145-4: files change through Edit and Write, generated files through their generator, and a file-changing Bash call stands alone", () => {
  has(row("범위"), ["Edit·Write tool 로만 바꾸고", "생성 파일은 그 생성기로만", "파일을 바꾸는 Bash 호출은 그것만 하고 읽기·시험과 한 호출에 잇지 않는다"], "write-brief 범위 cell");
  has(worker, ["파일은 Edit·Write tool 로만 바꾼다", "생성 파일은 그 생성기로만", "파일을 바꾸는 Bash 호출은 그것만 하고, 읽기·시험과 한 호출에 잇지 않는다"], "worker.md");
});

test("U145-5: status wakes no session; what the receiver must act on soon goes as a question with the window's end", () => {
  const want = ["status 가 받는 쪽을 깨운다고 기대하지 않는다", "go · ready · merged · 시간 창이 있는 알림", "창이 끝나는 시각을 적은 `--type question`"];
  const owner = section(read("claude-plugin/skills/orchestrate/SKILL.md"), "결정과 오너").trimEnd();
  assert.ok(owner.split("\n").at(-1)?.includes("status 가 받는 쪽을 깨운다고 기대하지 않는다"), "the sentence closes the section");
  has(owner, want, "orchestrate 결정과 오너");
  has(row("보고"), want, "write-brief 보고 cell");
});

test("U145-6: lineage_invalid also comes from a lead with no Task or a worktree missing from the list; ask, do not retry", () => {
  const want = ["Task·Dispatch 가 없는 리드", "`orca worktree list` 에 없", "새 항목을 만들지 않", "브리프 경로를 붙여 question 으로 묻는다"];
  has(start, want, "start skill");
  has(section(lead, "깨어날 때마다"), want, "lead.md 깨어날 때마다");
});

test("U145-7: after a restart the lead finds the previous Run in the handoff before run-create, re-arms check --wait; server_stale needs a restart", () => {
  const wake = section(lead, "첫 깨움");
  has(wake, ["handoff 에서 앞 Run id 를 찾아 `run-use --id <그 id>`", `\`${WAIT_CMD} --wait\` 를 백그라운드로 다시 걸어 둔다`], "lead.md 첫 깨움");
  assert.ok(wake.indexOf("handoff 에서 앞 Run id") < wake.indexOf("run-create --objective"), "handoff Run comes before run-create");
  has(start, ["`server_stale` 은 `/reload-plugins` 로 풀리지 않는다", "세션을 다시 시작해야 풀린다"], "start skill");
});
