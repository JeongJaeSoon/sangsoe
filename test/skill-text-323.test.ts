// Decision 323: the PR step of deliver-ticket tells the worker to check the card's Orca reference.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;

test("323: deliver-ticket's PR step lists the card's references and reports a missing PR with land's notes as the reason", () => {
  const text = readFileSync(join(ROOT, "claude-plugin/skills/deliver-ticket/SKILL.md"), "utf8");
  for (const want of ["orca reference list --worktree id:", "`notes`", "결정 193·323"]) {
    assert.ok(text.includes(want), `lacks: ${want}`);
  }
  assert.match(text, /없으면 직접 붙이지 않고 worker_done 본문에 적는다/);
});
