import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Store } from "../../core/index.ts";

// The hook as Claude Code runs it: a process with the call on stdin. Raw commands come from the fixture
// (the repository scan for raw starts reads code files, and this is one).

const MAIN = fileURLToPath(new URL("../main.ts", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../../test/fixtures/hook-commands.jsonl", import.meta.url));
const fixture = readFileSync(FIXTURE, "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l) as { expect: string; note: string; tool_name: string; tool_input: unknown });
const byNote = (note: string) => {
  const l = fixture.find((x) => x.note === note);
  assert.ok(l, note);
  return l;
};

function hook(home: string, input: string, args: string[] = ["hook", "pre-tool-use"]) {
  const r = spawnSync(process.execPath, [MAIN, ...args], { input, encoding: "utf8", env: { ...process.env, HOME: home } });
  return { code: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}

const call = (note: string) => {
  const l = byNote(note);
  return JSON.stringify({ session_id: "s1", cwd: "/work/acme", tool_name: l.tool_name, tool_input: l.tool_input });
};

test("a raw start is denied on stdout and recorded as gate_denied with the command in a file", () => {
  const home = mkdtempSync(join(tmpdir(), "sangsoe-hook-"));
  const r = hook(home, call("fallback start"));
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.permissionDecision, "deny");
  assert.match(out.permissionDecisionReason, /^\[gate:start\]/);

  const store = Store.open({ home });
  try {
    const events = store.events({ type: "gate_denied" });
    assert.equal(events.length, 1);
    const payload = events[0]?.payload as { gate: string; command_file: string };
    assert.equal(payload.gate, "start");
    assert.equal(events[0]?.actor, "s1");
    assert.ok(readFileSync(payload.command_file, "utf8").startsWith("Bash\n"));
    assert.equal(JSON.stringify(payload).includes("launch"), false, "the event holds the path, not the command");
  } finally {
    store.close();
  }
});

test("a normal call prints nothing and records nothing", () => {
  const home = mkdtempSync(join(tmpdir(), "sangsoe-hook-"));
  const r = hook(home, call("test suite"));
  assert.deepEqual([r.code, r.stdout], [0, ""]);
  assert.deepEqual(readdirSync(home), []);
});

test("unreadable input exits non-zero, which onFailure block turns into a refusal", () => {
  const home = mkdtempSync(join(tmpdir(), "sangsoe-hook-"));
  const r = hook(home, "not json");
  assert.equal(r.code, 2);
  assert.match(r.stderr, /not JSON/);
  assert.equal(hook(home, "{}", ["hook", "session-start"]).code, 2);
});

test("--replay measures the fixture and exits 0 only with no false positive or negative", () => {
  const r = hook(tmpdir(), "", ["hook", "pre-tool-use", "--replay", FIXTURE]);
  assert.equal(r.code, 0, r.stdout);
  const counts = JSON.parse(r.stdout.split("\n").at(-1) ?? "{}");
  assert.deepEqual([counts.falsePositive, counts.falseNegative, counts.wrongGate], [0, 0, 0]);
});
