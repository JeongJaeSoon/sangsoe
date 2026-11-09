import assert from "node:assert/strict";
import { test } from "node:test";
import type { Exec, ExecResult } from "../contract/orca.ts";
import { budgetLevel, createGhClient, memoryGhCache, parseIncluded } from "./client.ts";

const NOW = 1_794_230_000_000;

function http(status: string, headers: Record<string, string>, body = ""): ExecResult {
  const head = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  return { code: status.startsWith("2") ? 0 : 1, stdout: [`HTTP/2.0 ${status}`, ...head, "", body].join("\n"), stderr: "" };
}

function scripted(...replies: ExecResult[]): { exec: Exec; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    exec: async (file, args) => {
      calls.push([file, ...args]);
      const next = replies.shift();
      if (!next) throw new Error("unexpected gh call");
      return next;
    },
  };
}

const RATE = { "X-Ratelimit-Limit": "5000", "X-Ratelimit-Remaining": "4515", "X-Ratelimit-Reset": "1794238164", "X-Ratelimit-Resource": "core" };

test("parseIncluded splits status, headers and body", () => {
  const raw = parseIncluded(http("200 OK", { Etag: '"abc"' }, "[]").stdout);
  assert.equal(raw?.status, 200);
  assert.equal(raw?.headers.get("etag"), '"abc"');
  assert.equal(raw?.body, "[]");
  assert.equal(parseIncluded("gh: not logged in"), undefined);
});

test("a 200 records the budget and the ETag", async () => {
  const cache = memoryGhCache();
  const gh = createGhClient({ exec: scripted(http("200 OK", { ...RATE, Etag: '"e1"' }, '[{"type":"merge_queue"}]')).exec, cache, now: () => NOW });
  const r = await gh.get("repos/acme/api/rules/branches/main");
  assert.deepEqual(r, { kind: "ok", status: 200, data: [{ type: "merge_queue" }] });
  assert.equal(cache.etag("repos/acme/api/rules/branches/main"), '"e1"');
  assert.deepEqual(cache.budget("core"), { resource: "core", limit: 5000, remaining: 4515, resetAt: 1794238164 });
});

test("a conditional read sends the last ETag and a 304 is not_modified", async () => {
  const cache = memoryGhCache();
  cache.saw("repos/acme/api/pulls/40", '"e2"');
  const s = scripted(http("304 Not Modified", { ...RATE, Etag: '"e2"' }));
  const r = await createGhClient({ exec: s.exec, cache, now: () => NOW }).get("repos/acme/api/pulls/40", { conditional: true });
  assert.deepEqual(r, { kind: "not_modified" });
  assert.deepEqual(s.calls[0], ["gh", "api", "-i", "-H", 'If-None-Match: "e2"', "repos/acme/api/pulls/40"]);
});

test("an unconditional read never sends If-None-Match", async () => {
  const cache = memoryGhCache();
  cache.saw("repos/acme/api/pulls/40", '"e2"');
  const s = scripted(http("200 OK", RATE, "{}"));
  await createGhClient({ exec: s.exec, cache, now: () => NOW }).get("repos/acme/api/pulls/40");
  assert.ok(!(s.calls[0] ?? []).includes("-H"));
});

test("an exhausted budget is rate_limited, and the next call is not made until reset", async () => {
  const cache = memoryGhCache();
  const s = scripted(http("403 Forbidden", { ...RATE, "X-Ratelimit-Remaining": "0" }, '{"message":"API rate limit exceeded"}'));
  const gh = createGhClient({ exec: s.exec, cache, now: () => NOW });
  assert.deepEqual(await gh.get("repos/acme/api"), { kind: "rate_limited", resource: "core", resetAt: 1794238164 });
  assert.deepEqual(await gh.get("repos/acme/api"), { kind: "rate_limited", resource: "core", resetAt: 1794238164 });
  assert.equal(s.calls.length, 1);
});

test("a 429 is rate_limited even without rate headers", async () => {
  const s = scripted(http("429 Too Many Requests", {}, '{"message":"slow down"}'));
  const r = await createGhClient({ exec: s.exec, cache: memoryGhCache(), now: () => NOW }).get("repos/acme/api");
  assert.equal(r.kind, "rate_limited");
});

test("a 403 with budget left is an error, not rate_limited", async () => {
  const s = scripted(http("403 Forbidden", RATE, '{"message":"Resource not accessible by integration"}'));
  const r = await createGhClient({ exec: s.exec, cache: memoryGhCache(), now: () => NOW }).get("repos/acme/api/branches/main/protection");
  assert.deepEqual(r, { kind: "error", status: 403, message: "Resource not accessible by integration" });
});

test("budgetLevel: below 30% slows, below 10% keeps only essentials", () => {
  const b = (remaining: number) => ({ resource: "core", limit: 5000, remaining, resetAt: 0 });
  assert.equal(budgetLevel(undefined), "normal");
  assert.equal(budgetLevel(b(1500)), "normal");
  assert.equal(budgetLevel(b(1499)), "slow");
  assert.equal(budgetLevel(b(499)), "essential");
});
