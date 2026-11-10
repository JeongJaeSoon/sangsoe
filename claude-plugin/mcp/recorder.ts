import type { ApproveExec as Exec } from "../../core/index.ts";
import type { Outcome } from "./contract.ts";

// Decision 162: the session that calls a recording tool is the recorder. A session whose checkout
// holds the PR's head (its branch or its commit) wrote the PR, and is refused before anything is
// read or written; a checkout it cannot read is refused too, never assumed to be someone else's.
// `head` null skips the commit comparison, for a merged PR whose head is no longer the point.
export async function recorderRefusal(
  exec: Exec,
  a: { tool: string; repo: string; pr: number; head: string | null; what: string; refused: string; fix: string },
): Promise<Outcome | undefined> {
  const refuse = (code: string, reason: string, fix: string): Outcome => ({ ok: false, refusal: { code, reason, fix } });
  const here = await exec("git", ["rev-parse", "HEAD", "--abbrev-ref", "HEAD"]);
  const [sha = "", branch = ""] = here.stdout.trim().split("\n");
  if (here.code !== 0 || !sha) {
    return refuse("recorder_unknown", `cannot read this session's checkout: ${here.stderr.trim() || here.code}`, `call ${a.tool} from the session's own worktree`);
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
