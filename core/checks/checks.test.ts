import assert from "node:assert/strict";
import { test } from "node:test";
import { type FakeReply, createFakeOrca } from "../../test/fake-orca/index.ts";
import { createOrcaAdapter } from "../orca/adapter.ts";
import { type CheckResult, doctorReport, runChecks, startReport } from "./check.ts";
import { START_CHECKS } from "./index.ts";

// The fixtures' sangsoe plugins are 0.1.0; the core version is injected, never read from package.json here.
const CORE_VERSION = "0.1.0";

async function check(scenario: string, replies?: Record<string, FakeReply>): Promise<CheckResult[]> {
  const fake = createFakeOrca(replies ? { scenario, replies } : { scenario });
  return runChecks(START_CHECKS, { orca: createOrcaAdapter(fake.exec), exec: fake.exec, coreVersion: CORE_VERSION });
}

const byId = (rs: CheckResult[], id: string) => rs.find((r) => r.id === id);

test("on the recorded local Orca every check is green and the start prints nothing", async () => {
  const rs = await check("local");
  assert.deepEqual(
    rs.filter((r) => r.status !== "ok"),
    [],
  );
  assert.deepEqual(startReport(rs), { refuse: false, lines: [] });
  assert.equal(doctorReport(rs).exitCode, 0);
});

test("a missing capability refuses the start", async () => {
  const rs = await check("missing-capability");
  const cap = byId(rs, "orca-capabilities");
  assert.equal(cap?.status, "fail");
  assert.match(cap?.summary ?? "", /orchestration\.worker-auto-release\.v1/);
  assert.equal(startReport(rs).refuse, true);
});

test("a command or flag missing from agent-context refuses the start", async () => {
  const rs = await check("local", {
    "agent-context": { schemaVersion: 1, commands: [{ command: "status", path: ["status"], flags: ["json"] }] },
  });
  const cmd = byId(rs, "orca-commands");
  assert.equal(cmd?.status, "fail");
  assert.match(cmd?.summary ?? "", /orchestration inbox/);
});

test("Orca not running refuses the start with `orca open`", async () => {
  const rs = await check("orca-down");
  assert.deepEqual(
    [byId(rs, "orca-reachable")?.status, byId(rs, "orca-reachable")?.fix],
    ["fail", "orca open"],
  );
  assert.equal(startReport(rs).refuse, true);
});

test("non-local rows, omitted hosts and connected remote hosts give one warning, not a refusal", async () => {
  const rs = await check("remote-host");
  const remote = byId(rs, "remote-hosts");
  assert.equal(remote?.status, "warn");
  // ssh-…aaaaaa (rows + connected), "(none)" (empty and missing hostId), ssh-…bbbbbb (omitted).
  assert.match(remote?.summary ?? "", /^비로컬 호스트 3개\(행 3개\)가 보인다/);
  const start = startReport(rs);
  assert.equal(start.refuse, false);
  assert.equal(start.lines.length, 1);
});

test("a disconnected remote host alone is not a warning", async () => {
  const rs = await check("local");
  assert.equal(byId(rs, "remote-hosts")?.status, "ok");
});

test("Orca status hooks off is a notice with the command a person runs", async () => {
  const rs = await check("hooks-off");
  assert.deepEqual(
    [byId(rs, "orca-hooks")?.status, byId(rs, "orca-hooks")?.fix],
    ["notice", "orca agent hooks on"],
  );
  assert.equal(startReport(rs).refuse, false);
});

test("a version drift on either plugin recommends sangsoe install", async () => {
  const rs = await check("version-drift");
  for (const id of ["claude-plugin-version", "orca-plugin-version"]) {
    assert.equal(byId(rs, id)?.status, "warn", id);
    assert.equal(byId(rs, id)?.fix, "sangsoe install", id);
  }
  assert.equal(startReport(rs).refuse, false);
});

test("a pending re-approval points at sangsoe plugin approve", async () => {
  const rs = await check("local", {
    "plugin-list": { ok: true, result: { plugins: [{ pluginKey: "local.sangsoe", name: "sangsoe", version: "0.1.0", status: "disabled", needsReconsent: true, isDev: true, consentFingerprint: "x" }] } },
  });
  assert.equal(byId(rs, "orca-plugin-version")?.fix, "sangsoe plugin approve");
});

test("a disabled plugin on either host is not green", async () => {
  const rs = await check("local", {
    "claude-plugin-list": [{ id: "sangsoe@sangsoe", version: "0.1.0", enabled: false }],
    "plugin-list": { ok: true, result: { plugins: [{ pluginKey: "local.sangsoe", name: "sangsoe", version: "0.1.0", status: "disabled", needsReconsent: false, isDev: true, consentFingerprint: "x" }] } },
  });
  assert.deepEqual(
    [byId(rs, "claude-plugin-version")?.status, byId(rs, "claude-plugin-version")?.fix],
    ["warn", "claude plugin enable sangsoe@sangsoe"],
  );
  assert.deepEqual(
    [byId(rs, "orca-plugin-version")?.status, byId(rs, "orca-plugin-version")?.summary],
    ["warn", "Orca plugin 이 꺼져 있다"],
  );
});

test("a check that throws becomes a failed item instead of breaking the run", async () => {
  const rs = await runChecks([{ id: "boom", run: async () => { throw new Error("x"); } }], {
    orca: createOrcaAdapter(createFakeOrca().exec),
    exec: createFakeOrca().exec,
    coreVersion: CORE_VERSION,
  });
  assert.equal(rs[0]?.status, "fail");
});

test("start and doctor print the same results differently", async () => {
  const rs = await check("version-drift");
  const doctor = doctorReport(rs);
  assert.equal(doctor.lines.filter((l) => /^(🟢|🔴) /.test(l)).length, START_CHECKS.length);
  assert.ok(doctor.lines.includes("   고칠 명령: sangsoe install"));
  assert.equal(doctor.exitCode, 0, "warnings do not fail doctor");
  const start = startReport(rs);
  assert.deepEqual(
    start.lines.map((l) => l.split(":")[0]),
    ["sangsoe warn", "sangsoe warn"],
  );
});
