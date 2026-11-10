import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Exec, ExecResult } from "../contract/orca.ts";
import { createGhClient, memoryGhCache } from "../gh/client.ts";
import { nodeExec } from "../orca/exec.ts";
import { Store } from "../store/store.ts";
import { parseTierConfig, tierConfigGaps } from "../verify/verify-tier.ts";
import { readPrGate } from "./github.ts";
import type { LandConfig, LandDeps, MergeNowPort, MergePort } from "./land.ts";

const REPO_NAME = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/;

/**
 * `~/.config/sangsoe/config.json` (decision 14): `protected_paths`, `owners`,
 * `verify_tier.{docs,test,ui,v3}_globs`, and decision 158's opt-in `verdict_merge_repos`
 * (anything but a list of owner/name is off).
 */
export function readLandConfig(home: string = homedir()): LandConfig {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(join(home, ".config", "sangsoe", "config.json"), "utf8"));
  } catch {
    return { tier: null, protectedPaths: null, verdictMergeRepos: [], tierGap: "~/.config/sangsoe/config.json is missing or not JSON" };
  }
  const paths = raw?.protected_paths;
  const protectedPaths = Array.isArray(paths) && paths.every((p) => typeof p === "string") ? (paths as string[]) : null;
  const section = typeof raw?.verify_tier === "object" && raw.verify_tier !== null ? raw.verify_tier : {};
  const listed = raw?.verdict_merge_repos;
  const lowered = Array.isArray(listed) ? listed.map((r) => (typeof r === "string" ? r.toLowerCase() : "")) : [];
  const verdictMergeRepos = lowered.length > 0 && lowered.every((r) => REPO_NAME.test(r)) ? lowered : [];
  const fields = { ...section, protected_paths: raw?.protected_paths, owners: raw?.owners };
  const tier = parseTierConfig(fields);
  const gaps = tierConfigGaps(fields).map((k) => (k === "protected_paths" || k === "owners" ? k : `verify_tier.${k}`));
  return { tier, protectedPaths, verdictMergeRepos, ...(tier ? {} : { tierGap: `config.json lacks ${gaps.join(", ")}` }) };
}

function merged(r: ExecResult, done: string): { ok: boolean; message: string } {
  const message = (r.stderr || r.stdout || r.failure || "").trim().slice(0, 500);
  return { ok: r.code === 0, message: message || (r.code === 0 ? done : `gh exited ${r.code}`) };
}

// The two GitHub writes sangsoe makes: the client in core/gh only reads (decision 0124).
export function ghMerge(exec: Exec): MergePort {
  return async ({ repo, pr, head }) =>
    merged(await exec("gh", ["pr", "merge", String(pr), "--repo", repo, "--auto", "--squash", "--match-head-commit", head]), "merge requested");
}

/** Decision 158: merge now, pinned to the judged head; `--auto` would wait on nothing on such a repo. */
export function ghMergeNow(exec: Exec): MergeNowPort {
  return async ({ repo, pr, head, method }) =>
    merged(await exec("gh", ["pr", "merge", String(pr), "--repo", repo, `--${method}`, "--match-head-commit", head]), "merged");
}

export function realLandDeps(o: { home?: string; exec?: Exec } = {}): LandDeps {
  const exec = o.exec ?? nodeExec();
  return {
    gh: createGhClient({ exec, cache: memoryGhCache(), now: () => Date.now() }),
    openStore: () => Store.open(o.home ? { home: o.home } : {}),
    merge: ghMerge(exec),
    mergeNow: ghMergeNow(exec),
    prGate: readPrGate(exec),
    config: () => readLandConfig(o.home),
  };
}
