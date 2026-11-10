import { type LandDeps, land, realLandDeps, SANGSOE_REPO } from "../../../core/index.ts";
import type { ToolDef } from "../contract.ts";

export function landTool(deps: () => LandDeps): ToolDef {
  return {
    name: "land",
    description:
      "Land a PR: checks main, stack order, the review verdict and the verify tier's evidence at the head, then the four merge conditions; asks GitHub to merge or records merge_on_approval. On a repo in config verdict_merge_repos, a verdict recorded at the exact head by a non-author, green checks and no unresolved thread merge at once instead (not V3, not protected paths). Every refusal is recorded as land_failed.",
    inputSchema: {
      type: "object",
      properties: {
        pr: { type: "integer", description: "PR number" },
        repo: { type: "string", description: "owner/name; default JeongJaeSoon/sangsoe" },
        head_sha: { type: "string", description: "the 40-character head you reviewed; refused if the PR moved" },
        dry_run: { type: "boolean", description: "judge only: no merge, no event" },
        main_fix: { type: "boolean", description: "this PR fixes a red main" },
      },
      required: ["pr"],
      additionalProperties: false,
    },
    handler: (input) =>
      land(
        {
          repo: typeof input.repo === "string" ? input.repo : SANGSOE_REPO,
          pr: Number(input.pr),
          ...(typeof input.head_sha === "string" ? { headSha: input.head_sha } : {}),
          dryRun: input.dry_run === true,
          mainFix: input.main_fix === true,
        },
        deps(),
      ),
  };
}

export default landTool(() => realLandDeps());
