import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fixedClock } from "../contract/index.ts";
import { Store } from "../store/store.ts";
import type { Exec } from "./approve.ts";
import { nodePorts } from "./ports.ts";
import { recordReviewVerdict, reviewEvidenceFrom } from "./review-verdict.ts";

const HEAD = "b".repeat(40);
const tmp = mkdtempSync(join(tmpdir(), "sangsoe-verdict-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const storeAt = () => {
  const path = join(tmp, `v${n++}.db`);
  return () => Store.open({ path, clock: fixedClock("2026-11-10T00:00:00.000Z", 1000), fsProbe: () => "apfs" });
};
const ghAuthor =
  (login: string, code = 0, head = HEAD): Exec =>
  async (cmd, args) => {
    assert.deepEqual([cmd, ...args], ["gh", "api", "repos/acme/api/pulls/7", "--jq", "[.user.login, .head.sha] | @tsv"]);
    return { code, stdout: code === 0 ? `${login}\t${head}\n` : "", stderr: code === 0 ? "" : "not found" };
  };
const input = { repo: "acme/api", pr: 7, head: HEAD, actOn: 0, reviewer: "codex" };

test("review record writes one review_verdict with the author read from GitHub", async () => {
  const openStore = storeAt();
  const first = await recordReviewVerdict(input, { exec: ghAuthor("alice"), openStore });
  assert.deepEqual([first.ok, first.inserted, first.author], [true, true, "alice"]);
  const again = await recordReviewVerdict({ ...input, reviewer: "Codex" }, { exec: ghAuthor("Alice"), openStore });
  assert.deepEqual([again.ok, again.inserted], [true, false], "the same verdict again stands, whatever the case");
  const worse = await recordReviewVerdict({ ...input, actOn: 3 }, { exec: ghAuthor("alice"), openStore });
  assert.deepEqual([worse.ok, worse.inserted], [true, true], "S2: another count is a second row, never dropped");
  const s = openStore();
  const rows = s.events({ type: "review_verdict" });
  s.close();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0]?.payload, { pr: "acme/api#7", head_sha: HEAD, act_on: 0, reviewer: "codex", author: "alice" });
  assert.equal(rows[0]?.dedupe_key, `review_verdict:acme%2Fapi%237:${HEAD}:codex:0`);
  assert.equal(reviewEvidenceFrom(rows, "acme/api", 7, HEAD)?.actOn, 3, "the row with findings is the one read");
});

test("review record refuses the PR's author as reviewer, an unreadable PR and a short head; nothing is written", async () => {
  const openStore = storeAt();
  const self = await recordReviewVerdict({ ...input, reviewer: "Alice" }, { exec: ghAuthor("alice"), openStore });
  assert.equal(self.ok, false);
  assert.match(self.note, /is the author/);
  const gone = await recordReviewVerdict(input, { exec: ghAuthor("alice", 1), openStore });
  assert.match(gone.note, /cannot read acme\/api#7/);
  const padded = await recordReviewVerdict({ ...input, reviewer: "alice " }, { exec: ghAuthor("alice"), openStore });
  assert.match(padded.note, /reviewer must be a login or name/, "padding cannot dodge the author check");
  const future = await recordReviewVerdict({ ...input, head: "c".repeat(40) }, { exec: ghAuthor("alice"), openStore });
  assert.match(future.note, /is not the head of acme\/api#7/, "a head the PR does not point at, stale or not yet pushed, is refused");
  const short = await recordReviewVerdict({ ...input, head: "abc1234" }, { exec: ghAuthor("alice"), openStore });
  assert.match(short.note, /full 40-character sha/);
  const negative = await recordReviewVerdict({ ...input, actOn: -1 }, { exec: ghAuthor("alice"), openStore });
  assert.match(negative.note, /act-on must be a count/);
  const s = openStore();
  assert.equal(s.events({ type: "review_verdict" }).length, 0);
  assert.throws(
    () =>
      s.append({
        type: "review_verdict",
        source: "review record",
        dedupe_key: `review_verdict:acme%2Fapi%237:${HEAD}:alice`,
        payload: { pr: "acme/api#7", head_sha: HEAD, act_on: 0, reviewer: "alice", author: "alice" },
      }),
    /author cannot review it/,
    "the contract refuses it too",
  );
  assert.throws(
    () =>
      s.append({
        type: "review_verdict",
        source: "lead:x",
        dedupe_key: `review_verdict:acme%2Fapi%237:${HEAD}:codex`,
        payload: { pr: "acme/api#7", head_sha: HEAD, act_on: 0, reviewer: "codex", author: "alice" },
      }),
    /only by review record/,
    "and any writer but review record",
  );
  s.close();
});

test("approve's evidence: a head with any Act-on verdict fails, other heads and PRs do not count", async () => {
  const openStore = storeAt();
  await recordReviewVerdict(input, { exec: ghAuthor("alice"), openStore });
  const s = openStore();
  const events = s.events({ type: "review_verdict" });
  s.close();
  assert.deepEqual(reviewEvidenceFrom(events, "acme/api", 7, HEAD), { headSha: HEAD, actOn: 0, reviewer: "codex", author: "alice" });
  assert.equal(reviewEvidenceFrom(events, "acme/api", 7, "c".repeat(40)), null);
  assert.equal(reviewEvidenceFrom(events, "acme/api", 8, HEAD), null);
  await recordReviewVerdict({ ...input, reviewer: "claude", actOn: 2 }, { exec: ghAuthor("alice"), openStore });
  const s2 = openStore();
  const both = s2.events({ type: "review_verdict" });
  s2.close();
  assert.equal(reviewEvidenceFrom(both, "Acme/API", 7, HEAD)?.actOn, 2, "repo case does not matter; the Act-on verdict wins");
});

test("the node ports read evidence from and record plugin_approved into the store", async () => {
  const openStore = storeAt();
  await recordReviewVerdict(input, { exec: ghAuthor("alice"), openStore });
  const lines: string[] = [];
  const ports = nodePorts((l) => lines.push(l), openStore);
  assert.equal((await ports.reviewEvidence("acme/api", 7, HEAD))?.reviewer, "codex");
  const ledger = await ports.openLedger();
  await ledger.record({ type: "plugin_approved", key: "local.sangsoe", version: "0.1.0", fingerprint: "ap1-0", commit: "a".repeat(40), at: 1000 });
  ledger.close();
  const s = openStore();
  const [row] = s.events({ type: "plugin_approved" });
  s.close();
  assert.deepEqual(row?.payload, { key: "local.sangsoe", version: "0.1.0", fingerprint: "ap1-0", commit: "a".repeat(40), at: 1000 });
  assert.equal(row?.source, "plugin approve");

  const broken = nodePorts(
    (l) => lines.push(l),
    () => {
      throw new Error("refused: nfs");
    },
  );
  assert.equal(await broken.reviewEvidence("acme/api", 7, HEAD), null, "no store, no evidence: condition (1) fails closed");
  assert.ok(lines.some((l) => l.includes("refused: nfs")));
  await assert.rejects(broken.openLedger(), /refused: nfs/, "a ledger that cannot open throws before any enable");
});
