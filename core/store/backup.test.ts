import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { dedupeKey, EVENTS, fixedClock } from "../contract/index.ts";
import { backupPath, HOST_TYPES, OWN_TYPES, readBackup } from "./backup.ts";
import { holdStore } from "./held.ts";
import { HOST_WINDOW_LOST, LOST_SEPARATOR, Store, StoreReplaced } from "./store.ts";

const T0 = "2026-11-11T00:00:00.000Z";
const tmp = mkdtempSync(join(tmpdir(), "sangsoe-backup-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const local = () => "apfs";
let n = 0;
const newPath = () => join(tmp, `b${n++}.db`);
const open = (path: string) => Store.open({ path, clock: fixedClock(T0, 1000), fsProbe: local });

const decisionOpened = (no: string, k: string) =>
  ({ type: "decision_opened", source: "test", dedupe_key: dedupeKey(EVENTS.decision_opened, k), payload: { decision: no, decision_key: k } }) as const;
const prOpened = (ref: string) => ({ type: "pr_opened", source: "pr-monitor", dedupe_key: dedupeKey(EVENTS.pr_opened, ref), payload: { pr: ref } }) as const;

function lose(path: string): void {
  rmSync(path);
}

test("every event type is either an own fact or a host row, never both", () => {
  const own = new Set<string>(OWN_TYPES);
  const host = new Set<string>(HOST_TYPES);
  assert.deepEqual([...own].filter((t) => host.has(t)), []);
  assert.deepEqual(Object.keys(EVENTS).filter((t) => !own.has(t) && !host.has(t)), [], "classify each new type in core/store/backup.ts");
  assert.deepEqual([...own, ...host].filter((t) => !Object.hasOwn(EVENTS, t)), []);
});

test("own facts and issued numbers survive the loss of the database; host rows do not come from the backup", () => {
  const path = newPath();
  const s = open(path);
  const d = s.allocate("d");
  const a = s.appendOwnerAction(
    { type: "owner_action", source: "hook", payload: { origin: "chat", summary: "answer", hash: "h1" } },
    "masked text",
  );
  const opened = s.append(decisionOpened(d, "q2"));
  s.append({ type: "decision_answered", source: "hook", payload: { decision: d, owner_action: a.seq, answer: "pause and catch up", linked_by: "hook" } });
  s.append({ type: "evidence", source: "test", subject: "acme/api#7", payload: { kind: "e2e", exit_code: 0 } });
  s.append(prOpened("acme/api#7"));
  const before = s.events();
  s.close();
  lose(path);
  // A crash leaves the -wal and -shm of the lost file behind.
  writeFileSync(`${path}-wal`, "stale");
  writeFileSync(`${path}-shm`, "stale");

  const r = open(path);
  assert.ok(r.rebuilt, "the open reports that it rebuilt");
  assert.equal(r.rebuilt.restored, 4);
  assert.ok(r.rebuilt.setAside.some((p) => p.startsWith(`${path}-wal.orphan-`)), "the stale WAL is moved aside, not replayed");
  const after = r.events();
  const own = before.filter((e) => e.type !== "pr_opened");
  assert.deepEqual(
    after.slice(0, own.length).map((e) => [e.seq, e.ts, e.type, e.dedupe_key, e.payload]),
    own.map((e) => [e.seq, e.ts, e.type, e.dedupe_key, e.payload]),
    "seq, ts and payload are kept, so rows that point at a seq still point at the right row",
  );
  assert.equal(after.filter((e) => e.type === "pr_opened").length, 0, "host rows are the readers' to write again");
  assert.equal(opened.seq, after.find((e) => e.type === "decision_opened")?.seq);
  assert.equal(r.allocate("d"), "d002", "a number is never issued twice");
  assert.equal(r.ownerText(a.seq), undefined, "owner text is never copied");
  const sig = after.find((e) => e.type === "signal");
  assert.equal(sig?.payload.kind, "store_rebuilt");
  const lost = String(sig?.payload.reason).split(LOST_SEPARATOR);
  assert.deepEqual(lost, r.rebuilt.lost);
  assert.ok(lost.some((l) => l.startsWith("owner_text: the masked text of 1 owner_action row")));
  assert.ok(lost.includes(HOST_WINDOW_LOST));
  r.close();

  const again = open(path);
  assert.equal(again.rebuilt, null, "an intact database is not restored twice");
  again.close();
});

test("a host type written by anyone but its reader is copied, since no reader writes it again", () => {
  const path = newPath();
  const s = open(path);
  s.append({ type: "worker_dead", source: "start", entity: "dispatch", entity_id: "ctx_1", payload: { reason: "start_failed" } });
  s.append({ type: "worker_dead", source: "orca-monitor", entity: "dispatch", entity_id: "ctx_2", payload: { reason: "host_restart" } });
  s.close();
  lose(path);
  const r = open(path);
  assert.deepEqual(
    r.events({ type: "worker_dead" }).map((e) => e.source),
    ["start"],
    "the start's row comes back; the reader's row is the reader's to write again",
  );
  r.close();
});

test("a database another connection has locked is never moved aside", () => {
  const path = newPath();
  open(path).close();
  const holder = new DatabaseSync(path);
  holder.exec("PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE;");
  try {
    assert.throws(() => Store.open({ path, clock: fixedClock(T0, 1000), fsProbe: local, busyTimeoutMs: 50 }), /locked|busy/i);
    assert.deepEqual(
      readdirSync(tmp).filter((f) => f.includes(".unreadable-")),
      [],
      "a lock is not damage",
    );
  } finally {
    holder.exec("COMMIT");
    holder.close();
  }
  const again = open(path);
  assert.equal(again.rebuilt, null);
  again.close();
});

test("an unreadable database file is moved aside and rebuilt from the backup", () => {
  const path = newPath();
  const s = open(path);
  s.append(decisionOpened("d001", "k1"));
  s.close();
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });
  writeFileSync(path, "this is not a sqlite database, only text of the same length and more ".repeat(100));
  const r = open(path);
  assert.ok(r.rebuilt);
  assert.equal(r.rebuilt.restored, 1);
  assert.ok(r.rebuilt.setAside.some((p) => p.startsWith(`${path}.unreadable-`)));
  assert.ok(existsSync(r.rebuilt.setAside[0] ?? ""), "the damaged file is kept");
  r.close();
});

test("a torn backup line is named, and the rest is restored", () => {
  const path = newPath();
  const s = open(path);
  s.append(decisionOpened("d001", "k1"));
  s.close();
  appendFileSync(backupPath(path), '{"row":{"seq":9,');
  lose(path);
  const r = open(path);
  assert.equal(r.rebuilt?.restored, 1);
  assert.ok(r.rebuilt?.lost.some((l) => /^backup line 2: not JSON/.test(l)));
  r.close();
});

test("a fact whose copy cannot be written is rolled back with it", () => {
  const path = newPath();
  const s = open(path);
  rmSync(backupPath(path));
  mkdirSync(backupPath(path));
  assert.throws(() => s.append(decisionOpened("d001", "k1")), /EISDIR/);
  assert.equal(s.events().length, 0);
  s.append(prOpened("acme/api#1"));
  assert.equal(s.events().length, 1, "a host row needs no copy");
  s.close();
});

test("a database written before the backup existed is copied on its first open", () => {
  const path = newPath();
  const s = open(path);
  s.append(decisionOpened("d001", "k1"));
  s.allocate("i");
  s.close();
  rmSync(backupPath(path));
  open(path).close();
  const lines = readFileSync(backupPath(path), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.filter((l) => l.row?.type === "decision_opened").length, 1);
  assert.deepEqual(lines.filter((l) => l.counter), [{ counter: "i", last: 1 }]);
  const raw = new DatabaseSync(path);
  assert.equal((raw.prepare("SELECT count(*) AS n FROM event").get() as { n: number }).n, 1, "seeding writes no row");
  raw.close();
});

/** What a build without the backup (v0.1.0-rc.4) does: an own row and a number, with no line in the facts file. */
function oldBuildWrites(path: string, decision: string): void {
  const raw = new DatabaseSync(path);
  raw.prepare("INSERT INTO event (ts, type, source, needs, dedupe_key, schema_v, after) VALUES (?, 'decision_opened', 'old', 'none', ?, 1, ?)").run(
    T0,
    dedupeKey(EVENTS.decision_opened, decision),
    JSON.stringify({ decision, decision_key: decision }),
  );
  raw.prepare("INSERT INTO counter (name, last) VALUES ('d', 7) ON CONFLICT (name) DO UPDATE SET last = 7").run();
  raw.close();
}
const copied = (path: string) =>
  readFileSync(backupPath(path), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { row?: { seq: number; type: string }; counter?: string; last?: number });

test("own rows an older build wrote after the facts file existed are copied on the next open, and only once", () => {
  const path = newPath();
  const s = open(path);
  s.append(decisionOpened("d001", "k1"));
  s.close();
  oldBuildWrites(path, "d007");
  open(path).close();
  const lines = copied(path);
  assert.deepEqual(lines.filter((l) => l.row).map((l) => [l.row?.seq, l.row?.type]), [[1, "decision_opened"], [2, "decision_opened"]]);
  assert.ok(lines.some((l) => l.counter === "d" && l.last === 7), "the number it issued is copied too");
  const once = readFileSync(backupPath(path), "utf8");
  open(path).close();
  assert.equal(readFileSync(backupPath(path), "utf8"), once, "a second open adds nothing");

  lose(path);
  const r = open(path);
  assert.equal(r.rebuilt?.restored, 2, "the older build's row comes back after a loss");
  assert.equal(r.allocate("d"), "d008");
  r.close();
});

test("a connection whose file another opener rebuilt refuses to write, so the facts file keeps one row per seq", () => {
  const path = newPath();
  const held = open(path);
  held.append(decisionOpened("d001", "k1"));
  held.append(decisionOpened("d002", "k2"));
  renameSync(path, `${path}.gone`);
  const second = open(path);
  assert.ok(second.rebuilt, "the next opener rebuilds");
  assert.equal(held.replaced(), true);
  assert.throws(() => held.append(decisionOpened("d003", "k3")), StoreReplaced);
  assert.deepEqual(readBackup(backupPath(path)).skipped, [], "no seq holds two different rows");
  held.close();
  second.close();
  lose(path);
  const third = open(path);
  assert.ok(third.events({ type: "signal" }).some((e) => e.payload.kind === "store_rebuilt"), "the first rebuild's signal survives a second loss");
  third.close();
});

test("a held store reopens before its next use once the file at its path changed, and joins the rebuilt file", async () => {
  const path = newPath();
  const held = holdStore(() => open(path), (s) => s);
  await held.use(async (s) => s.append(decisionOpened("d001", "k1")));
  let inFlight: Store | undefined;
  let release = () => {};
  const slow = held.use(async (s) => {
    inFlight = s;
    await new Promise<void>((r) => {
      release = r;
    });
    return s.events().length;
  });
  renameSync(path, `${path}.gone`);
  const second = open(path);
  assert.ok(second.rebuilt);
  await held.use(async (s) => {
    assert.equal(s.rebuilt, null, "it joins the rebuilt file, it does not rebuild again");
    assert.notEqual(s, inFlight, "each use after the change has the new connection");
    s.append(decisionOpened("d002", "k2"));
  });
  release();
  assert.ok((await slow) > 0, "a use already in flight keeps its connection open to its end");
  assert.ok(second.events().some((e) => e.dedupe_key === dedupeKey(EVENTS.decision_opened, "k2")), "the write reached the file other openers read");
  assert.deepEqual(readBackup(backupPath(path)).skipped, []);
  second.close();
  held.close();

  const alone = newPath();
  const solo = holdStore(() => open(alone), (s) => s);
  await solo.use(async (s) => s.append(decisionOpened("d001", "k1")));
  renameSync(alone, `${alone}.gone`);
  const rebuilt = await solo.use(async (s) => s.rebuilt);
  assert.equal(rebuilt?.restored, 1, "with no other opener, the held store's own reopen rebuilds");
  solo.close();
});

test("an older build's row between two of this build's rows is copied before the later one", () => {
  const path = newPath();
  const s = open(path);
  s.append(decisionOpened("d001", "k1"));
  oldBuildWrites(path, "d007");
  s.append(decisionOpened("d002", "k2"));
  s.close();
  assert.deepEqual(copied(path).filter((l) => l.row).map((l) => l.row?.seq), [1, 2, 3]);
  const again = readFileSync(backupPath(path), "utf8");
  open(path).close();
  assert.equal(readFileSync(backupPath(path), "utf8"), again);
});
