import { type ApproveExec as Exec, approveExec, recordReviewVerdict, recorderRefusal, SANGSOE_REPO, Store } from "../../../core/index.ts";
import type { ToolDef } from "../contract.ts";

export type ReviewRecordPorts = { exec: Exec; openStore: () => Store };

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
      const refused = await recorderRefusal(p.exec, { tool: "review_record", repo, pr, head, what: "verdict", refused: "review_refused", fix: FIX, noCheckout: "refuse" }, process.cwd());
      if (refused) return refused;
      const r = await recordReviewVerdict({ repo, pr, head, actOn: Number(input.act_on), reviewer: String(input.reviewer) }, p);
      return r.ok ? { ok: true, value: r.note } : { ok: false, refusal: { code: "review_refused", reason: r.note, fix: FIX } };
    },
  };
}

export default reviewRecordTool(() => ({ exec: approveExec, openStore: () => Store.open() }));
