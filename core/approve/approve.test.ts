import assert from "node:assert/strict";
import { test } from "node:test";
import { type ApprovePorts, approvePlugin, type ExecResult, type ReviewEvidence, repoSlug } from "./approve.ts";
import type { PluginApproved } from "./plugin-approved.ts";

// TODO(U2): swap this hand fake for the shared fake Orca once it lands.
const DIR = "/opt/sangsoe/orca-plugin";
const TREE = "/tmp/reviewed/orca-plugin";
const SHA = "abc123";
const FP = "ap1-0000";

type World = {
  reload: ExecResult;
  compare: string;
  pulls: { number: number; head: string }[];
  evidence: ReviewEvidence | null;
  hashes: Record<string, string>;
  enable: ExecResult;
};

const json = (v: unknown, code = 0): ExecResult => ({ code, stdout: JSON.stringify(v), stderr: "" });
const needsApproval = (over: Record<string, unknown> = {}) =>
  json(
    {
      ok: false,
      error: {
        code: "approval_required",
        data: { pluginKey: "local.sangsoe", approvalFingerprint: FP, contentIdentity: `dev:${DIR}`, ...over },
      },
    },
    3,
  );

function world(over: Partial<World> = {}): World {
  return {
    reload: needsApproval(),
    compare: "ahead",
    pulls: [{ number: 7, head: "head7" }],
    evidence: { headSha: "head7", actOn: 0, reviewer: "review:codex", author: "worker:u3" },
    hashes: { [DIR]: "h1", [TREE]: "h1" },
    enable: json({ ok: true }),
    ...over,
  };
}

function fake(w: World) {
  const calls: string[][] = [];
  const recorded: PluginApproved[] = [];
  let disposed = 0;
  const ports: ApprovePorts = {
    async exec(cmd, args) {
      calls.push([cmd, ...args]);
      const a = args.join(" ");
      if (cmd === "orca" && a.startsWith("plugin dev reload")) return w.reload;
      if (cmd === "orca" && a.startsWith("plugin inspect")) {
        const h = w.hashes[args[2] ?? ""];
        return h ? json({ ok: true, result: { contentHash: h } }) : json({ ok: false }, 1);
      }
      if (cmd === "orca" && a.startsWith("plugin enable")) return w.enable;
      if (cmd === "gh" && a.includes("/compare/")) return { code: 0, stdout: `${w.compare}\n`, stderr: "" };
      if (cmd === "gh" && a.includes("/pulls")) return json(w.pulls);
      throw new Error(`unexpected ${cmd} ${a}`);
    },
    async fetchPluginTree() {
      return { dir: TREE, dispose: async () => void disposed++ };
    },
    reviewEvidence: async () => w.evidence,
    record: async (e) => void recorded.push(e),
    readManifest: async () => ({ id: "sangsoe", version: "0.1.0", repository: "https://github.com/acme/sangsoe" }),
    now: () => 1_000,
  };
  const enables = () => calls.filter((c) => c[0] === "orca" && c[2] === "enable");
  return { ports, calls, recorded, enables, disposed: () => disposed };
}

const run = (w: World, dryRun = false) => {
  const f = fake(w);
  return approvePlugin({ dir: DIR, commit: SHA, dryRun }, f.ports).then((r) => ({ r, ...f }));
};

test("all three conditions hold: enables with Orca's key and fingerprint and records plugin_approved", async () => {
  const { r, enables, recorded, disposed } = await run(world());
  assert.equal(r.ok, true);
  assert.equal(r.enabled, true);
  assert.deepEqual(enables(), [["orca", "plugin", "enable", "local.sangsoe", "--approve", FP, "--json"]]);
  assert.deepEqual(recorded, [
    { type: "plugin_approved", key: "local.sangsoe", version: "0.1.0", fingerprint: FP, commit: SHA, at: 1_000 },
  ]);
  assert.equal(disposed(), 1);
});

test("dry run checks everything and names the command, but never enables or records", async () => {
  const { r, enables, recorded } = await run(world(), true);
  assert.equal(r.ok, true);
  assert.equal(r.enabled, false);
  assert.deepEqual(r.command, ["orca", "plugin", "enable", "local.sangsoe", "--approve", FP, "--json"]);
  assert.deepEqual(enables(), []);
  assert.deepEqual(recorded, []);
});

const refusals: [string, Partial<World>, string][] = [
  ["commit not on main", { compare: "diverged" }, "merged_with_clean_review"],
  ["no merged PR", { pulls: [] }, "merged_with_clean_review"],
  ["no review evidence (store not there yet)", { evidence: null }, "merged_with_clean_review"],
  [
    "review has Act-on findings",
    { evidence: { headSha: "head7", actOn: 1, reviewer: "review:codex", author: "worker:u3" } },
    "merged_with_clean_review",
  ],
  [
    "reviewed by its author",
    { evidence: { headSha: "head7", actOn: 0, reviewer: "worker:u3", author: "worker:u3" } },
    "merged_with_clean_review",
  ],
  ["folder differs from the reviewed tree", { hashes: { [DIR]: "h1", [TREE]: "h2" } }, "folder_is_reviewed_build"],
  ["another plugin's key", { reload: needsApproval({ pluginKey: "acme.monitor" }) }, "target_is_sangsoe"],
  ["another folder", { reload: needsApproval({ contentIdentity: "dev:/elsewhere" }) }, "target_is_sangsoe"],
];

for (const [name, over, check] of refusals) {
  test(`refuses: ${name}`, async () => {
    const { r, enables, recorded } = await run(world(over));
    assert.equal(r.ok, false);
    assert.equal(r.checks.find((c) => c.name === check)?.ok, false, JSON.stringify(r.checks));
    assert.deepEqual(enables(), []);
    assert.deepEqual(recorded, []);
  });
}

test("a folder Orca already approved needs nothing", async () => {
  const { r, enables } = await run(world({ reload: json({ ok: true }) }));
  assert.equal(r.ok, true);
  assert.match(r.note, /already approved/);
  assert.deepEqual(enables(), []);
});

test("an Orca error other than an approval request stops before any check", async () => {
  const { r, calls } = await run(
    world({ reload: json({ ok: false, error: { code: "plugin_system_disabled", message: "off" } }, 1) }),
  );
  assert.equal(r.ok, false);
  assert.match(r.note, /plugin_system_disabled/);
  assert.equal(calls.length, 1);
});

test("a failed enable records nothing", async () => {
  const { r, recorded } = await run(world({ enable: json({ ok: false, error: { code: "approval_stale" } }, 3) }));
  assert.equal(r.ok, false);
  assert.match(r.note, /approval_stale/);
  assert.deepEqual(recorded, []);
});

test("repoSlug reads GitHub URLs only", () => {
  assert.equal(repoSlug("https://github.com/acme/api"), "acme/api");
  assert.equal(repoSlug("https://github.com/acme/api.git"), "acme/api");
  assert.equal(repoSlug("https://example.com/acme/api"), null);
  assert.equal(repoSlug(undefined), null);
});
