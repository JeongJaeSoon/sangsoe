// Decision 330: after an upgrade the coordinator restarts its stale children with `sangsoe restart`.
// Text tests: each sentence fails on a tree without it. The gate's half is core/gates/delegate.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const has = (text: string, wants: string[], where: string) => {
  for (const want of wants) assert.ok(text.includes(want), `${where} lacks: ${want}`);
};

test("330-2: install, the stale refusal and the skills point at sangsoe restart instead of a hand restart", () => {
  const install = read("core/install/stale-sessions.ts");
  assert.ok(install.includes("restart them with `sangsoe restart --stale`"), "install's last line");
  assert.ok(!install.includes("restart each with claude --continue"), "install still names a hand restart");
  assert.ok(read("claude-plugin/mcp/stale.ts").includes("restarts this session with `sangsoe restart --stale`"), "server_stale fix");
  // A child can take 90 seconds, past a foreground Bash call's limit; a cut run goes on by --task.
  const goesOn = ["`run_in_background`", "`sangsoe restart --task <Task id>`"];
  has(read("claude-plugin/skills/orchestrate/SKILL.md"), ["`sangsoe restart --stale --dry-run`", "결정 301", "(결정 330)", ...goesOn, "묶기만 한다"], "orchestrate 재시작");
  has(read("claude-plugin/skills/start/SKILL.md"), ["`sangsoe restart --stale`", "`worker-stop`", "(결정 330)", ...goesOn, "`bind` 줄"], "start 재시작");
  has(read("claude-plugin/agents/lead.md"), ["`sangsoe restart --stale`", "다시 띄웠다"], "lead.md");
  has(read("claude-plugin/agents/orchestrator.md"), ["`sangsoe restart --stale`", "오너에게 청하지 않는다"], "orchestrator.md");
  has(read("claude-plugin/skills/setup/SKILL.md"), ["`sangsoe restart --stale`"], "setup 갱신");
});
