import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../../core/index.ts";
import { scratchDir } from "../../test/scratch.ts";

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

const call = (note: string, extra: Record<string, unknown> = {}) => {
  const l = byNote(note);
  return JSON.stringify({ session_id: "s1", cwd: "/work/acme", tool_name: l.tool_name, tool_input: l.tool_input, ...extra });
};

test("a raw start is denied on stdout and recorded as gate_denied with the command in a file", () => {
  const home = scratchDir("sangsoe-hook-");
  const r = hook(home, call("fallback start", { agent_type: "sangsoe:lead" }));
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

test("decision 239: the same raw start in a session sangsoe has no record of passes and records nothing", () => {
  const home = scratchDir("sangsoe-hook-");
  const r = hook(home, call("fallback start"));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "");
  const store = Store.open({ home });
  try {
    assert.equal(store.events({ type: "gate_denied" }).length, 0);
  } finally {
    store.close();
  }
});

// Decision 208: Claude Code lets a timed-out hook's call through, so a locked store must not hold the hook
// near its 15 seconds. The deny stands unrecorded.
test("a locked store still denies, well inside the hook's timeout", () => {
  const home = scratchDir("sangsoe-hook-");
  Store.open({ home }).close();
  const lock = new DatabaseSync(join(home, ".local", "share", "sangsoe", "sangsoe.db"));
  lock.exec("BEGIN EXCLUSIVE");
  try {
    const started = Date.now();
    const r = hook(home, call("fallback start"));
    assert.ok(Date.now() - started < 3_000, `took ${Date.now() - started}ms`);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, "deny");
  } finally {
    lock.exec("ROLLBACK");
    lock.close();
  }
});

test("a normal call prints nothing and records nothing", () => {
  const home = scratchDir("sangsoe-hook-");
  const r = hook(home, call("test suite"));
  assert.deepEqual([r.code, r.stdout], [0, ""]);
  assert.deepEqual(readdirSync(home), []);
});

test("unreadable input exits 2, a refusal", () => {
  const home = scratchDir("sangsoe-hook-");
  const r = hook(home, "not json");
  assert.equal(r.code, 2);
  assert.match(r.stderr, /not JSON/);
  assert.equal(hook(home, "{}", ["hook", "no-such-event"]).code, 2);
});

test("a recording hook fails open: unreadable input or no Orca exits 0 and injects nothing", () => {
  const home = scratchDir("sangsoe-hook-");
  for (const input of ["not json", "{}", JSON.stringify({ cwd: "/" })]) {
    assert.deepEqual(Object.values(hook(home, input, ["hook", "session-start"])).slice(0, 2), [0, ""]);
  }
  const r = hook(home, JSON.stringify({ session_id: "s1", cwd: home, prompt: "d001 yes" }), ["hook", "user-prompt-submit"]);
  assert.deepEqual([r.code, r.stdout], [0, ""]);
});

test("--replay measures the fixture and exits 0 only with no false positive or negative", () => {
  const r = hook(tmpdir(), "", ["hook", "pre-tool-use", "--replay", FIXTURE]);
  assert.equal(r.code, 0, r.stdout);
  const counts = JSON.parse(r.stdout.split("\n").at(-1) ?? "{}");
  assert.deepEqual([counts.falsePositive, counts.falseNegative, counts.wrongGate], [0, 0, 0]);
});
