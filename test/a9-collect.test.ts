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
const result = (s: number, text: string) => ({ type: "user", timestamp: iso(s), message: { content: [{ type: "tool_result", tool_use_id: `u${s}`, content: text }] } });
const done = (s: number) => ({ type: "assistant", timestamp: iso(s), message: { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" } });
const sendCall = (s: number, command: string) => ({ type: "assistant", timestamp: iso(s), message: { content: [{ type: "tool_use", id: `send${s}`, name: "Bash", input: { command } }], stop_reason: "tool_use" } });
const sendResult = (s: number, id: string) => ({ type: "user", timestamp: iso(s), message: { content: [{ type: "tool_result", tool_use_id: `send${s - 1}`, content: `messageId=${id}` }] } });

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

test("sends: only send commands carrying the prefix count, timed at the result", () => {
  withFiles(
    [
      [
        sendCall(1, "orca orchestration send --to run:r --subject x --body 'A9 probe 1, no action'"),
        sendResult(2, "msg_aa11"),
        sendCall(3, "orca orchestration send --to run:r --body other"),
        sendResult(4, "msg_bb22"),
        sendCall(5, "ls A9 probe"),
        sendResult(6, "messageId=msg_cc33"),
      ],
    ],
    (p) => {
      assert.deepEqual(sends(p, "A9 probe"), [{ id: "msg_aa11", sentAt: T0 + 2000 }]);
    },
  );
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
  withFiles([[prompt(0), done(100), wake(101), tool(100 + MAX_MIDTURN_S), result(165, "msg_m1"), done(200)]], (p) => {
    assert.equal(one(collect([sent("msg_m1", 50)], p)).outcome, "woken");
  });
  withFiles([[prompt(0), done(100), wake(101), tool(101 + MAX_MIDTURN_S), result(165, "msg_m1"), done(200)]], (p) => {
    assert.equal(one(collect([sent("msg_m1", 50)], p)).outcome, "slow");
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
