import type { ApproveExec as Exec } from "../../core/index.ts";
import type { Outcome } from "./contract.ts";

// Decision 162: the session that calls a recording tool is the recorder. A session whose checkout
// holds the PR's head (its branch or its commit) wrote the PR, and is refused before anything is
// read or written; a checkout it cannot read is refused too, never assumed to be someone else's.
// `head` null skips the commit comparison, for a merged PR whose head is no longer the point.
// Decision 198: the checkout is named with `git -C`: the MCP server's cwd is the session's folder, which
// may be a plain folder or `/`; a cwd that is no checkout is refused in one Korean line.
export async function recorderRefusal(
  exec: Exec,
  a: { tool: string; repo: string; pr: number; head: string | null; what: string; refused: string; fix: string },
  cwd: string = process.cwd(),
): Promise<Outcome | undefined> {
  const refuse = (code: string, reason: string, fix: string): Outcome => ({ ok: false, refusal: { code, reason, fix } });
  const here = cwd ? await exec("git", ["-C", cwd, "rev-parse", "HEAD", "--abbrev-ref", "HEAD"]) : { code: 1, stdout: "", stderr: "" };
  const [sha = "", branch = ""] = here.stdout.trim().split("\n");
  if (here.code !== 0 || !sha) {
    return refuse("recorder_unknown", `이 세션의 폴더(${cwd || "없음"})가 git checkout 이 아니라 기록하는 쪽을 정하지 못했다`, `${a.tool} 은 세션 자신의 worktree 에서 부른다`);
  }
  const ref = await exec("gh", ["api", `repos/${a.repo}/pulls/${a.pr}`, "--jq", ".head.ref"]);
  if (ref.code !== 0) return refuse(a.refused,`cannot read ${a.repo}#${a.pr}: ${ref.stderr.trim() || ref.code}`, a.fix);
  if (branch === ref.stdout.trim() || sha === a.head) {
    return refuse(
      "recorder_is_author",
      `this session's checkout holds ${a.repo}#${a.pr}'s head (${branch} ${sha}): the session that wrote the PR cannot record its ${a.what}`,
      "the PR's writer sends the reviewed head, the reviewer and the evidence to its lead; a lead calls from a worktree not on the PR's branch",
    );
  }
  return undefined;
}
