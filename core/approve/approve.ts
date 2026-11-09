// `sangsoe plugin approve`: the one code path that enables the sangsoe Orca plugin (decision 77 다).
// It enables only when all three conditions hold, and records `plugin_approved` (decision 0104).
import type { PluginApproved } from "./plugin-approved.ts";

export type ExecResult = { code: number; stdout: string; stderr: string };
export type Exec = (cmd: string, args: readonly string[]) => Promise<ExecResult>;

export type ReviewEvidence = { headSha: string; actOn: number; reviewer: string; author: string };

export type ApprovePorts = {
  exec: Exec;
  // The reviewed tree of `commit` as a local folder; `dispose` removes the download.
  fetchPluginTree(repo: string, commit: string): Promise<{ dir: string; dispose(): Promise<void> }>;
  // TODO(U1): read the review `evidence` event for the PR head from the core store.
  reviewEvidence(repo: string, pr: number, headSha: string): Promise<ReviewEvidence | null>;
  // TODO(U1): append to the core store's event table.
  record(event: PluginApproved): Promise<void>;
  readManifest(dir: string): Promise<{ id: string; version: string; repository?: string }>;
  now(): number;
};

export type ApproveInput = { dir: string; commit: string; dryRun: boolean };

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

function parse(stdout: string): OrcaJson | null {
  try {
    return JSON.parse(stdout) as OrcaJson;
  } catch {
    return null;
  }
}

export function repoSlug(url: string | undefined): string | null {
  const m = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url ?? "");
  return m?.[1] ?? null;
}

async function contentHash(exec: Exec, dir: string): Promise<string | null> {
  const r = await exec("orca", ["plugin", "inspect", dir, "--json"]);
  const hash = (parse(r.stdout)?.result as { contentHash?: unknown } | undefined)?.contentHash;
  return r.code === 0 && typeof hash === "string" ? hash : null;
}

async function checkMerged(ports: ApprovePorts, repo: string, commit: string): Promise<Check> {
  const name = "merged_with_clean_review";
  const cmp = await ports.exec("gh", ["api", `repos/${repo}/compare/${commit}...main`, "--jq", ".status"]);
  const status = cmp.stdout.trim();
  if (cmp.code !== 0 || (status !== "ahead" && status !== "identical")) {
    return { name, ok: false, detail: `${commit} is not on main (${status || cmp.stderr.trim() || cmp.code})` };
  }
  const prs = await ports.exec("gh", [
    "api",
    `repos/${repo}/commits/${commit}/pulls`,
    "--jq",
    "[.[] | select(.merged_at != null) | {number, head: .head.sha}]",
  ]);
  const merged = prs.code === 0 ? (parse(prs.stdout) as unknown as { number: number; head: string }[] | null) : null;
  const pr = merged?.length === 1 ? merged[0] : undefined;
  if (!pr) return { name, ok: false, detail: `no single merged PR carries ${commit}` };
  const ev = await ports.reviewEvidence(repo, pr.number, pr.head);
  if (!ev) return { name, ok: false, detail: `no review evidence for PR #${pr.number} head ${pr.head}` };
  if (ev.reviewer === ev.author) return { name, ok: false, detail: `PR #${pr.number} was reviewed by its author` };
  if (ev.actOn !== 0) return { name, ok: false, detail: `PR #${pr.number} review has ${ev.actOn} Act-on finding(s)` };
  return { name, ok: true, detail: `on main via PR #${pr.number}, reviewed by ${ev.reviewer} with 0 Act-on` };
}

async function checkBuild(ports: ApprovePorts, repo: string, commit: string, dir: string): Promise<Check> {
  const name = "folder_is_reviewed_build";
  const here = await contentHash(ports.exec, dir);
  if (!here) return { name, ok: false, detail: `orca plugin inspect failed for ${dir}` };
  let tree: Awaited<ReturnType<ApprovePorts["fetchPluginTree"]>>;
  try {
    tree = await ports.fetchPluginTree(repo, commit);
  } catch (e) {
    return { name, ok: false, detail: `could not fetch ${commit}: ${e instanceof Error ? e.message : String(e)}` };
  }
  try {
    const reviewed = await contentHash(ports.exec, tree.dir);
    if (!reviewed) return { name, ok: false, detail: `orca plugin inspect failed for ${commit}` };
    return reviewed === here
      ? { name, ok: true, detail: `content ${here} equals ${commit}` }
      : { name, ok: false, detail: `content ${here} differs from ${commit} (${reviewed})` };
  } finally {
    await tree.dispose();
  }
}

export async function approvePlugin(input: ApproveInput, ports: ApprovePorts): Promise<ApproveResult> {
  const result: ApproveResult = { ok: false, enabled: false, key: null, fingerprint: null, checks: [], command: null, note: "" };
  const manifest = await ports.readManifest(input.dir);
  const repo = repoSlug(manifest.repository);

  // Orca names the key and the fingerprint it wants; a reload re-checks approval and never enables.
  const reload = await ports.exec("orca", ["plugin", "dev", "reload", input.dir, "--json"]);
  const out = parse(reload.stdout);
  if (reload.code === 0) {
    result.ok = true;
    result.note = "already approved: Orca asks for no approval for this folder";
    return result;
  }
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

  const target =
    manifest.id === "sangsoe" && key !== null && /^[a-z0-9-]+\.sangsoe$/.test(key) && data.contentIdentity === `dev:${input.dir}`;
  result.checks.push({
    name: "target_is_sangsoe",
    ok: target,
    detail: target ? `${key} is the sangsoe folder ${input.dir}` : `key ${key} / ${String(data.contentIdentity)} is not the sangsoe folder`,
  });
  if (!repo) {
    result.checks.push({ name: "merged_with_clean_review", ok: false, detail: `manifest repository is not a GitHub URL` });
  } else {
    result.checks.push(await checkMerged(ports, repo, input.commit));
    result.checks.push(await checkBuild(ports, repo, input.commit, input.dir));
  }

  if (!key || !fingerprint || !result.checks.every((c) => c.ok)) {
    result.note = "not enabled: a condition failed";
    return result;
  }
  result.command = ["orca", "plugin", "enable", key, "--approve", fingerprint, "--json"];
  if (input.dryRun) {
    result.ok = true;
    result.note = "dry run: would enable";
    return result;
  }
  const [cmd = "orca", ...args] = result.command;
  const enable = await ports.exec(cmd, args);
  if (enable.code !== 0) {
    result.note = `orca plugin enable failed: ${parse(enable.stdout)?.error?.code ?? enable.code}`;
    return result;
  }
  await ports.record({
    type: "plugin_approved",
    key,
    version: manifest.version,
    fingerprint,
    commit: input.commit,
    at: ports.now(),
  });
  result.ok = true;
  result.enabled = true;
  result.note = "enabled";
  return result;
}
