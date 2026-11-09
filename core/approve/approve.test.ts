import assert from "node:assert/strict";
import { test } from "node:test";
import { type ApprovePorts, approvePlugin, type ExecResult, type PluginApproved, type ReviewEvidence } from "./approve.ts";

// TODO(U2): swap this hand fake for the shared fake Orca once it lands.
const DIR = "/opt/sangsoe/orca-plugin";
const SHA = "a".repeat(40);
const HEAD = "b".repeat(40);
const FP = "ap1-0000";
const tree = (sha: string) => `/tmp/reviewed/${sha}/orca-plugin`;

type World = {
  manifestId: string;
  reload: ExecResult;
  compare: string;
  pulls: { number: number; head: string }[];
  evidence: ReviewEvidence | null;
  hashes: Record<string, string[]>;
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
    manifestId: "sangsoe",
    reload: needsApproval(),
    compare: "ahead",
    pulls: [{ number: 7, head: HEAD }],
    evidence: { headSha: HEAD, actOn: 0, reviewer: "review:codex", author: "worker:u3" },
    hashes: { [DIR]: ["h1"], [tree(SHA)]: ["h1"], [tree(HEAD)]: ["h1"] },
    enable: json({ ok: true }),
    ...over,
  };
}

function fake(w: World) {
  const calls: string[][] = [];
  const recorded: PluginApproved[] = [];
  const reads: Record<string, number> = {};
  let disposed = 0;
  const ports: ApprovePorts = {
    async exec(cmd, args) {
      calls.push([cmd, ...args]);
      const a = args.join(" ");
      if (cmd === "orca" && a.startsWith("plugin dev reload")) return w.reload;
      if (cmd === "orca" && a.startsWith("plugin inspect")) {
        const dir = args[2] ?? "";
        const seq = w.hashes[dir] ?? [];
        const n = reads[dir] ?? 0;
        reads[dir] = n + 1;
        const h = seq[Math.min(n, seq.length - 1)];
        return h ? json({ ok: true, result: { contentHash: h } }) : json({ ok: false }, 1);
      }
      if (cmd === "orca" && a.startsWith("plugin enable")) return w.enable;
      if (cmd === "gh" && a.includes("/compare/")) return { code: 0, stdout: `${w.compare}\n`, stderr: "" };
      if (cmd === "gh" && a.includes("/pulls")) return json(w.pulls);
      throw new Error(`unexpected ${cmd} ${a}`);
    },
    async fetchPluginTree(_repo, commit) {
      return { dir: tree(commit), dispose: async () => void disposed++ };
    },
    reviewEvidence: async () => w.evidence,
    record: async (e) => void recorded.push(e),
    readManifest: async () => ({ id: w.manifestId, version: "0.1.0" }),
    now: () => 1_000,
  };
  const enables = () => calls.filter((c) => c[0] === "orca" && c[2] === "enable");
  const reloads = () => calls.filter((c) => c[0] === "orca" && c[2] === "dev");
  return { ports, calls, recorded, enables, reloads, disposed: () => disposed };
}

const run = (w: World, opts: { dryRun?: boolean; commit?: string } = {}) => {
  const f = fake(w);
  return approvePlugin({ dir: DIR, commit: opts.commit ?? SHA, dryRun: opts.dryRun ?? false }, f.ports).then((r) => ({
    r,
    ...f,
  }));
};

test("all three conditions hold: enables with Orca's key and fingerprint and records plugin_approved", async () => {
  const { r, enables, recorded, disposed } = await run(world());
  assert.equal(r.ok, true, r.note);
  assert.equal(r.enabled, true);
  assert.deepEqual(enables(), [["orca", "plugin", "enable", "local.sangsoe", "--approve", FP, "--json"]]);
  assert.deepEqual(recorded, [
    { type: "plugin_approved", key: "local.sangsoe", version: "0.1.0", fingerprint: FP, commit: SHA, at: 1_000 },
  ]);
  assert.equal(disposed(), 2, "both downloaded trees are removed");
});

test("dry run checks everything and names the command, but never enables or records", async () => {
  const { r, enables, recorded } = await run(world(), { dryRun: true });
  assert.equal(r.ok, true);
  assert.equal(r.enabled, false);
  assert.deepEqual(r.command, ["orca", "plugin", "enable", "local.sangsoe", "--approve", FP, "--json"]);
  assert.deepEqual(enables(), []);
  assert.deepEqual(recorded, []);
});

const refusals: [string, Partial<World>, string][] = [
  ["commit not on main", { compare: "diverged" }, "merged_with_clean_review"],
  ["no PR merged into main", { pulls: [] }, "merged_with_clean_review"],
  ["no review evidence (store not there yet)", { evidence: null }, "merged_with_clean_review"],
  [
    "evidence for another head",
    { evidence: { headSha: "c".repeat(40), actOn: 0, reviewer: "review:codex", author: "worker:u3" } },
    "merged_with_clean_review",
  ],
  [
    "review has Act-on findings",
    { evidence: { headSha: HEAD, actOn: 1, reviewer: "review:codex", author: "worker:u3" } },
    "merged_with_clean_review",
  ],
  [
    "reviewed by its author",
    { evidence: { headSha: HEAD, actOn: 0, reviewer: "worker:u3", author: "worker:u3" } },
    "merged_with_clean_review",
  ],
  [
    "folder differs from the main commit",
    { hashes: { [DIR]: ["h1"], [tree(SHA)]: ["h2"], [tree(HEAD)]: ["h1"] } },
    "folder_is_reviewed_build",
  ],
  [
    "main commit differs from the reviewed head",
    { hashes: { [DIR]: ["h1"], [tree(SHA)]: ["h1"], [tree(HEAD)]: ["h0"] } },
    "folder_is_reviewed_build",
  ],
  ["another plugin's key", { reload: needsApproval({ pluginKey: "acme.sangsoe" }) }, "target_is_sangsoe"],
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

test("a failing read-only check stops before Orca reloads the folder", async () => {
  const { reloads } = await run(world({ compare: "behind" }));
  assert.deepEqual(reloads(), []);
});

test("an already-approved folder still has to pass every check", async () => {
  const bad = await run(world({ reload: json({ ok: true }), evidence: null }));
  assert.equal(bad.r.ok, false);
  const good = await run(world({ reload: json({ ok: true }) }));
  assert.equal(good.r.ok, true);
  assert.match(good.r.note, /already approved/);
  assert.deepEqual(good.enables(), []);
});

test("a folder changed between the check and the enable is refused", async () => {
  const { r, enables } = await run(world({ hashes: { [DIR]: ["h1", "h9"], [tree(SHA)]: ["h1"], [tree(HEAD)]: ["h1"] } }));
  assert.equal(r.ok, false);
  assert.match(r.note, /changed/);
  assert.deepEqual(enables(), []);
});

test("a mutable ref or short SHA is refused before any host call", async () => {
  for (const commit of ["main", "abc123", `${SHA}x`]) {
    const { r, calls } = await run(world(), { commit });
    assert.equal(r.ok, false, commit);
    assert.deepEqual(calls, []);
  }
});

test("a folder that is not the sangsoe plugin is refused before any host call", async () => {
  const { r, calls } = await run(world({ manifestId: "acme-monitor" }));
  assert.equal(r.ok, false);
  assert.deepEqual(calls, []);
});

test("an Orca error other than an approval request does not enable", async () => {
  const { r, enables } = await run(
    world({ reload: json({ ok: false, error: { code: "plugin_system_disabled", message: "off" } }, 1) }),
  );
  assert.equal(r.ok, false);
  assert.match(r.note, /plugin_system_disabled/);
  assert.deepEqual(enables(), []);
});

test("a failed enable records nothing", async () => {
  const { r, recorded } = await run(world({ enable: json({ ok: false, error: { code: "approval_stale" } }, 3) }));
  assert.equal(r.ok, false);
  assert.match(r.note, /approval_stale/);
  assert.deepEqual(recorded, []);
});
