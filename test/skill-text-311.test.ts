// Decision 311: the orchestrator shows the owner the approval line land names, and the hook reads that same line.
// Text tests: each sentence fails on a tree without it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { approvalLine, parseApprovalLine } from "../core/owner/approval.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const TEMPLATE = "`승인 <owner/repo>#<N> <head>`";
const HEAD = "0123456789abcdef0123456789abcdef01234567";

test("311-1: orchestrator.md and the orchestrate skill show the owner the line instead of a hand merge, and never type it", () => {
  for (const where of ["claude-plugin/agents/orchestrator.md", "claude-plugin/skills/orchestrate/SKILL.md"]) {
    const text = read(where);
    for (const want of [TEMPLATE, "`! gh pr merge`", "결정 311", "`land`"]) assert.ok(text.includes(want), `${where} lacks: ${want}`);
    assert.match(text, /오너가[^.]*그 줄 하나만 직접 치면/, where);
    assert.match(text, /예약/, where);
  }
});

test("311-2: the line the template and land's note name is the line the hook reads", () => {
  const line = approvalLine("Acme/API", 12, HEAD);
  assert.equal(line, `승인 Acme/API#12 ${HEAD}`);
  assert.deepEqual(parseApprovalLine(line), { pr: "acme/api#12", head_sha: HEAD });
  const filled = TEMPLATE.slice(1, -1).replace("<owner/repo>", "Acme/API").replace("<N>", "12").replace("<head>", HEAD);
  assert.equal(filled, line);
});
