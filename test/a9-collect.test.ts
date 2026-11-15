// Probe A9 collector (decision 261): joins the sender's send results to the probe session's transcript by messageId
// and applies the approved pass rule.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { collect, MAX_LATENCY_S, MAX_MIDTURN_S, type Row, type Send, sends, table, verdict } from "../scripts/a9-collect.ts";

const T0 = Date.parse("2026-11-15T01:00:00Z");
const iso = (s: number) => new Date(T0 + s * 1000).toISOString();

const prompt = (s: number) => ({ type: "user", timestamp: iso(s), message: { role: "user", content: "go" } });
const wake = (s: number) => ({ type: "user", timestamp: iso(s), message: { role: "user", content: "You have 1 orchestration message. Run `orca orchestration check`." } });
const tool = (s: number) => ({ type: "assistant", timestamp: iso(s), message: { content: [{ type: "tool_use", id: `u${s}`, name: "Bash", input: { command: "ls" } }], stop_reason: "tool_use" } });
// A tool_result at `s` answers the tool call made at `call` (default: one second earlier).
const result = (s: number, text: string, call = s - 1) => ({ type: "user", timestamp: iso(s), message: { content: [{ type: "tool_result", tool_use_id: `u${call}`, content: text }] } });
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
const sent = (id: string, s: number): Send => ({ id, sentAt: T0 + s * 1000 });

test("sends: reads the send time and messageId from each log line, skipping lines without both", () => {
  const dir = mkdtempSync(join(tmpdir(), "a9-log-"));
  try {
    const log = join(dir, "sends.log");
    writeFileSync(
      log,
      [
        "1\tidle\tscheduled=2026-11-15T01:21:00+09:00\tsent=2026-11-15T01:21:00+0900\tmessageId=msg_aa11",
        "2\tidle\tscheduled=2026-11-15T03:21:00+09:00\tsent=2026-11-15T03:21:01+0900\terror: dispatch_run_mismatch",
        "",
      ].join("\n"),
    );
    assert.deepEqual(sends(log), [{ id: "msg_aa11", sentAt: Date.parse("2026-11-14T16:21:00Z") }]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("idle send: latency is the first tool call after the send", () => {
  withFiles([[wake(5), tool(12), result(13, "msg_m1 body"), done(20)]], (p) => {
    const r = one(collect([sent("msg_m1", 4)], p));
    assert.equal(r.kind, "idle");
    assert.equal(r.outcome, "woken");
    assert.equal(r.latencyS, 8);
  });
});

test("an id the probe never read is unread", () => {
  withFiles([[prompt(0), done(1)]], (p) => {
    const r = one(collect([sent("msg_m1", 4)], p));
    assert.equal(r.outcome, "unread");
    assert.equal(r.latencyS, null);
  });
});

test("the id read but no tool call afterwards is no-action", () => {
  withFiles([[wake(5), result(5, "msg_m1"), done(9)]], (p) => {
    const r = one(collect([sent("msg_m1", 4)], p));
    assert.equal(r.outcome, "no-action");
  });
});

test("send inside an open turn is mid-turn and is timed from the turn end", () => {
  withFiles([[prompt(0), tool(10), done(40), wake(41), tool(70), result(71, "msg_m1"), done(80)]], (p) => {
    const r = one(collect([sent("msg_m1", 20)], p));
    assert.equal(r.kind, "mid-turn");
    assert.equal(r.outcome, "woken");
    assert.equal(r.latencyS, 30);
  });
});

test("a mid-turn send read in the same batch as the turn's own message is woken at the read, not at a later call", () => {
  withFiles([[prompt(0), tool(3), result(6, "msg_m1 msg_m2", 3), done(12), tool(2400)]], (p) => {
    const r = one(collect([sent("msg_m2", 5)], p));
    assert.equal(r.kind, "mid-turn");
    assert.equal(r.outcome, "woken");
    assert.equal(r.latencyS, 1);
  });
});

test("a read inside the same turn is still held to the 120 s limit", () => {
  withFiles([[prompt(0), tool(3), result(2000, "msg_m1 msg_m2", 3), done(2001)]], (p) => {
    const r = one(collect([sent("msg_m2", 5)], p));
    assert.equal(r.outcome, "slow");
    assert.equal(r.latencyS, 1995);
  });
});

test("an unrelated tool call before the real read does not end the latency (idle)", () => {
  withFiles([[prompt(1), tool(2), done(3), tool(901), result(902, "msg_m1", 901), done(903)]], (p) => {
    const r = one(collect([sent("msg_m1", 0)], p));
    assert.equal(r.kind, "idle");
    assert.equal(r.outcome, "slow");
    assert.equal(r.latencyS, 901);
  });
});

test("an unrelated tool call before the real read does not end the latency (mid-turn)", () => {
  withFiles([[prompt(0), done(10), prompt(11), tool(12), done(13), tool(801), result(802, "msg_m1", 801), done(803)]], (p) => {
    const r = one(collect([sent("msg_m1", 5)], p));
    assert.equal(r.kind, "mid-turn");
    assert.equal(r.outcome, "slow");
    assert.equal(r.latencyS, 791);
  });
});

test("two transcript files (a compaction split) are joined in time order", () => {
  withFiles([[wake(5), done(6)], [tool(9), result(10, "msg_m1"), done(11)]], (p) => {
    const r = one(collect([sent("msg_m1", 4)], p));
    assert.equal(r.outcome, "woken");
    assert.equal(r.latencyS, 5);
  });
});

test("the id in two tool results is a duplicate", () => {
  withFiles([[wake(5), tool(6), result(7, "msg_m1"), result(30, "msg_m1"), done(31)]], (p) => {
    assert.equal(one(collect([sent("msg_m1", 4)], p)).outcome, "duplicate");
  });
});

test("limits: exactly the maximum passes, one second over is slow (idle and mid-turn)", () => {
  withFiles([[wake(1), tool(MAX_LATENCY_S), result(MAX_LATENCY_S + 1, "msg_m1"), done(MAX_LATENCY_S + 2)]], (p) => {
    assert.equal(one(collect([sent("msg_m1", 0)], p)).outcome, "woken");
  });
  withFiles([[wake(1), tool(MAX_LATENCY_S + 1), result(MAX_LATENCY_S + 2, "msg_m1"), done(MAX_LATENCY_S + 3)]], (p) => {
    assert.equal(one(collect([sent("msg_m1", 0)], p)).outcome, "slow");
  });
  withFiles([[prompt(0), done(100), wake(101), tool(100 + MAX_MIDTURN_S), result(165, "msg_m1", 100 + MAX_MIDTURN_S), done(200)]], (p) => {
    assert.equal(one(collect([sent("msg_m1", 50)], p)).outcome, "woken");
  });
  withFiles([[prompt(0), done(100), wake(101), tool(101 + MAX_MIDTURN_S), result(165, "msg_m1", 101 + MAX_MIDTURN_S), done(200)]], (p) => {
    assert.equal(one(collect([sent("msg_m1", 50)], p)).outcome, "slow");
  });
});

test("a slash command line never opens a turn, so a send long after it is idle", () => {
  const slash = { type: "user", timestamp: iso(1), message: { role: "user", content: "<command-name>/reload-plugins</command-name>" } };
  const caveat = { type: "user", timestamp: iso(2), message: { role: "user", content: "<local-command-caveat>ran by the user</local-command-caveat>" } };
  withFiles([[slash, caveat, wake(3601), tool(3604), result(3605, "msg_m1"), done(3606)]], (p) => {
    const r = one(collect([sent("msg_m1", 3600)], p));
    assert.equal(r.kind, "idle");
    assert.equal(r.outcome, "woken");
    assert.equal(r.latencyS, 4);
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
