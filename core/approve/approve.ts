// `sangsoe plugin approve`: the one code path that enables the sangsoe Orca plugin (decision 77).
// It enables only when all three conditions hold, and records `plugin_approved` (decision 0104).
import type { PayloadOf } from "../contract/index.ts";
import { inspectContentHash } from "./content-hash.ts";

export type PluginApproved = { readonly type: "plugin_approved" } & PayloadOf<"plugin_approved">;

// The trust roots live here, never in the folder being approved.
export const SANGSOE_REPO = "JeongJaeSoon/sangsoe";
export const SANGSOE_KEY = "local.sangsoe";

export type ExecResult = { code: number; stdout: string; stderr: string };
export type Exec = (cmd: string, args: readonly string[]) => Promise<ExecResult>;

export type ReviewEvidence = { headSha: string; actOn: number; reviewer: string; author: string };

export type ApprovePorts = {
  exec: Exec;
  // The plugin folder of `commit` as a local folder, the core staged in when `staged` (decision 152);
  // `dispose` removes the download.
  fetchPluginTree(repo: string, commit: string, staged: boolean): Promise<{ dir: string; dispose(): Promise<void> }>;
  // The `review_verdict` rows for the PR head (decision 111); null when there is none.
  reviewEvidence(repo: string, pr: number, headSha: string): Promise<ReviewEvidence | null>;
  // Opened before the enable and held across it: a store that cannot take `plugin_approved`
  // refuses the approval instead of leaving the plugin on with no record (decision 123).
  openLedger(): Promise<Ledger>;
  readManifest(dir: string): Promise<{ id: string; version: string }>;
  now(): number;
};

export type Ledger = { record(event: PluginApproved): Promise<void>; close(): void };

/**
 * `dir` is the path Orca loaded (Homebrew's opt/ symlink); `realDir` is where it resolves, the only
 * `contentIdentity` accepted: an approval on the symlink would follow it to a later upgrade's bytes
 * (decision 122). Without it the two are the same. `staged` is a release build, whose folder carries
 * the core (decision 152); it comes from where the commit came from, never from the folder's files.
 */
export type ApproveInput = { dir: string; realDir?: string; commit: string; staged: boolean; dryRun: boolean };

export type CheckName = "target_is_sangsoe" | "merged_with_clean_review" | "folder_is_reviewed_build";
export type Check = { name: CheckName; ok: boolean; detail: string };

export type ApproveResult = {
  ok: boolean;
  enabled: boolean;
  key: string | null;
  fingerprint: string | null;
  checks: Check[];
  command: string[] | null;
  note: string;
};

type OrcaJson = { ok?: boolean; result?: unknown; error?: { code?: string; message?: string; data?: Record<string, unknown> } };
type MergedPr = { number: number; head: string };

export const FULL_SHA = /^[0-9a-f]{40}$/;

function parse(stdout: string): OrcaJson | null {
  try {
    return JSON.parse(stdout) as OrcaJson;
  } catch {
    return null;
  }
}

function contentHash(exec: Exec, dir: string): Promise<string | null> {
  return inspectContentHash(dir, async (d) => {
    const r = await exec("orca", ["plugin", "inspect", d, "--json"]);
    const hash = (parse(r.stdout)?.result as { contentHash?: unknown } | undefined)?.contentHash;
    return r.code === 0 && typeof hash === "string" ? hash : null;
  });
}

async function checkMerged(ports: ApprovePorts, commit: string): Promise<{ check: Check; pr: MergedPr | null }> {
  const name: CheckName = "merged_with_clean_review";
  const fail = (detail: string) => ({ check: { name, ok: false, detail }, pr: null });
  const cmp = await ports.exec("gh", ["api", `repos/${SANGSOE_REPO}/compare/${commit}...main`, "--jq", ".status"]);
  const status = cmp.stdout.trim();
  if (cmp.code !== 0 || (status !== "ahead" && status !== "identical")) {
    return fail(`${commit} is not on main (${status || cmp.stderr.trim() || cmp.code})`);
  }
  const prs = await ports.exec("gh", [
    "api",
    `repos/${SANGSOE_REPO}/commits/${commit}/pulls`,
    "--jq",
    '[.[] | select(.merged_at != null and .base.ref == "main") | {number, head: .head.sha}]',
  ]);
  const merged = prs.code === 0 ? (parse(prs.stdout) as unknown as MergedPr[] | null) : null;
  const pr = Array.isArray(merged) && merged.length === 1 ? merged[0] : undefined;
  if (!pr || !FULL_SHA.test(pr.head)) return fail(`no single PR merged into main carries ${commit}`);
  const ev = await ports.reviewEvidence(SANGSOE_REPO, pr.number, pr.head);
  if (!ev) return fail(`no review evidence for PR #${pr.number} head ${pr.head}`);
  if (ev.headSha !== pr.head) return fail(`PR #${pr.number} evidence is for ${ev.headSha}, not its merged head ${pr.head}`);
  if (ev.reviewer === ev.author) return fail(`PR #${pr.number} was reviewed by its author`);
  if (ev.actOn !== 0) return fail(`PR #${pr.number} review has ${ev.actOn} Act-on finding(s)`);
  return { check: { name, ok: true, detail: `on main via PR #${pr.number}, reviewed by ${ev.reviewer} with 0 Act-on` }, pr };
}

async function treeHash(ports: ApprovePorts, commit: string, staged: boolean): Promise<string | Error> {
  let tree: Awaited<ReturnType<ApprovePorts["fetchPluginTree"]>>;
  try {
    tree = await ports.fetchPluginTree(SANGSOE_REPO, commit, staged);
  } catch (e) {
    return new Error(`could not fetch ${commit}: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    return (await contentHash(ports.exec, tree.dir)) ?? new Error(`orca plugin inspect failed for ${commit}`);
  } finally {
    await tree.dispose();
  }
}

// The folder must equal both the main commit's tree and the reviewed PR head's tree, so a squash
// or a main merged in after review cannot slip unreviewed plugin bytes in.
async function checkBuild(ports: ApprovePorts, here: string, input: ApproveInput, pr: MergedPr): Promise<Check> {
  const name = "folder_is_reviewed_build";
  const commit = input.commit;
  for (const [label, sha] of [
    ["main commit", commit],
    [`PR #${pr.number} head`, pr.head],
  ] as const) {
    const h = await treeHash(ports, sha, input.staged);
    if (h instanceof Error) return { name, ok: false, detail: h.message };
    if (h !== here) return { name, ok: false, detail: `content ${here} differs from the ${label} ${sha} (${h})` };
  }
  return { name, ok: true, detail: `content ${here} equals ${commit} and the reviewed head ${pr.head}` };
}

export async function approvePlugin(input: ApproveInput, ports: ApprovePorts): Promise<ApproveResult> {
  const result: ApproveResult = { ok: false, enabled: false, key: null, fingerprint: null, checks: [], command: null, note: "" };
  if (!FULL_SHA.test(input.commit)) {
    result.note = `commit must be a full 40-character SHA, got ${input.commit}`;
    return result;
  }
  const manifest = await ports.readManifest(input.dir);
  if (manifest.id !== "sangsoe") {
    result.note = `${input.dir} is plugin ${manifest.id}, not sangsoe`;
    return result;
  }

  // Read-only checks first: nothing reaches Orca's loader before they pass.
  const merged = await checkMerged(ports, input.commit);
  result.checks.push(merged.check);
  const here = await contentHash(ports.exec, input.dir);
  if (!here) {
    result.checks.push({ name: "folder_is_reviewed_build", ok: false, detail: `orca plugin inspect failed for ${input.dir}` });
  } else if (merged.pr) {
    result.checks.push(await checkBuild(ports, here, input, merged.pr));
  } else {
    result.checks.push({ name: "folder_is_reviewed_build", ok: false, detail: "no reviewed head to compare with" });
  }
  if (!result.checks.every((c) => c.ok)) {
    result.note = "not enabled: a condition failed";
    return result;
  }

  // Orca names the key and fingerprint it wants; a reload re-checks approval and never enables.
  const reload = await ports.exec("orca", ["plugin", "dev", "reload", input.dir, "--json"]);
  if (reload.code === 0) {
    result.ok = true;
    result.note = "already approved: the folder passes all checks and Orca asks for no approval";
    return result;
  }
  const out = parse(reload.stdout);
  const code = out?.error?.code;
  const data = out?.error?.data ?? {};
  if (reload.code !== 3 || (code !== "approval_required" && code !== "approval_stale")) {
    result.note = `orca plugin dev reload: ${code ?? reload.code} ${out?.error?.message ?? reload.stderr.trim()}`;
    return result;
  }
  const key = typeof data.pluginKey === "string" ? data.pluginKey : null;
  const fingerprint = typeof data.approvalFingerprint === "string" ? data.approvalFingerprint : null;
  result.key = key;
  result.fingerprint = fingerprint;
  const identity = `dev:${input.realDir ?? input.dir}`;
  const target = key === SANGSOE_KEY && fingerprint !== null && data.contentIdentity === identity;
  result.checks.unshift({
    name: "target_is_sangsoe",
    ok: target,
    detail: target ? `${key} is the sangsoe folder ${input.dir}` : `key ${key} / ${String(data.contentIdentity)} is not ${SANGSOE_KEY} at ${identity}`,
  });
  if (!target || !key || !fingerprint) {
    result.note = "not enabled: a condition failed";
    return result;
  }
  // Orca binds a dev approval to the path, not the bytes, so re-read them just before enabling.
  // This narrows the window but cannot close it (decisions 0105, 122).
  if ((await contentHash(ports.exec, input.dir)) !== here) {
    result.note = "not enabled: the folder changed while it was being checked";
    return result;
  }

  result.command = ["orca", "plugin", "enable", key, "--approve", fingerprint, "--json"];
  if (input.dryRun) {
    result.ok = true;
    result.note = "dry run: would enable";
    return result;
  }
  let ledger: Ledger;
  try {
    ledger = await ports.openLedger();
  } catch (e) {
    result.note = `not enabled: the store cannot take plugin_approved: ${e instanceof Error ? e.message : String(e)}`;
    return result;
  }
  try {
    const [cmd = "orca", ...args] = result.command;
    const enable = await ports.exec(cmd, args);
    if (enable.code !== 0) {
      result.note = `orca plugin enable failed: ${parse(enable.stdout)?.error?.code ?? enable.code}`;
      return result;
    }
    result.enabled = true;
    await ledger.record({
      type: "plugin_approved",
      key,
      version: manifest.version,
      fingerprint,
      commit: input.commit,
      at: ports.now(),
    });
    result.ok = true;
    result.note = "enabled";
    return result;
  } finally {
    ledger.close();
  }
}
