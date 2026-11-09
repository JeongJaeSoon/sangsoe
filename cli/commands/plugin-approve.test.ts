import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ApprovePorts } from "../../core/index.ts";
import { defaultPluginDir, parseArgs, pluginApprove } from "./plugin-approve.ts";

function untouchable(): { ports: ApprovePorts; touched: () => number } {
  let n = 0;
  const no = async (): Promise<never> => {
    n++;
    throw new Error("must not be called");
  };
  return {
    ports: { exec: no, fetchPluginTree: no, reviewEvidence: no, openLedger: no, readManifest: no, now: () => 0 },
    touched: () => n,
  };
}

test("--help prints usage and touches nothing", async () => {
  const { ports, touched } = untouchable();
  const r = await pluginApprove(["--help"], () => {}, ports);
  assert.equal(r.code, 0);
  assert.match(r.out, /^usage: sangsoe plugin approve/);
  assert.equal(touched(), 0);
});

test("an unknown argument exits 2 and touches nothing", async () => {
  const { ports, touched } = untouchable();
  for (const args of [["--yes"], ["--dir"], ["--commit", "--dry-run"], ["--commit", "-h"]]) {
    const r = await pluginApprove(args, () => {}, ports);
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(touched(), 0);
  }
});

test("parseArgs", () => {
  assert.deepEqual(parseArgs(["--dry-run", "--dir", "/x", "--commit", "abc"]), { dryRun: true, dir: "/x", commit: "abc" });
  assert.deepEqual(parseArgs([]), { dryRun: false, dir: null, commit: null });
});

test("the default folder is this tree's orca-plugin/", () => {
  assert.match(defaultPluginDir(undefined, "") ?? "", /\/orca-plugin$/);
});

// Decision 152: the reviewed tree gets the core staged in for a release, never for a git checkout.
test("a release folder is compared with staged trees, a git checkout's folder with the git tree", async () => {
  const seen: boolean[] = [];
  const ports: ApprovePorts = {
    async exec(cmd, args) {
      const a = args.join(" ");
      if (cmd === "gh" && a.includes("/compare/")) return { code: 0, stdout: "ahead\n", stderr: "" };
      if (cmd === "gh" && a.includes("/pulls")) return { code: 0, stdout: JSON.stringify([{ number: 1, head: "b".repeat(40) }]), stderr: "" };
      if (cmd === "orca" && a.startsWith("plugin inspect")) return { code: 0, stdout: JSON.stringify({ result: { contentHash: "h" } }), stderr: "" };
      throw new Error(`unexpected ${cmd} ${a}`);
    },
    async fetchPluginTree(_repo, _commit, staged) {
      seen.push(staged);
      throw new Error("stop here");
    },
    reviewEvidence: async () => ({ headSha: "b".repeat(40), actOn: 0, reviewer: "r", author: "a" }),
    openLedger: async () => {
      throw new Error("must not be called");
    },
    readManifest: async () => ({ id: "sangsoe", version: "0.1.0" }),
    now: () => 0,
  };
  const release = mkdtempSync(join(tmpdir(), "sangsoe-approve-release-"));
  try {
    mkdirSync(join(release, "orca-plugin"));
    writeFileSync(join(release, "orca-plugin", "orca-plugin.json"), "{}");
    const commit = ["--commit", "a".repeat(40), "--dry-run"];
    await pluginApprove(["--dir", join(release, "orca-plugin"), ...commit], () => {}, ports);
    await pluginApprove(["--dir", defaultPluginDir(undefined, "") ?? "", ...commit], () => {}, ports);
    assert.deepEqual(seen, [true, false]);
  } finally {
    rmSync(release, { recursive: true, force: true });
  }
});

// Node runs the CLI from its real (Cellar) path; install dev-loads SANGSOE_ROOT's opt/ path.
test("under the Homebrew wrapper the default folder is SANGSOE_ROOT's, the path install loaded", () => {
  const root = mkdtempSync(join(tmpdir(), "sangsoe-approve-root-"));
  try {
    mkdirSync(join(root, "orca-plugin"));
    writeFileSync(join(root, "orca-plugin", "orca-plugin.json"), "{}");
    assert.equal(defaultPluginDir(undefined, root), join(root, "orca-plugin"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
