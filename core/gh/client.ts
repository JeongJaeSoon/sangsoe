import type { Exec } from "../contract/orca.ts";

export type RateBudget = { resource: string; limit: number; remaining: number; /** epoch seconds */ resetAt: number };

/**
 * The caches `gh_budget` and `gh_seen` (appendix "캐시 예외"). The store unit backs this with
 * sqlite; `memoryGhCache` is for tests and one-shot CLI runs.
 */
export interface GhCache {
  etag(url: string): string | undefined;
  saw(url: string, etag: string): void;
  budget(resource: string): RateBudget | undefined;
  setBudget(b: RateBudget): void;
}

export type GhResponse<T> =
  | { kind: "ok"; status: number; data: T }
  | { kind: "not_modified" }
  | { kind: "rate_limited"; resource: string; resetAt: number }
  | { kind: "error"; status: number | null; message: string };

export interface GhClient {
  /**
   * GET through `gh api`. `conditional` sends the last ETag, so an unchanged resource comes back
   * as `not_modified` without a body: use it to poll, not to read a value you need.
   */
  get<T>(path: string, o?: { conditional?: boolean }): Promise<GhResponse<T>>;
}

export function memoryGhCache(): GhCache {
  const etags = new Map<string, string>();
  const budgets = new Map<string, RateBudget>();
  return {
    etag: (url) => etags.get(url),
    saw: (url, etag) => void etags.set(url, etag),
    budget: (resource) => budgets.get(resource),
    setBudget: (b) => void budgets.set(b.resource, b),
  };
}

/** Appendix `gh_budget`: below 30% monitors slow down, below 10% only notifications and merges run. */
export function budgetLevel(b: RateBudget | undefined): "normal" | "slow" | "essential" {
  if (!b || b.limit <= 0) return "normal";
  const share = b.remaining / b.limit;
  if (share < 0.1) return "essential";
  if (share < 0.3) return "slow";
  return "normal";
}

type Raw = { status: number; headers: Map<string, string>; body: string };

/** `gh api -i` prints the status line, headers, a blank line, then the body. */
export function parseIncluded(stdout: string): Raw | undefined {
  const m = /^HTTP\/[\d.]+ (\d{3})[^\n]*\r?\n(?:([\s\S]*?)\r?\n)?\r?\n([\s\S]*)$/.exec(stdout);
  if (!m) {
    const head = /^HTTP\/[\d.]+ (\d{3})[^\n]*\r?\n([\s\S]*)$/.exec(stdout);
    if (!head) return undefined;
    return { status: Number(head[1]), headers: parseHeaders(head[2] ?? ""), body: "" };
  }
  return { status: Number(m[1]), headers: parseHeaders(m[2] ?? ""), body: m[3] ?? "" };
}

function parseHeaders(block: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of block.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
  }
  return headers;
}

function readBudget(h: Map<string, string>): RateBudget | undefined {
  const limit = Number(h.get("x-ratelimit-limit"));
  const remaining = Number(h.get("x-ratelimit-remaining"));
  const resetAt = Number(h.get("x-ratelimit-reset"));
  if (![limit, remaining, resetAt].every(Number.isFinite) || !h.has("x-ratelimit-remaining")) return undefined;
  return { resource: h.get("x-ratelimit-resource") ?? "core", limit, remaining, resetAt };
}

function errorMessage(body: string, fallback: string): string {
  try {
    const j = JSON.parse(body) as { message?: unknown };
    if (typeof j.message === "string") return j.message;
  } catch {}
  return fallback.trim().slice(0, 500);
}

/** The one GitHub client (appendix: every GitHub read goes through it and records budget and ETag). */
export function createGhClient(deps: { exec: Exec; cache: GhCache; now: () => number; ghBin?: string }): GhClient {
  const { exec, cache, now } = deps;
  return {
    async get<T>(path: string, o: { conditional?: boolean } = {}): Promise<GhResponse<T>> {
      const known = cache.budget("core");
      if (known && known.remaining <= 0 && known.resetAt * 1000 > now()) {
        return { kind: "rate_limited", resource: known.resource, resetAt: known.resetAt };
      }
      const args = ["api", "-i"];
      const etag = o.conditional ? cache.etag(path) : undefined;
      if (etag) args.push("-H", `If-None-Match: ${etag}`);
      args.push(path);
      const r = await exec(deps.ghBin ?? "gh", args);
      const raw = parseIncluded(r.stdout);
      if (!raw) return { kind: "error", status: null, message: (r.failure ?? r.stderr).trim().slice(0, 500) };

      const budget = readBudget(raw.headers);
      if (budget) cache.setBudget(budget);
      if (raw.status === 304) return { kind: "not_modified" };
      const secondary = raw.status === 403 && /secondary rate limit/i.test(raw.body);
      if (raw.status === 429 || secondary || (raw.status === 403 && (budget?.remaining === 0 || raw.headers.has("retry-after")))) {
        const nowS = Math.ceil(now() / 1000);
        const retryAfter = Number(raw.headers.get("retry-after"));
        const exhausted = budget?.remaining === 0 ? budget.resetAt : undefined;
        // GitHub's advice for a throttle with no reset: wait at least a minute.
        const resetAt = Number.isFinite(retryAfter) && retryAfter > 0 ? nowS + retryAfter : (exhausted ?? nowS + 60);
        return { kind: "rate_limited", resource: budget?.resource ?? "core", resetAt };
      }
      if (raw.status < 200 || raw.status >= 300) {
        return { kind: "error", status: raw.status, message: errorMessage(raw.body, r.stderr) };
      }
      const tag = raw.headers.get("etag");
      if (tag) cache.saw(path, tag);
      try {
        return { kind: "ok", status: raw.status, data: (raw.body.trim() === "" ? null : JSON.parse(raw.body)) as T };
      } catch {
        return { kind: "error", status: raw.status, message: "response body is not JSON" };
      }
    },
  };
}
