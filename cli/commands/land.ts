import { type LandDeps, land, realLandDeps, SANGSOE_REPO } from "../../core/index.ts";
import type { CommandDef } from "../contract.ts";

export function landCommand(deps: () => LandDeps): CommandDef {
  return {
    name: "land",
    summary: "check a PR's review, evidence and merge conditions, then ask GitHub to merge it (the only merge path)",
    usage: "--pr <N> [--repo <owner/name>] [--head <sha>] [--dry-run] [--main-fix]",
    required: ["pr"],
    options: {
      pr: { type: "string" },
      repo: { type: "string" },
      head: { type: "string" },
      "dry-run": { type: "boolean" },
      "main-fix": { type: "boolean" },
    },
    run: ({ values }) => {
      const pr = String(values.pr);
      return land(
        {
          repo: typeof values.repo === "string" ? values.repo : SANGSOE_REPO,
          pr: /^[0-9]+$/.test(pr) ? Number(pr) : Number.NaN,
          ...(typeof values.head === "string" ? { headSha: values.head } : {}),
          dryRun: values["dry-run"] === true,
          mainFix: values["main-fix"] === true,
        },
        deps(),
      );
    },
  };
}

export default landCommand(() => realLandDeps());
