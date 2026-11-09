import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Exec } from "../contract/orca.ts";
import { createGhClient, memoryGhCache } from "../gh/client.ts";
import { nodeExec } from "../orca/exec.ts";
import { Store } from "../store/store.ts";
import { parseTierConfig } from "../verify/verify-tier.ts";
import type { LandConfig, LandDeps, MergePort } from "./land.ts";

/** `~/.config/sangsoe/config.json` (decision 14): `protected_paths`, `owners`, `verify_tier.{docs,test,ui,v3}_globs`. */
export function readLandConfig(home: string = homedir()): LandConfig {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(join(home, ".config", "sangsoe", "config.json"), "utf8"));
  } catch {
    return { tier: null, protectedPaths: null };
  }
  const paths = raw?.protected_paths;
  const protectedPaths = Array.isArray(paths) && paths.every((p) => typeof p === "string") ? (paths as string[]) : null;
  const section = typeof raw?.verify_tier === "object" && raw.verify_tier !== null ? raw.verify_tier : {};
  return { tier: parseTierConfig({ ...section, protected_paths: raw?.protected_paths, owners: raw?.owners }), protectedPaths };
}

// The one GitHub write sangsoe makes: the client in core/gh only reads (decision 0124).
export function ghMerge(exec: Exec): MergePort {
  return async ({ repo, pr, head }) => {
    const r = await exec("gh", ["pr", "merge", String(pr), "--repo", repo, "--auto", "--squash", "--match-head-commit", head]);
    const message = (r.stderr || r.stdout || r.failure || "").trim().slice(0, 500);
    return { ok: r.code === 0, message: message || (r.code === 0 ? "merge requested" : `gh exited ${r.code}`) };
  };
}

export function realLandDeps(o: { home?: string; exec?: Exec } = {}): LandDeps {
  const exec = o.exec ?? nodeExec();
  return {
    gh: createGhClient({ exec, cache: memoryGhCache(), now: () => Date.now() }),
    openStore: () => Store.open(o.home ? { home: o.home } : {}),
    merge: ghMerge(exec),
    config: () => readLandConfig(o.home),
  };
}
