// Decision 323: the PR step of deliver-ticket tells the worker to check the card's Orca reference.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;

test("323: deliver-ticket's PR step lists the card's references, adds a missing one and reports one it cannot", () => {
  const text = readFileSync(join(ROOT, "claude-plugin/skills/deliver-ticket/SKILL.md"), "utf8");
  for (const want of ["orca reference list --worktree id:", "orca reference add <PR URL> --worktree id:", "`notes`", "결정 193·323"]) {
    assert.ok(text.includes(want), `lacks: ${want}`);
  }
  assert.match(text, /안 붙으면 worker_done 본문에 적는다/);
});
