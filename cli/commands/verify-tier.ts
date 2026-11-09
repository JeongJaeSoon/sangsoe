import { type LandDeps, realLandDeps, SANGSOE_REPO, tierOfPr } from "../../core/index.ts";
import type { CommandDef } from "../contract.ts";

export function verifyTierCommand(deps: () => Pick<LandDeps, "gh" | "config">): CommandDef {
  return {
    name: "verify-tier",
    summary: "print a PR's verify tier (V0-V3) at its head and the evidence land will ask for",
    usage: "--pr <N> [--repo <owner/name>]",
    required: ["pr"],
    options: { pr: { type: "string" }, repo: { type: "string" } },
    run: ({ values }) => {
      const pr = String(values.pr);
      return tierOfPr(deps(), {
        repo: typeof values.repo === "string" ? values.repo : SANGSOE_REPO,
        pr: /^[0-9]+$/.test(pr) ? Number(pr) : Number.NaN,
      });
    },
  };
}

export default verifyTierCommand(() => realLandDeps());
