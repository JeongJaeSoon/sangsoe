// The seven named REAPER scenarios (split §2 U18; switch conditions R1–R7). Each one also asserts
// what must not happen: no terminal closed, no forced removal, no Docker prune or label selection.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { judgeStall, recordResource, resourceRecord } from "../../core/index.ts";
import {
  assertNeverForbidden,
  CONFIG,
  card,
  dropScratch,
  finishedCard,
  MIN,
  makeRepo,
  rounds,
  worker,
  world,
} from "./harness.ts";

after(dropScratch);

const rms = (w: ReturnType<typeof world>) => w.orca.calls.filter((c) => c.startsWith("worktreeRm"));

test("reap_roots_fail_no_sweep: one unreadable root skips candidates and sweep", async () => {
  for (const broken of ["workerList", "worktreePs", "gh"] as const) {
    const w = world();
    finishedCard(w, `roots-${broken}`);
    if (broken === "gh") w.gh.down = true;
    else w.orca.failing.add(broken);
    const last = await rounds(w, 4, 30);
    assert.equal(last.roots_ok, false, broken);
    assert.deepEqual(rms(w), [], `${broken}: nothing removed`);
    assert.deepEqual(w.types("reap_candidate"), [], `${broken}: no candidate rows`);
    assert.ok(w.types("reap_round").every((r) => r.roots_ok === false));
    assert.equal(w.types("reap_round").length, 4);
    assertNeverForbidden(w);
  }
});

test("no reaper section: rounds are mark_only, not failed roots, and three of them raise no timer_stalled (M3)", async () => {
  const w = world();
  w.config = null;
  finishedCard(w, "default-install");
  const last = await rounds(w, 3, 30);
  assert.equal(last.roots_ok, true);
  assert.equal(last.mark_only, true);
  assert.deepEqual(rms(w), [], "nothing removed");
  assert.deepEqual(w.types("reap_candidate"), [], "no candidate rows");
  assert.ok(w.types("reap_round").every((r) => r.roots_ok === true && r.mark_only === true));
  assert.deepEqual(judgeStall(w.store.events(), w.clock.now, 30 * MIN), []);

  w.gh.down = true;
  await rounds(w, 3, 30);
  assert.deepEqual(
    judgeStall(w.store.events(), w.clock.now, 30 * MIN).map((p) => p.type),
    ["timer_stalled"],
    "a root that really fails still alarms",
  );
});

test("a private repo Orca lists lowercase is asked under its remote's spelling", async () => {
  const w = world();
  w.gh.repo = "Acme/API";
  const c = finishedCard(w, "cased");
  assert.equal(c.projectId, "github:acme/api", "Orca lowercases projectId");
  execFileSync("git", ["-C", c.path, "remote", "add", "origin", "git@github.com:Acme/API.git"]);
  const last = await rounds(w, 3, 30);
  assert.equal(last.roots_ok, true, last.unseen.join("; "));
  assert.deepEqual(rms(w), [`worktreeRm id:${c.id}`]);
  assert.ok(w.gh.paths.every((p) => p.startsWith("repos/Acme/API/")), w.gh.paths.join("\n"));
});

test("reap_two_rounds_grace: a mark_only stretch between two sightings restarts the count", async () => {
  const w = world();
  finishedCard(w, "unconfigured");
  await w.round();
  w.clock.now += 40 * MIN;
  w.config = null;
  await w.round();
  w.config = CONFIG;
  w.clock.now += 40 * MIN;
  await w.round();
  assert.deepEqual(rms(w), [], "the sighting before the mark_only round does not count");
  assert.deepEqual(
    w.types("reap_candidate").map((r) => r.round),
    [1, 3],
  );
});

test("reap_two_rounds_grace: a finished card goes only after two rounds and the grace period", async () => {
  const w = world();
  const c = finishedCard(w, "two-rounds");
  const r1 = await w.round();
  assert.deepEqual(r1.candidates, ["inst-two-rounds"]);
  assert.deepEqual(w.types("reap_candidate"), [{ kind: "worktree", ref: "inst-two-rounds", round: 1, state: "seen" }]);
  assert.deepEqual(rms(w), [], "round 1: first sighting only");

  w.clock.now += 20 * MIN;
  await w.round();
  assert.deepEqual(rms(w), [], "round 2: two rounds, but the 30 minute grace has not passed");

  w.clock.now += 20 * MIN;
  const r3 = await w.round();
  assert.deepEqual(rms(w), [`worktreeRm id:${c.id}`]);
  assert.deepEqual(r3.reaped, ["worktree:inst-two-rounds"]);
  assert.deepEqual(w.types("reap_done"), [{ kind: "worktree", ref: "inst-two-rounds" }]);
  assert.deepEqual(w.types("resource_adopted"), [{ kind: "worktree", ref: "inst-two-rounds", basis: "card list" }]);
  assertNeverForbidden(w);
});

test("reap_two_rounds_grace: a card reached again is cleared and starts over", async () => {
  const w = world();
  const c = finishedCard(w, "cleared");
  await w.round();
  w.clock.now += 40 * MIN;
  w.orca.ps = [{ worktreeId: c.id, hostId: "local", repo: "api", path: c.path, branch: c.branch, isMainWorktree: false, isArchived: false, liveTerminalCount: 1, unverifiableTerminalCount: 0, status: "active", agents: [] }];
  await w.round();
  assert.deepEqual(
    w.types("reap_candidate").map((r) => r.state),
    ["seen", "cleared"],
  );
  w.orca.ps = [];
  w.clock.now += 40 * MIN;
  await w.round();
  assert.deepEqual(rms(w), [], "seen again in round 3: the count restarts");
  w.clock.now += 40 * MIN;
  await w.round();
  assert.equal(rms(w).length, 1);
});

test("reap_two_rounds_grace: pressure shortens the grace to the minimum gap, never past two rounds", async () => {
  const w = world();
  w.load = { load5: 100, cpus: 1 };
  finishedCard(w, "pressed");
  await w.round();
  w.clock.now += 5 * MIN;
  await w.round();
  assert.deepEqual(rms(w), [], "5 minutes is under the 10 minute floor");
  w.clock.now += 10 * MIN;
  await w.round();
  assert.equal(rms(w).length, 1, "15 minutes under pressure is enough");
});

test("reap_two_rounds_grace: quiet is not finished; a card with no PR and no finished Dispatch stays", async () => {
  const w = world();
  const repo = makeRepo("quiet");
  w.orca.cards.push(card("quiet", repo));
  w.gh.known.add(repo.head);
  const last = await rounds(w, 5, 60);
  assert.deepEqual(last.candidates, ["inst-quiet"]);
  assert.deepEqual(rms(w), []);

  const open = world();
  const c = finishedCard(open, "open-pr");
  const pr = open.gh.prs[0];
  assert.ok(pr);
  pr.state = "open";
  pr.merged_at = null;
  await rounds(open, 4, 60);
  assert.deepEqual(rms(open), [], "an open PR is a root");
  assert.equal(open.types("reap_candidate").length, 0);
  assert.ok(c);
});

test("reap_two_rounds_grace: a merged PR that did not carry the card's HEAD is not finished", async () => {
  const w = world();
  const c = finishedCard(w, "moved-on");
  const pr = w.gh.prs[0];
  assert.ok(pr);
  pr.head.sha = "0".repeat(40);
  w.gh.known.add(c.head ?? "");
  await rounds(w, 4, 60);
  assert.deepEqual(rms(w), []);
});

test("reap_uncommitted_blocked: untracked files and unpushed commits stop the removal", async () => {
  const w = world();
  const c = finishedCard(w, "dirty");
  writeFileSync(join(c.path, "notes.txt"), "not committed\n");
  await rounds(w, 3);
  assert.deepEqual(rms(w), []);
  assert.deepEqual(w.types("reap_blocked"), [{ kind: "worktree", ref: "inst-dirty", reason: "uncommitted" }]);

  const u = world();
  const repo = makeRepo("unpushed");
  u.orca.cards.push(card("unpushed", repo));
  u.orca.workers.push(worker(`repo-1::${repo.path}`, { state: "succeeded" }));
  await rounds(u, 3);
  assert.deepEqual(rms(u), []);
  assert.deepEqual(u.types("reap_blocked"), [{ kind: "worktree", ref: "inst-unpushed", reason: "unpushed" }]);
  assert.ok(
    u.gh.paths.some((p) => p.endsWith(`/commits/${repo.head}`)),
    "asks GitHub for HEAD, not the local default branch",
  );

  const p = world();
  const amended = makeRepo("amended");
  p.orca.cards.push(card("amended", amended));
  p.orca.workers.push(worker(`repo-1::${amended.path}`, { state: "succeeded" }));
  const pushed = "f".repeat(40);
  p.gh.known.add(pushed);
  p.gh.messages.set(pushed, "work on amended");
  p.gh.branches.set("amended", pushed);
  await rounds(p, 3);
  assert.deepEqual(rms(p), []);
  assert.deepEqual(p.types("reap_blocked"), [{ kind: "worktree", ref: "inst-amended", reason: "unpushed_other_patch" }]);
  for (const x of [w, u, p]) assertNeverForbidden(x);
});

test("reap_archive_hook_failed: a failed archive hook leaves the card and is handed to a person", async () => {
  const w = world();
  const c = finishedCard(w, "hooked");
  recordResource(w.store, { kind: "container", ref: "c0ffee", owner: "inst-hooked" });
  w.docker.objects.set("c0ffee", { kind: "container", running: false });
  w.orca.rmError = "worktree_archive_hook_failed";
  await rounds(w, 3);
  assert.deepEqual(rms(w), [`worktreeRm id:${c.id}`]);
  assert.deepEqual(w.types("reap_blocked"), [{ kind: "worktree", ref: "inst-hooked", reason: "archive_hook_failed" }]);
  assert.deepEqual(w.types("reap_done"), []);
  assert.deepEqual(
    w.docker.calls.filter((c) => / (inspect|rm) /.test(c)),
    [],
    "no Docker step after a failed removal (the compose read before it is not one)",
  );
  assertNeverForbidden(w);
});

test("reap_docker_order: recorded ids only, stopped containers → volumes → networks → images", async () => {
  const w = world();
  finishedCard(w, "stack");
  const owner = "inst-stack";
  for (const [kind, ref] of [
    ["image", "sha256:img1"],
    ["network", "stack_default"],
    ["volume", "stack_data"],
    ["container", "aaa111"],
    ["container", "bbb222"],
  ] as const) {
    recordResource(w.store, { kind, ref, owner });
    w.docker.objects.set(ref, { kind, running: ref === "bbb222" });
  }
  w.docker.objects.set("unrecorded", { kind: "container", running: false });
  w.docker.objects.set("base-image", { kind: "image" });

  const last = await rounds(w, 3);
  assert.deepEqual(
    w.docker.calls.filter((c) => / rm /.test(c)),
    ["container rm aaa111", "volume rm stack_data", "network rm stack_default", "image rm sha256:img1"],
  );
  assert.ok(w.docker.objects.has("unrecorded") && w.docker.objects.has("base-image"), "unrecorded objects untouched");
  assert.deepEqual(w.types("reap_blocked"), [{ kind: "container", ref: "bbb222", reason: "in_use" }]);
  assert.deepEqual(
    w.types("reap_done").map((r) => `${r.kind}:${r.ref}`),
    ["worktree:inst-stack", "container:aaa111", "volume:stack_data", "network:stack_default", "image:sha256:img1"],
  );
  assert.equal(last.docker_skipped, false);
  const before = w.docker.calls.length;
  await rounds(w, 2);
  assert.equal(w.docker.calls.length, before, "an id handed to a person as in use is never tried again");

  const off = world();
  finishedCard(off, "no-daemon");
  recordResource(off.store, { kind: "volume", ref: "v1", owner: "inst-no-daemon" });
  off.docker.state = "absent";
  const r = await rounds(off, 3);
  assert.equal(r.docker_skipped, true);
  assert.deepEqual(off.docker.calls, ["version --format {{.Server.Version}}"]);
  assert.equal(off.types("reap_round").at(-1)?.docker_skipped, true);

  // Decision 201: once Docker is installed but does not answer, the hold is unknown, not skipped.
  off.docker.state = "down";
  off.docker.calls.length = 0;
  const down = await rounds(off, 1);
  assert.equal(down.docker_skipped, false);
  assert.deepEqual(down.unknown, ["docker: docker version: exit 1"]);
  assert.deepEqual(off.docker.calls, ["version --format {{.Server.Version}}"], "no id is inspected or removed");
  assertNeverForbidden(w);
  assertNeverForbidden(off);
});

test("reap_docker_order: a recorded id already gone closes its record and is not asked about again", async () => {
  const w = world();
  finishedCard(w, "gone");
  recordResource(w.store, { kind: "volume", ref: "gone_data", owner: "inst-gone" });
  await rounds(w, 3);
  assert.deepEqual(w.docker.calls, ["version --format {{.Server.Version}}", "compose ls --all --format json", "volume inspect gone_data"]);
  assert.deepEqual(w.types("resource").at(-1), { action: "released", kind: "volume", owner: "inst-gone", ref: "gone_data" });
  await rounds(w, 2);
  assert.equal(w.docker.calls.length, 3, "a closed record is not swept again");

  const again = recordResource(w.store, { kind: "volume", ref: "gone_data", owner: "inst-next" });
  assert.ok(again.ok && again.value.inserted, "a released name can be recorded again by a new owner");
});

test("resource_record: the same owner recording twice is one row; release frees the name", () => {
  const w = world();
  assert.ok(recordResource(w.store, { kind: "volume", ref: "own_data", owner: "inst-a" }).ok);
  const same = recordResource(w.store, { kind: "volume", ref: "own_data", owner: "inst-a" });
  assert.ok(same.ok && !same.value.inserted);
  const stranger = recordResource(w.store, { kind: "volume", ref: "own_data", owner: "inst-b", action: "released" });
  assert.equal(stranger.ok, false, "only the holder releases");
  assert.ok(recordResource(w.store, { kind: "volume", ref: "own_data", owner: "inst-a", action: "released" }).ok);
  assert.ok(recordResource(w.store, { kind: "volume", ref: "own_data", owner: "inst-b" }).ok, "free after release");
  assert.equal(w.types("resource").length, 3);
});

test("reap_docker_order: a name a second owner also claims is refused and never swept", async () => {
  const w = world();
  finishedCard(w, "first");
  w.docker.objects.set("shared_data", { kind: "volume" });
  assert.ok(recordResource(w.store, { kind: "volume", ref: "shared_data", owner: "inst-first" }).ok);
  const other = recordResource(w.store, { kind: "volume", ref: "shared_data", owner: "inst-second" });
  assert.equal(!other.ok && other.refusal.code, "held_by_other");
  assert.deepEqual(w.types("reap_blocked"), [{ kind: "volume", ref: "shared_data", reason: "in_use" }]);
  for (const owner of ["inst-second", "inst-first"]) {
    const again = recordResource(w.store, { kind: "volume", ref: "shared_data", owner });
    assert.equal(!again.ok && again.refusal.code, "held_by_other", `${owner} cannot take a contested name back`);
  }
  assert.equal(w.types("resource").length, 1);
  await rounds(w, 4);
  assert.equal(rms(w).length, 1, "the first owner's card goes");
  assert.ok(!w.docker.calls.some((c) => c.startsWith("volume")), "the shared volume is not touched");
  assert.ok(w.docker.objects.has("shared_data"));
});

test("reap_docker_order: a compose project two owners record marks every shared name, not only the first", async () => {
  const w = world();
  finishedCard(w, "stack-a");
  let containers = "c1\n";
  const compose: Parameters<typeof resourceRecord>[1] = async (_file, args) => {
    const out = args.includes("ps") ? containers : "data\n";
    return { code: 0, stdout: out, stderr: "" };
  };
  for (const [kind, ref] of [["container", "c1"], ["volume", "P_data"], ["network", "P_default"]] as const) {
    w.docker.objects.set(ref, { kind, running: false });
  }
  assert.ok((await resourceRecord(w.store, compose, { owner: "inst-stack-a", compose: "P" })).ok);
  containers = "c2\n";
  const b = await resourceRecord(w.store, compose, { owner: "inst-stack-b", compose: "P" });
  assert.equal(!b.ok && b.refusal.code, "held_by_other");
  assert.deepEqual(
    w.types("reap_blocked").map((r) => r.ref),
    ["P_data", "P_default"],
  );
  await rounds(w, 4);
  assert.deepEqual(
    w.docker.calls.filter((c) => / rm /.test(c)),
    ["container rm c1"],
    "only the first owner's own container goes",
  );
});

test("reap_docker_order: an inspect that fails without a not-found answer keeps the record", async () => {
  const w = world();
  finishedCard(w, "flaky");
  w.docker.objects.set("flaky_data", { kind: "volume" });
  recordResource(w.store, { kind: "volume", ref: "flaky_data", owner: "inst-flaky" });
  w.docker.inspectError = true;
  const r = await rounds(w, 3);
  assert.ok(r.unknown.includes("volume:flaky_data: inspect failed"));
  assert.equal(w.types("resource").length, 1, "no released row");
  w.docker.inspectError = false;
  await rounds(w, 1);
  assert.ok(!w.docker.objects.has("flaky_data"), "swept once Docker answers");
});

test("reap_two_rounds_grace: a card on no branch is never judged finished from someone else's PR", async () => {
  const w = world();
  const repo = makeRepo("detached");
  w.orca.cards.push(card("detached", repo, { branch: "" }));
  w.gh.prs.push({ number: 7, state: "closed", merged_at: "2026-11-09T00:00:00Z", head: { sha: repo.head, ref: "someone-else" } });
  w.gh.known.add(repo.head);
  const last = await rounds(w, 4, 60);
  assert.deepEqual(rms(w), []);
  assert.ok(last.unseen.some((u) => u.includes("no branch")));
});

test("reap_two_rounds_grace: a failed round between two sightings restarts the count", async () => {
  const w = world();
  finishedCard(w, "interrupted");
  await w.round();
  w.clock.now += 40 * MIN;
  w.gh.down = true;
  await w.round();
  w.gh.down = false;
  w.clock.now += 40 * MIN;
  await w.round();
  assert.deepEqual(rms(w), [], "the sighting before the failed round does not count");
  assert.deepEqual(
    w.types("reap_candidate").map((r) => r.round),
    [1, 3],
  );
  w.clock.now += 40 * MIN;
  await w.round();
  assert.equal(rms(w).length, 1);
});

test("reap_remote_host_once: a non-local card is blocked once, never adopted or removed", async () => {
  const w = world();
  w.orca.remote = ["inst-remote"];
  const last = await rounds(w, 3);
  assert.deepEqual(w.types("reap_blocked"), [{ kind: "worktree", ref: "inst-remote", reason: "remote_host" }]);
  assert.deepEqual(w.types("resource_adopted"), []);
  assert.deepEqual(rms(w), []);
  assert.equal(last.unknown.length, 1);
  assert.equal(w.types("reap_round").at(-1)?.unknown, 1);
});

test("reap_main_worktree_skipped: the main checkout is never adopted, a candidate or removed", async () => {
  const w = world();
  const repo = makeRepo("main");
  const main = card("main", repo, { isMainWorktree: true });
  w.orca.cards.push(main);
  w.gh.prs.push({ number: 1, state: "closed", merged_at: "2026-11-09T00:00:00Z", head: { sha: repo.head, ref: "main" } });
  w.gh.known.add(repo.head);
  // Rows come from Orca's JSON; a row missing the field must not read as "not main".
  w.orca.cards.push({ ...card("unsure", makeRepo("unsure")), isMainWorktree: undefined as unknown as boolean });
  const last = await rounds(w, 3);
  assert.deepEqual(last.candidates, []);
  assert.deepEqual(w.types("resource_adopted"), [], "a row that does not say it is not the main checkout counts as one");
  assert.deepEqual(w.types("reap_candidate"), []);
  assert.deepEqual(rms(w), []);
});

test("protect list, unfinished Dispatch and mark-only keep a finished card", async () => {
  const w = world();
  const c = finishedCard(w, "kept");
  w.config = { protect: [c.branch.replace("refs/heads/", "")], graceMs: 30 * MIN, minGapMs: 10 * MIN };
  await rounds(w, 3);
  assert.deepEqual(rms(w), []);

  const busy = world();
  const b = finishedCard(busy, "busy");
  busy.orca.workers.push(worker(b.id, { state: "ready", liveness: "live" }));
  await rounds(busy, 3);
  assert.deepEqual(rms(busy), []);

  const dry = world();
  finishedCard(dry, "dry");
  await dry.round({ markOnly: true });
  dry.clock.now += 60 * MIN;
  await dry.round({ markOnly: true });
  dry.clock.now += 60 * MIN;
  const r = await dry.round({ markOnly: true });
  assert.deepEqual(rms(dry), []);
  assert.deepEqual(r.targets, ["inst-dry"], "mark-only still reports what it would sweep");
});
