// Decision 322: the start and orchestrate skills' restart sections name start_unit's resume path.
// Text tests: each sentence fails on a tree without it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("322: the start skill's restart section opens the terminal, then binds it through start_unit's resume", () => {
  const text = read("claude-plugin/skills/start/SKILL.md");
  const section = text.slice(text.indexOf("## 재시작"), text.indexOf("## 깊이가 모자랄 때"));
  for (const want of ["결정 322", "orca terminal create --worktree id:", "claude --resume <세션 id>", "`resume`", "{worktreeId, sessionId, terminal}", "`resumed`", "unverifiable", "`[gate:delegate]`", "서브에이전트"]) {
    assert.ok(section.includes(want), `start skill restart section lacks: ${want}`);
  }
});

test("322: the orchestrate skill's restart section sends a resumed session through start_unit's resume", () => {
  const text = read("claude-plugin/skills/orchestrate/SKILL.md");
  const section = text.slice(text.indexOf("## 재시작"));
  for (const want of ["결정 322", "`resume`", "`start` skill 의 재시작 절", "claude --resume"]) assert.ok(section.includes(want), `orchestrate restart section lacks: ${want}`);
});

test("322: a cut-off resume call is retried with the same resume, in both result tables (decision 321's row)", () => {
  const start = read("claude-plugin/skills/start/SKILL.md");
  assert.ok(start.includes("`resume` 호출이었으면 같은 `task` 와 같은 `resume` 으로 다시 부른다"), "start result table");
  const orchestrate = read("claude-plugin/skills/orchestrate/SKILL.md");
  assert.ok(orchestrate.includes("`resume` 호출이었으면 같은 `resume` 도 그대로 넘긴다"), "orchestrate result table");
});
