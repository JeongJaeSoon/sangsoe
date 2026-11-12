import { approveExec, type RecordPorts, recorderRefusal, recordStage, SANGSOE_REPO, STAGES, Store } from "../../../core/index.ts";
import type { ToolDef } from "../contract.ts";

// Word for word the CLI's fix, so both entrances return one Outcome for input that passes the schema;
// a stage outside the enum is the server's invalid_input here and the core's stage_refused on the CLI.
const FIX = "check --pr (merged), --stage, --sha and --recorder (not the author)";

export function stageRecordTool(ports: () => RecordPorts): ToolDef {
  return {
    name: "stage_record",
    description:
      "Record that a merged PR reached a stage (stage_recorded, decision 171); deploys_after edges and the ship flows wait on it. Refused when the PR has not merged, the recorder is its author, or this session's checkout holds the PR's branch.",
    inputSchema: {
      type: "object",
      properties: {
        pr: { type: "integer", description: "PR number" },
        repo: { type: "string", description: "owner/name; default JeongJaeSoon/sangsoe" },
        stage: { type: "string", enum: [...STAGES], description: "merge, dev or prod" },
        sha: { type: "string", description: "the commit that reached the stage" },
        recorder: { type: "string", description: "who deployed or checked it; never the PR's author" },
      },
      required: ["pr", "stage", "sha", "recorder"],
      additionalProperties: false,
    },
    async handler(input) {
      const p = ports();
      const repo = typeof input.repo === "string" ? input.repo : SANGSOE_REPO;
      const pr = Number(input.pr);
      const refused = await recorderRefusal(p.exec, { tool: "stage_record", repo, pr, head: null, what: "stages", refused: "stage_refused", fix: FIX, noCheckout: "refuse" }, process.cwd());
      if (refused) return refused;
      const r = await recordStage({ repo, pr, stage: String(input.stage), sha: String(input.sha), recorder: String(input.recorder) }, p);
      return r.ok ? { ok: true, value: r.note } : { ok: false, refusal: { code: "stage_refused", reason: r.note, fix: FIX } };
    },
  };
}

export default stageRecordTool(() => ({ exec: approveExec, openStore: () => Store.open() }));
