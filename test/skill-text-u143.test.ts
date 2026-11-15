// U143 (decision 261 ⑦ B1): a session started as documented holds its own Run, and a worker reports to the Run
// its Dispatch is on, whose coordinator relays upward. Text tests: the words live in agent and skill files.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** The body of the `## <heading>` section, up to the next `## `. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}\n`);
  assert.ok(start >= 0, `no section "## ${heading}"`);
  const end = text.indexOf("\n## ", start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}

const has = (text: string, want: string, where: string) => assert.ok(text.includes(want), `${where} lacks: ${want}`);

test("orchestrator.md has a start step that makes the session hold its own Run: run-use --id for an earlier Run, else run-current, else run-create", () => {
  const s = section(read("claude-plugin/agents/orchestrator.md"), "시작할 때");
  for (const want of ["orca orchestration run-current", "orca orchestration run-create", "orca orchestration run-use", "Dispatch"]) {
    has(s, want, "orchestrator.md 시작할 때");
  }
  // The SessionStart hook tells any non-worker whose binding is gone to `run-use <earlier Run>`; creating a new Run strands the leads.
  has(s, "run-use --id <id>", "orchestrator.md 시작할 때");
  has(s, "run-use` 가 실패하면", "orchestrator.md 시작할 때");
  assert.ok(s.indexOf("run-use --id <id>") < s.indexOf("run-create"), "the restore case comes before run-create");
});

test("lead.md's first-wake Run step re-holds the Run SessionStart names before it creates one", () => {
  const s = section(read("claude-plugin/agents/lead.md"), "첫 깨움");
  has(s, "run-use --id <id>", "lead.md 첫 깨움");
  has(s, "run-use` 가 실패하면", "lead.md 첫 깨움");
  assert.ok(s.indexOf("run-use --id <id>") < s.indexOf("run-create"), "the restore case comes before run-create");
});

test("the orchestrate skill's orchestrator section points at the same start step", () => {
  const s = section(read("claude-plugin/skills/orchestrate/SKILL.md"), "오케스트레이터: 프로그램 사이");
  for (const want of ["자기 Run", "run-create", "run-use --id <id>"]) has(s, want, "orchestrate 오케스트레이터 절");
});

test("worker.md says a worker reports to the Run its Dispatch is on, and that Run's coordinator relays", () => {
  const w = read("claude-plugin/agents/worker.md");
  has(w, "Dispatch 가 걸린 Run", "worker.md");
  has(w, "Orca 가 거부한다", "worker.md");
  has(w, "그 Run 의 코디네이터가 위로 전한다", "worker.md");
});

test("no skill or agent text a worker follows tells it to send into a Run by address", () => {
  const files = [
    "claude-plugin/agents/worker.md",
    ...readdirSync(join(ROOT, "claude-plugin/skills"))
      .filter((d) => ["deliver-ticket", "end-session", "write-brief", "reap-resources"].includes(d))
      .map((d) => `claude-plugin/skills/${d}/SKILL.md`),
  ];
  for (const f of files) assert.ok(!/--to run:/.test(read(f)), `${f} tells a worker to send --to run:`);
});
