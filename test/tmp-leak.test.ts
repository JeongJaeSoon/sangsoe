import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// Decision 234: the per-call sangsoe-hook-, -session-, -pre-, -record- and -mail- directories that
// piled up in $TMPDIR came from these test files, not from the hooks. Each run must leave none.
const ROOT = new URL("..", import.meta.url).pathname;
const LEAKED = [
  "cli/commands/hook.test.ts",
  "test/hooks-registered.test.ts",
  "test/record/record.test.ts",
  "test/session/hooks.test.ts",
  "core/detect/orca/mail.test.ts",
];

test("the test files that made per-call temporary directories leave none behind", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "leak-probe-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const env = { ...process.env, TMPDIR: `${tmp}/` };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ["--test", ...LEAKED], { cwd: ROOT, env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout.slice(-2000));
  assert.deepEqual(
    readdirSync(tmp).filter((n) => n.startsWith("sangsoe-")),
    [],
  );
});
