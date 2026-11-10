// Decision 198: the recorder names the session's checkout with `git -C`, so the MCP server's own cwd
// decides nothing; from `/` or a folder outside every repo it refuses in Korean, before any GitHub read.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { recorderRefusal } from "../../claude-plugin/mcp/recorder.ts";
import { type ApproveExec, approveExec } from "../../core/index.ts";

const A = { tool: "review_record", repo: "acme/api", pr: 12, head: "a".repeat(40), what: "verdict", refused: "review_refused", fix: "x" };

test("from / and from a folder outside every repo the recorder refuses in Korean and reads no PR", async () => {
  const plain = mkdtempSync(join(tmpdir(), "sangsoe-recorder-"));
  try {
    for (const cwd of ["/", plain]) {
      const calls: string[][] = [];
      const exec: ApproveExec = async (cmd, args) => {
        calls.push([cmd, ...args]);
        return cmd === "git" ? approveExec(cmd, args) : { code: 1, stdout: "", stderr: "offline" };
      };
      const r = await recorderRefusal(exec, A, cwd);
      assert.ok(r && !r.ok, cwd);
      assert.equal(r.refusal.code, "recorder_unknown");
      assert.match(r.refusal.reason, /git checkout 이 아니라/);
      assert.doesNotMatch(r.refusal.reason, /fatal|cannot read/, "one Korean line, not git's stderr");
      assert.deepEqual(calls[0]?.slice(0, 3), ["git", "-C", cwd]);
      assert.ok(!calls.some((c) => c[0] === "gh"), "no GitHub read after the refusal");
    }
  } finally {
    rmSync(plain, { recursive: true, force: true });
  }
});

test("the checkout read is the session's cwd, not the server process's", async () => {
  const calls: string[][] = [];
  const exec: ApproveExec = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === "git") return { code: 0, stdout: `${"b".repeat(40)}\nlead/program\n`, stderr: "" };
    return { code: 0, stdout: "acme/feature\n", stderr: "" };
  };
  assert.equal(await recorderRefusal(exec, A, "/work/acme/api-lead"), undefined);
  assert.deepEqual(calls[0], ["git", "-C", "/work/acme/api-lead", "rev-parse", "HEAD", "--abbrev-ref", "HEAD"]);
});
