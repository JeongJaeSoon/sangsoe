import { approveExec, EVIDENCE_KINDS, type RecordPorts, recordEvidence, SANGSOE_REPO, Store } from "../../../core/index.ts";
import type { ToolDef } from "../contract.ts";
import { recorderRefusal } from "../recorder.ts";

// Word for word the CLI's fix, so both entrances return one Outcome.
const FIX = "check --pr, --head (the PR's current head), --kind, --not-verified (at least one) and --recorder (not the author)";

export function evidenceRecordTool(ports: () => RecordPorts): ToolDef {
  return {
    name: "evidence_record",
    description:
      "Record one verification run's evidence on a PR head (evidence, decision 171); land's evidence_missing reads it. Refused when the recorder is the PR's author, the head is not the PR's current head, or this session's checkout holds the PR.",
    inputSchema: {
      type: "object",
      properties: {
        pr: { type: "integer", description: "PR number" },
        repo: { type: "string", description: "owner/name; default JeongJaeSoon/sangsoe" },
        head_sha: { type: "string", description: "the 40-character head the run checked" },
        kind: { type: "string", enum: [...EVIDENCE_KINDS], description: "the kind land asks for: test, run, ui or dev" },
        exit_code: { type: "integer", description: "the run's exit code; land counts 0 only" },
        not_verified: { type: "array", items: { type: "string" }, description: "what this run did not check; at least one" },
        recorder: { type: "string", description: "who ran or checked it; never the PR's author" },
        path: { type: "string", description: "a large output kept as a file" },
        sha256: { type: "string", description: "that file's sha256; given with path" },
      },
      required: ["pr", "head_sha", "kind", "exit_code", "not_verified", "recorder"],
      additionalProperties: false,
    },
    async handler(input) {
      const p = ports();
      const repo = typeof input.repo === "string" ? input.repo : SANGSOE_REPO;
      const pr = Number(input.pr);
      const head = String(input.head_sha);
      const refused = await recorderRefusal(p.exec, { tool: "evidence_record", repo, pr, head, what: "evidence", refused: "evidence_refused", fix: FIX });
      if (refused) return refused;
      const r = await recordEvidence(
        {
          repo,
          pr,
          head,
          kind: String(input.kind),
          exitCode: Number(input.exit_code),
          notVerified: (input.not_verified as unknown[]).map(String),
          recorder: String(input.recorder),
          ...(typeof input.path === "string" ? { path: input.path } : {}),
          ...(typeof input.sha256 === "string" ? { sha256: input.sha256 } : {}),
        },
        p,
      );
      return r.ok ? { ok: true, value: r.note } : { ok: false, refusal: { code: "evidence_refused", reason: r.note, fix: FIX } };
    },
  };
}

export default evidenceRecordTool(() => ({ exec: approveExec, openStore: () => Store.open() }));
