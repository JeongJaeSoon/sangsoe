import type { Exec } from "../approve/approve.ts";
import { type Refusal, refuse } from "../notify/result.ts";

export type RecorderCheck = {
  tool: string;
  repo: string;
  pr: number;
  head: string | null;
  what: string;
  refused: string;
  fix: string;
  /**
   * A folder that is no checkout: the MCP server refuses it, the CLI lets it record. The owner
   * runs the CLI on a Claude Code `!` line too (README Install), where CLAUDECODE is set and the
   * folder is the session's, often no checkout; an agent could `cd` to any other folder anyway.
   */
  noCheckout: "refuse" | "pass";
};

/**
 * Decision 227: the folder whose checkout names the calling agent session, or null for the
 * owner's shell. Claude Code sets CLAUDECODE in every process its sessions start; the MCP server
 * is always a session's and passes its own cwd instead.
 */
export function agentCheckout(env: Readonly<Record<string, string | undefined>> = process.env, cwd: string = process.cwd()): string | null {
  return env.CLAUDECODE ? cwd : null;
}

// Decision 162: the session that records is the recorder. A session whose checkout holds the PR's
// head (its branch or its commit) wrote the PR, and is refused before anything is read or written;
// through MCP a checkout it cannot read is refused too, never assumed to be someone else's.
// `head` null skips the commit comparison, for a merged PR whose head is no longer the point.
// Decision 198: the checkout is named with `git -C`, since the MCP server's cwd may be a plain folder or `/`.
export async function recorderRefusal(exec: Exec, a: RecorderCheck, checkout: string | null): Promise<{ ok: false; refusal: Refusal } | undefined> {
  if (checkout === null) return undefined;
  // Core refuses this input on its own; asking GitHub about it would only add a failed call.
  if (!Number.isInteger(a.pr) || a.pr < 1) return undefined;
  const here = checkout ? await exec("git", ["-C", checkout, "rev-parse", "HEAD", "--abbrev-ref", "HEAD"]) : { code: 1, stdout: "", stderr: "" };
  const [sha = "", branch = ""] = here.stdout.trim().split("\n");
  if (here.code !== 0 || !sha) {
    if (a.noCheckout === "pass") return undefined;
    return refuse("recorder_unknown", `이 세션의 폴더(${checkout || "없음"})가 git checkout 이 아니라 기록하는 쪽을 정하지 못했다`, `${a.tool} 은 세션 자신의 worktree 에서 부른다`);
  }
  const ref = await exec("gh", ["api", `repos/${a.repo}/pulls/${a.pr}`, "--jq", ".head.ref"]);
  if (ref.code !== 0) return refuse(a.refused, `cannot read ${a.repo}#${a.pr}: ${ref.stderr.trim() || ref.code}`, a.fix);
  if (branch === ref.stdout.trim() || sha === a.head) {
    return refuse(
      "recorder_is_author",
      `this session's checkout holds ${a.repo}#${a.pr}'s head (${branch} ${sha}): the session that wrote the PR cannot record its ${a.what}`,
      "the PR's writer sends the reviewed head, the reviewer and the evidence to its lead; a lead calls from a worktree not on the PR's branch; the owner runs the CLI from a folder not on the PR's branch, or from a terminal outside Claude Code",
    );
  }
  return undefined;
}
