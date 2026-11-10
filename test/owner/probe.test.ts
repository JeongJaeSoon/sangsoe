import assert from "node:assert/strict";
import { test } from "node:test";
import { linkShell, MARKED_ONLY, ownerTodoFrom, probeRound, probeTargets, readProbe, recordShellLink, VERIFY_KINDS } from "../../core/index.ts";
import { later, ownerWorld, RUN, T0 } from "./world.ts";

const T = "task_000000000001";

test("verify kinds are fixed at five, and run_ok/pr_found are read only on marked items", () => {
  assert.deepEqual([...VERIFY_KINDS], ["pr_merged", "orca_field", "plugin_approved", "run_ok", "pr_found"]);
  assert.deepEqual([...MARKED_ONLY].sort(), ["pr_found", "run_ok"]);
  const w = ownerWorld();
  w.item(T, { verify: { kind: "pr_found", repo: "acme/api", search: "promote in:title" } });
  assert.deepEqual(probeTargets(w.input(), w.facts()), []);
  assert.throws(() => w.item("task_000000000009", { verify: { kind: "mcp_state", repo: "acme/api" } as never }), /kind/);
});

test("each kind reads through its port and reports what it observed", async () => {
  const w = ownerWorld();
  const ports = { orca: w.orca, gh: w.ghClient };
  w.tasks.set("task_000000000077", { id: "task_000000000077", status: "completed", title: "x" });
  assert.deepEqual(await readProbe({ kind: "orca_field", target: "task_000000000077", field: "status", value: "completed" }, ports, { run: RUN }), { kind: "true", observed: "status=completed" });
  assert.equal((await readProbe({ kind: "orca_field", target: "task_000000000077", field: "spec", value: "x" }, ports, { run: RUN })).kind, "unreadable");
  assert.equal((await readProbe({ kind: "orca_field", target: "task_000000000077", field: "status", value: "completed" }, ports)).kind, "unreadable", "no Run known");

  assert.equal((await readProbe({ kind: "plugin_approved", key: "local.sangsoe" }, ports)).kind, "false");
  w.plugins.push({ pluginKey: "local.sangsoe", name: "sangsoe", version: "0.1.0", consentFingerprint: "fp1", status: "enabled", isDev: true, needsReconsent: false });
  assert.equal((await readProbe({ kind: "plugin_approved", key: "local.sangsoe" }, ports)).kind, "true");

  w.gh.set(`search/issues?q=${encodeURIComponent("repo:acme/api is:pr created:>=2026-11-10T09:00:00Z promote")}&per_page=1`, {
    total_count: 1,
    items: [{ html_url: "https://github.com/acme/api/pull/77" }],
  });
  const found = { kind: "pr_found", repo: "acme/api", search: "promote" } as const;
  assert.deepEqual(await readProbe(found, ports, { since: "2026-11-10T09:00:00.000Z" }), { kind: "true", observed: "https://github.com/acme/api/pull/77" });
  assert.equal((await readProbe(found, ports)).kind, "unreadable", "an unbounded search could count yesterday's PR");
  assert.equal((await readProbe({ kind: "run_ok", repo: "acme/api" }, ports)).kind, "unreadable", "no run id before the owner's line");
  assert.equal((await readProbe({ kind: "pr_merged", pr: "acme/api#1" }, ports)).kind, "unreadable", "a gh error is not false");
});

test("a private repo's verify is asked under the spelling watch.repos gives, not the lowercase ref", async () => {
  const w = ownerWorld();
  const ports = { orca: w.orca, gh: w.ghClient, repos: ["Acme/Private-API"] };
  w.gh.set("repos/Acme/Private-API/pulls/9", { merged: true, merge_commit_sha: "abc1234" });
  w.gh.set("repos/Acme/Private-API/actions/runs/5", { status: "completed", conclusion: "success" });
  assert.deepEqual(await readProbe({ kind: "pr_merged", pr: "acme/private-api#9" }, ports), { kind: "true", observed: "acme/private-api#9 merged abc1234" });
  assert.equal((await readProbe({ kind: "run_ok", repo: "acme/private-api", run: "5" }, ports)).kind, "true");
  assert.ok(w.ghCalls.every((c) => !c.includes("acme/private-api")), "no GitHub call under the lowercase spelling");
});

test("pr_found is bounded by the item's creation, not by when the hook wrote the mark", async () => {
  const w = ownerWorld();
  w.item(T, { verify: { kind: "pr_found", repo: "acme/api", search: "promote" }, cmdHint: "gh workflow run promote.yml" });
  w.at(later(T0, 5));
  const line = { uuid: "u1", command: "gh workflow run promote.yml -R acme/api", exitCode: 0, stdout: "", stderr: "", repo: "acme/api", ts: later(T0, 1) };
  recordShellLink(w.store, line, linkShell(w.input(), w.facts(), line));
  assert.deepEqual(
    probeTargets(w.input(), w.facts()).map((t) => t.since),
    [T0],
  );
});

test("gh_budget below 10%: gh probes are skipped and nothing is written; Orca probes still run", async () => {
  const w = ownerWorld();
  w.item(T, { verify: { kind: "pr_merged", pr: "acme/api#40" } });
  w.item("task_000000000002", { verify: { kind: "plugin_approved", key: "local.sangsoe" } });
  w.plugins.push({ pluginKey: "local.sangsoe", name: "sangsoe", version: "0.1.0", consentFingerprint: "fp1", status: "enabled", isDev: true, needsReconsent: false });
  const r = await probeRound({ orca: w.orca, gh: w.ghClient, budget: { resource: "core", limit: 5000, remaining: 100, resetAt: 0 } }, w.store, w.input(), w.facts());
  assert.deepEqual(r.skipped, [T]);
  assert.deepEqual(r.passed, ["task_000000000002"]);
  assert.deepEqual(w.ghCalls, []);
  assert.deepEqual(ownerTodoFrom(w.input(), w.facts()).map((x) => x.ref), ["i001"]);
});
