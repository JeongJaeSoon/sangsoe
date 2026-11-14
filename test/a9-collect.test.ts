// Probe A9 collector (decision 261): joins Orca inbox rows to session transcripts and applies the approved pass rule.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { collect, type InboxRow, MAX_LATENCY_S, MAX_MIDTURN_S, type Row, table, verdict } from "../scripts/a9-collect.ts";

const T0 = Date.parse("2026-11-15T01:00:00Z");
const iso = (s: number) => new Date(T0 + s * 1000).toISOString();

const prompt = (s: number) => ({ type: "user", timestamp: iso(s), message: { role: "user", content: "go" } });
const wake = (s: number) => ({ type: "user", timestamp: iso(s), message: { role: "user", content: "You have 1 orchestration message. Run `orca orchestration check`." } });
const tool = (s: number) => ({ type: "assistant", timestamp: iso(s), message: { content: [{ type: "tool_use", name: "Bash" }], stop_reason: "tool_use" } });
const result = (s: number, text: string) => ({ type: "user", timestamp: iso(s), message: { content: [{ type: "tool_result", content: text }] } });
const done = (s: number) => ({ type: "assistant", timestamp: iso(s), message: { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" } });

function withFiles<T>(files: unknown[][], fn: (paths: string[]) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "a9-test-"));
  try {
    const paths = files.map((lines, i) => {
      const p = join(dir, `t${i}.jsonl`);
      writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n"));
      return p;
    });
    return fn(paths);
  } finally {
    rmSync(dir, { recursive: true });
  }
}

const one = (rows: Row[]): Row => {
  assert.equal(rows.length, 1);
  return rows[0] as Row;
};
const row = (id: string, s: number, read: number | null): InboxRow => ({ id, subject: "A9 probe", createdAt: iso(s), readAt: read === null ? null : iso(read) });

test("idle send: latency is the first tool call after delivery", () => {
  withFiles([[wake(5), tool(12), done(20)]], (p) => {
    const r = one(collect([row("m1", 4, 6)], p));
    assert.equal(r.kind, "idle");
    assert.equal(r.outcome, "woken");
    assert.equal(r.latencyS, 8);
  });
});

test("unread send is a failure with no latency", () => {
  withFiles([[prompt(0), done(1)]], (p) => {
    const r = one(collect([row("m1", 4, null)], p));
    assert.equal(r.outcome, "unread");
    assert.equal(r.latencyS, null);
  });
});

test("read but no tool call afterwards is no-action", () => {
  withFiles([[wake(5), done(9)]], (p) => {
    const r = one(collect([row("m1", 4, 6)], p));
    assert.equal(r.outcome, "no-action");
  });
});

test("send inside an open turn is mid-turn and is timed from the turn end", () => {
  withFiles([[prompt(0), tool(10), done(40), wake(41), tool(70), done(80)]], (p) => {
    const r = one(collect([row("m1", 20, 41)], p));
    assert.equal(r.kind, "mid-turn");
    assert.equal(r.outcome, "woken");
    assert.equal(r.latencyS, 30);
  });
});

test("two transcript files (a compaction split) are joined in time order", () => {
  withFiles([[wake(5), done(6)], [tool(9), done(10)]], (p) => {
    const r = one(collect([row("m1", 4, 6)], p));
    assert.equal(r.outcome, "woken");
    assert.equal(r.latencyS, 5);
  });
});

test("the message id in two tool results is a duplicate", () => {
  withFiles([[wake(5), tool(6), result(7, "msg id m1"), result(30, "msg id m1"), done(31)]], (p) => {
    const r = one(collect([row("m1", 4, 6)], p));
    assert.equal(r.outcome, "duplicate");
  });
});

test("limits: exactly the maximum passes, one second over is slow (idle and mid-turn)", () => {
  withFiles([[wake(1), tool(MAX_LATENCY_S), done(MAX_LATENCY_S + 1)]], (p) => {
    assert.equal(one(collect([row("m1", 0, 1)], p)).outcome, "woken");
  });
  withFiles([[wake(1), tool(MAX_LATENCY_S + 1), done(MAX_LATENCY_S + 2)]], (p) => {
    assert.equal(one(collect([row("m1", 0, 1)], p)).outcome, "slow");
  });
  withFiles([[prompt(0), done(100), wake(101), tool(100 + MAX_MIDTURN_S), done(200)]], (p) => {
    assert.equal(one(collect([row("m1", 50, 101)], p)).outcome, "woken");
  });
  withFiles([[prompt(0), done(100), wake(101), tool(101 + MAX_MIDTURN_S), done(200)]], (p) => {
    assert.equal(one(collect([row("m1", 50, 101)], p)).outcome, "slow");
  });
});

test("subject prefix drops unrelated mail", () => {
  withFiles([[wake(5), tool(6), done(7)]], (p) => {
    const other: InboxRow = { id: "x", subject: "other", createdAt: iso(4), readAt: iso(6) };
    assert.equal(collect([other, row("m1", 4, 6)], p, "A9 probe").length, 1);
  });
});

test("verdict passes only when every send is woken", () => {
  const ok = { id: "a", createdAt: 0, kind: "idle" as const, outcome: "woken" as const, latencyS: 3 };
  assert.equal(verdict([ok, ok]).pass, true);
  assert.equal(verdict([ok, { ...ok, outcome: "slow" }]).pass, false);
  assert.equal(verdict([]).pass, false);
  assert.match(table([ok]), /pass=true/);
});

test("the collector never writes: no write call in its source", () => {
  const src = readFileSync(new URL("../scripts/a9-collect.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /writeFile|appendFile|mkdir|createWriteStream|sqlite|execFile|spawn/);
});
