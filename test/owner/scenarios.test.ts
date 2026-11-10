import assert from "node:assert/strict";
import { test } from "node:test";
import {
  awaitingResume,
  countsAsEvidence,
  linkShell,
  ownerDone,
  ownerMarks,
  ownerTodoFrom,
  probeRound,
  recordReleases,
  recordShellLink,
  recordUnreleased,
  type ShellLine,
  unreleasedWaits,
  type VerifySpec,
} from "../../core/index.ts";
import { later, type OwnerWorld, ownerSays, ownerWorld, T0 } from "./world.ts";

// Five of decision 91's seven regression scenarios (the other two are U8's and U10's).

const T = "task_000000000001";
const HINT = "gh workflow run promote-to-production.yml";
const ports = (w: OwnerWorld) => ({ orca: w.orca, gh: w.ghClient });
const todo = (w: OwnerWorld) => ownerTodoFrom(w.input(), w.facts());
const mark = (w: OwnerWorld, task = T) => ownerMarks(w.input(), { waitMinutes: 30 }).get(task)?.mark ?? null;

function bang(w: OwnerWorld, o: Partial<ShellLine> = {}) {
  const l: ShellLine = {
    uuid: `u-${w.store.events().length}`,
    command: `${HINT} -R acme/api -f ref=main`,
    exitCode: 0,
    stdout: "https://github.com/acme/api/actions/runs/111\n",
    stderr: "",
    repo: "acme/api",
    ts: w.now,
    ...o,
  };
  const link = linkShell(w.input(), w.facts(), l);
  recordShellLink(w.store, l, link);
  return link;
}

function wait(w: OwnerWorld, session: string, tool?: string) {
  return w.store.append({ type: "waiting_human", source: "hook:notification", payload: { session, ...(tool ? { tool } : {}) }, entity: "task", entity_id: T });
}

test("waiting_human_released: only a resumed session or the button releases; the owner's words only mark", () => {
  const w = ownerWorld();
  w.item(T, { who: "lead:api", status: "dispatched" });
  const a = wait(w, "s1", "Bash");
  ownerSays(w, "그래 실행해", "s1");
  assert.deepEqual(awaitingResume(w.input()), [a.seq], "입력 확인됨 · 재개 대기");
  assert.equal(w.store.events().filter((e) => e.type === "waiting_released").length, 0, "the owner's words release nothing");

  assert.deepEqual(recordReleases(w.store, w.input(), { kind: "tool", session: "s1", tool: "Edit" }), [], "another tool does not release it");
  const [r] = recordReleases(w.store, w.input(), { kind: "tool", session: "s1", tool: "Bash" });
  assert.ok(r?.inserted);
  const rel = w.store.events().filter((e) => e.type === "waiting_released");
  assert.equal(rel.length, 1);
  assert.deepEqual(rel[0]?.payload, { ref: String(a.seq), outcome: "answered", by: "owner", evidence: "tool:Bash" });
  assert.deepEqual(recordReleases(w.store, w.input(), { kind: "turn_ended", session: "s1" }), [], "one release per wait");

  // Unreleased past waiting.lead_minutes: escalated once, then on owner_todo as the item's row.
  const b = wait(w, "s2");
  assert.deepEqual(unreleasedWaits(w.input(), () => true), []);
  w.at(later(T0, 11));
  const stale = unreleasedWaits(w.input(), () => true);
  assert.deepEqual(stale.map((e) => e.seq), [b.seq]);
  recordUnreleased(w.store, stale[0] ?? assert.fail("no stale wait"), "Allow Bash?");
  assert.deepEqual(unreleasedWaits(w.input(), () => true), []);
  assert.deepEqual(todo(w).map((r) => r.kind), ["waiting_human"]);

  // The session ends: moot, and the row leaves owner_todo.
  recordReleases(w.store, w.input(), { kind: "session_ended", session: "s2", evidence: "session_ended" });
  assert.equal(w.store.events().at(-1)?.payload.outcome, "moot");
  assert.deepEqual(todo(w), []);

  // The panel button names the wait exactly: by=button.
  const c = wait(w, "s3");
  recordReleases(w.store, w.input(), { kind: "button", session: "s3", waiting: c.seq });
  assert.equal(w.store.events().at(-1)?.payload.by, "button");
});

test("non-local waits are neither released nor closed as moot (92 (라))", () => {
  const w = ownerWorld();
  w.item(T, { who: "lead:api", status: "dispatched" });
  wait(w, "remote-s");
  assert.deepEqual(recordReleases(w.store, w.input(), { kind: "agent_wait_gone", session: "remote-s", hostId: "ssh:box" }), []);
  assert.deepEqual(recordReleases(w.store, w.input(), { kind: "session_ended", session: "remote-s", evidence: "worker_dead", hostId: "ssh:box" }), []);
  w.at(later(T0, 60));
  assert.deepEqual(unreleasedWaits(w.input(), (s) => s !== "remote-s"), []);
  assert.equal(w.store.events().filter((e) => e.type === "waiting_released" || e.type === "escalation_stale").length, 0);
});

test("owner_item_probe_closes: a merge seen by the probe takes the item out with no chat line", async () => {
  const w = ownerWorld();
  const verify: VerifySpec = { kind: "pr_merged", pr: "acme/api#40" };
  w.item(T, { verify });
  assert.equal(todo(w).length, 1);
  w.gh.set("repos/acme/api/pulls/40", { merged: false });
  await probeRound(ports(w), w.store, w.input(), w.facts());
  assert.equal(todo(w).length, 1, "not merged yet: stays");
  w.gh.set("repos/acme/api/pulls/40", { merged: true, merge_commit_sha: "abc1234" });
  await probeRound(ports(w), w.store, w.input(), w.facts());
  assert.equal(todo(w).length, 0);
  const types = w.store.events().map((e) => `${e.type}:${e.payload.kind ?? e.payload.reason ?? ""}`);
  assert.ok(types.includes("evidence:probe:pr_merged"));
  assert.ok(types.includes("close_suggested:verified"));
  assert.equal(w.state(T), "ready", "the holder closes it, not the probe");

  // The button first: ⏳ 검증 대기 (decision 181), then the probe's merge makes it ✅.
  const v = ownerWorld();
  v.item(T, { verify });
  const r = await ownerDone({ orca: v.orca, store: v.store }, v.input(), v.facts(), { task: T });
  assert.ok(r.ok && r.value.pendingVerify);
  assert.equal(v.state(T), "pending_verify");
  assert.equal(v.store.events().filter(countsAsEvidence).length, 0, "the button is not evidence when a verify exists");
  v.gh.set("repos/acme/api/pulls/40", { merged: true, merge_commit_sha: "abc1234" });
  v.at(later(T0, 60));
  await probeRound(ports(v), v.store, v.input(), v.facts());
  assert.equal(v.store.events().filter(countsAsEvidence).length, 1);
  assert.equal(v.state(T), "done");
  assert.equal(v.store.events().filter((e) => e.type === "close_suggested").length, 0, "a pressed item gets no close suggestion");

  // No verify: the button is the evidence.
  const n = ownerWorld();
  n.item(T, {});
  const nr = await ownerDone({ orca: n.orca, store: n.store }, n.input(), n.facts(), { task: T });
  assert.ok(nr.ok && !nr.value.pendingVerify);
  assert.equal(n.store.events().filter(countsAsEvidence).length, 1);
});

test("owner_ran_command_marks_verifying: the real case, end to end", async () => {
  const w = ownerWorld();
  w.item(T, { verify: { kind: "run_ok", repo: "acme/api" }, cmdHint: HINT });
  const before = todo(w).length;
  assert.equal((await probeRound(ports(w), w.store, w.input(), w.facts())).read, 0, "run_ok is not read before a mark");
  assert.equal(bang(w).kind, "seen");
  assert.equal(mark(w), "verifying");
  assert.equal(w.state(T), "ready");
  assert.equal(todo(w).length, before, "a mark is not a state");

  w.gh.set("repos/acme/api/actions/runs/111", { status: "completed", conclusion: "success" });
  const r = await probeRound(ports(w), w.store, w.input(), w.facts());
  assert.deepEqual(r.passed, [T]);
  assert.equal(todo(w).length, before - 1);
  // The holder closes on the suggestion: ✅.
  await w.orca.taskUpdate({ id: T, status: "completed" });
  w.store.append({ type: "item_transition", source: "mcp:lead", payload: { task: T, from: "ready", to: "done", reason: "close_suggested verified" }, entity: "task", entity_id: T });
  assert.equal(w.state(T), "done");

  // A failing line marks nothing; another workflow or another repo links to nothing.
  const f = ownerWorld();
  f.item(T, { verify: { kind: "run_ok", repo: "acme/api" }, cmdHint: HINT });
  assert.equal(bang(f, { exitCode: 1, stderr: "could not find workflow", stdout: "" }).kind, "failed");
  assert.equal(mark(f), "failed");
  assert.equal(bang(f, { command: "gh workflow run deploy-dev.yml -R acme/api" }).kind, "unlinked");
  assert.equal(bang(f, { command: `${HINT} -R acme/web`, repo: "acme/web" }).kind, "unlinked");
  assert.equal(bang(f, { command: "ls -la" }).kind, "ignored");
  assert.equal(f.store.events().filter((e) => e.type === "owner_act_unlinked").length, 2);

  // Guard (가): a line older than the item, or one that fits two items, links to neither.
  const two = ownerWorld();
  two.item(T, { verify: { kind: "run_ok", repo: "acme/api" }, cmdHint: HINT });
  two.item("task_000000000002", { verify: { kind: "run_ok", repo: "acme/api" }, cmdHint: HINT });
  assert.equal(bang(two).kind, "unlinked");
  const old = ownerWorld();
  old.at(later(T0, 5));
  old.item(T, { verify: { kind: "run_ok", repo: "acme/api" }, cmdHint: HINT });
  assert.equal(bang(old, { ts: T0 }).kind, "unlinked");

  // Guard (라): the same transcript line read twice is one row.
  const d = ownerWorld();
  d.item(T, { verify: { kind: "run_ok", repo: "acme/api" }, cmdHint: HINT });
  bang(d, { uuid: "same" });
  bang(d, { uuid: "same" });
  assert.equal(d.store.events().filter((e) => e.type === "evidence").length, 1);
});

test("link guards: whole PR number, stderr without an exit code, times not strings, a known repo", () => {
  const p = ownerWorld();
  p.item(T, { verify: { kind: "pr_merged", pr: "acme/api#4" } });
  assert.equal(bang(p, { command: "gh pr merge https://github.com/acme/api/pull/40" }).kind, "unlinked", "#40 is not #4");
  assert.equal(bang(p, { command: "gh pr merge https://github.com/acme/api/pull/4 --squash" }).kind, "seen");
  const u = ownerWorld();
  u.item(T, { verify: { kind: "pr_merged", pr: "acme/api#4" } });
  assert.equal(bang(u, { command: "gh pr merge https://github.com/acme/api/pull/4", repo: null }).kind, "seen", "the PR URL names the repo the hook does not know");
  assert.equal(bang(u, { command: "gh pr merge https://github.com/acme/web/pull/4", repo: "acme/api" }).kind, "unlinked", "a URL to another repo is not this PR");

  const s = ownerWorld();
  s.item(T, { verify: { kind: "run_ok", repo: "acme/api" }, cmdHint: HINT });
  assert.equal(bang(s, { exitCode: null, stderr: "HTTP 422: Unprocessable" }).kind, "failed");
  assert.equal(bang(s, { exitCode: null }).kind, "seen", "no exit code: the expected run URL links");

  const t = ownerWorld();
  t.at(later(T0, 5));
  t.item(T, { verify: { kind: "run_ok", repo: "acme/api" }, cmdHint: HINT });
  assert.equal(bang(t, { ts: "2026-11-10T18:03:00+09:00" }).kind, "unlinked", "09:03Z is before the item");
  assert.equal(bang(t, { ts: "not a time" }).kind, "unlinked", "an unreadable time does not pass guard (가)");

  const r = ownerWorld();
  r.item(T, { verify: { kind: "run_ok", repo: "acme/api" }, cmdHint: HINT });
  assert.equal(bang(r, { command: HINT, repo: null }).kind, "unlinked", "the item names a repo; the line's is unknown");
});

test("owner_input_probe_fails_no_change: input plus a failing probe leaves state and counts as they were", async () => {
  const w = ownerWorld();
  w.item(T, { verify: { kind: "run_ok", repo: "acme/api" }, cmdHint: HINT });
  const before = { state: w.state(T), todo: todo(w).map((r) => r.ref) };
  ownerSays(w, "i001 돌렸어");
  bang(w);
  w.gh.set("repos/acme/api/actions/runs/111", { status: "completed", conclusion: "failure" });
  await probeRound(ports(w), w.store, w.input(), w.facts());
  assert.deepEqual({ state: w.state(T), todo: todo(w).map((r) => r.ref) }, before);
  assert.equal(mark(w), "verifying");
  assert.equal(w.store.events().filter((e) => e.type === "escalation_stale").length, 0, "not before wait_minutes");

  w.at(later(T0, 31));
  const r = await probeRound(ports(w), w.store, w.input(), w.facts());
  assert.deepEqual(r.escalated, [T]);
  assert.equal(mark(w), "unverified");
  assert.deepEqual({ state: w.state(T), todo: todo(w).map((r) => r.ref) }, before);
  w.at(later(T0, 45));
  assert.deepEqual((await probeRound(ports(w), w.store, w.input(), w.facts())).escalated, [], "escalated once");
  assert.equal(w.store.events().filter((e) => e.type === "escalation_stale" && e.payload.reason === "verify_unconfirmed").length, 1);

  // An unreadable probe (gh 404, rate limit) is not false either: nothing written.
  const u = ownerWorld();
  u.item(T, { verify: { kind: "plugin_approved", key: "local.sangsoe" } });
  const n = u.store.events().length;
  await probeRound({ orca: { ...u.orca, pluginList: async () => ({ ok: false, error: { code: "orca_down", message: "x" } }) }, gh: u.ghClient }, u.store, u.input(), u.facts());
  assert.equal(u.store.events().length, n);
});

test("no chat line alone reduces owner_todo or marks ✅", async () => {
  const w = ownerWorld();
  w.item(T, { verify: { kind: "pr_merged", pr: "acme/api#40" }, cmdHint: "gh pr merge 40" });
  w.item("task_000000000002", {});
  const before = todo(w);
  for (const text of ["i001 했다", "다 했어", "i002 완료", "머지했어 https://github.com/acme/api/pull/40", "d999 좋아", "아직"]) ownerSays(w, text);
  assert.deepEqual(todo(w), before);
  assert.equal(w.store.events().filter(countsAsEvidence).length, 0);
  assert.equal(w.store.events().filter((e) => e.type === "item_transition").length, 0);
  assert.deepEqual(
    w.facts().map((f) => f.state),
    ["ready", "ready"],
  );
});
