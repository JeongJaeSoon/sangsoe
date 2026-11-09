import { type ApproveExec as Exec, approveExec, recordReviewVerdict, SANGSOE_REPO, Store } from "../../../core/index.ts";
import type { Outcome, ToolDef } from "../contract.ts";

export type ReviewRecordPorts = { exec: Exec; openStore: () => Store };

// Decision 162: the session that calls this tool is the recorder. A session whose checkout holds
// the PR's head (its branch or its commit) wrote the PR, and is refused before anything is read
// or written; a checkout it cannot read is refused too, never assumed to be someone else's.
async function recorderRefusal(exec: Exec, repo: string, pr: number, head: string): Promise<Outcome | undefined> {
  const refuse = (code: string, reason: string, fix: string): Outcome => ({ ok: false, refusal: { code, reason, fix } });
  const here = await exec("git", ["rev-parse", "HEAD", "--abbrev-ref", "HEAD"]);
  const [sha = "", branch = ""] = here.stdout.trim().split("\n");
  if (here.code !== 0 || !sha) {
    return refuse("recorder_unknown", `cannot read this session's checkout: ${here.stderr.trim() || here.code}`, "call review_record from the session's own worktree");
  }
  const ref = await exec("gh", ["api", `repos/${repo}/pulls/${pr}`, "--jq", ".head.ref"]);
  if (ref.code !== 0) return refuse("review_refused", `cannot read ${repo}#${pr}: ${ref.stderr.trim() || ref.code}`, FIX);
  if (branch === ref.stdout.trim() || sha === head) {
    return refuse(
      "recorder_is_author",
      `this session's checkout holds ${repo}#${pr}'s head (${branch} ${sha}): the session that wrote the PR cannot record its verdict`,
      "the PR's writer sends the reviewed head, the reviewer and the evidence to its lead; a lead calls from a worktree not on the PR's branch",
    );
  }
  return undefined;
}

// Word for word the CLI's fix, so both entrances return one Outcome.
const FIX = "check --pr, --head (the PR's current head) and --reviewer (not the author)";

export function reviewRecordTool(ports: () => ReviewRecordPorts): ToolDef {
  return {
    name: "review_record",
    description:
      "Record one independent review's verdict on a PR head (review_verdict, decision 111); land reads it. Refused when the reviewer is the PR's author, the head is not the PR's current head, or this session's checkout holds the PR (its author records nothing).",
    inputSchema: {
      type: "object",
      properties: {
        pr: { type: "integer", description: "PR number" },
        repo: { type: "string", description: "owner/name; default JeongJaeSoon/sangsoe" },
        head_sha: { type: "string", description: "the 40-character head that was reviewed" },
        act_on: { type: "integer", description: "the review's Act-on finding count" },
        reviewer: { type: "string", description: "who reviewed, e.g. claude or codex; never the PR's author" },
      },
      required: ["pr", "head_sha", "act_on", "reviewer"],
      additionalProperties: false,
    },
    async handler(input) {
      const p = ports();
      const repo = typeof input.repo === "string" ? input.repo : SANGSOE_REPO;
      const pr = Number(input.pr);
      const head = String(input.head_sha);
      const refused = await recorderRefusal(p.exec, repo, pr, head);
      if (refused) return refused;
      const r = await recordReviewVerdict({ repo, pr, head, actOn: Number(input.act_on), reviewer: String(input.reviewer) }, p);
      return r.ok ? { ok: true, value: r.note } : { ok: false, refusal: { code: "review_refused", reason: r.note, fix: FIX } };
    },
  };
}

export default reviewRecordTool(() => ({ exec: approveExec, openStore: () => Store.open() }));
