import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Decision 207: after a worker_done nothing in sangsoe releases the Dispatch, so the session that
// reads the report does, with Orca's own token-free `worker-release` (agent terminal only; the setup
// shell stays REAPER's, decision 202). The smoke's lead found no tool in its wake-up table.

const skill = readFileSync(new URL("../claude-plugin/skills/orchestrate/SKILL.md", import.meta.url), "utf8");

test("every worker_done row of the orchestrate wake-up table names worker-release, never terminal close", () => {
  const rows = skill.split("\n").filter((l) => l.startsWith("| 워커의 worker_done"));
  assert.equal(rows.length, 2);
  for (const row of rows) {
    const tool = row.split("|").at(-2) ?? "";
    assert.match(tool, /worker-release --dispatch <dispatch_id>/, row);
    assert.doesNotMatch(row, /terminal close/, row);
  }
});
