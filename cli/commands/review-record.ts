import { type ApproveExec, approveExec, recordReviewVerdict, SANGSOE_REPO, Store } from "../../core/index.ts";
import type { CommandArgs, CommandDef, Outcome } from "../contract.ts";

const REQUIRED = ["pr", "head", "act-on", "reviewer"] as const;
const USAGE = "--pr <N> --head <sha> --act-on <N> --reviewer <name> [--repo <owner/name>]";

type Deps = { exec: ApproveExec; openStore: () => Store };

// An Outcome, not a Report: the later MCP tool wraps the same core function and both entrances
// must decode to the same value or refusal.
export async function reviewRecord(
  values: CommandArgs["values"],
  deps: Deps = { exec: approveExec, openStore: () => Store.open() },
): Promise<Outcome<string>> {
  const missing = REQUIRED.filter((o) => typeof values[o] !== "string");
  if (missing.length > 0) {
    return {
      ok: false,
      refusal: { code: "invalid_input", reason: `missing ${missing.map((o) => `--${o}`).join(", ")}`, fix: `sangsoe review record ${USAGE}` },
    };
  }
  const text = (o: string) => String(values[o]);
  const num = (o: string) => (/^[0-9]+$/.test(text(o)) ? Number(text(o)) : Number.NaN);
  const r = await recordReviewVerdict(
    {
      repo: typeof values.repo === "string" ? values.repo : SANGSOE_REPO,
      pr: num("pr"),
      head: text("head"),
      actOn: num("act-on"),
      reviewer: text("reviewer"),
    },
    deps,
  );
  return r.ok
    ? { ok: true, value: r.note }
    : { ok: false, refusal: { code: "review_refused", reason: r.note, fix: "check --pr, --head (the PR's current head) and --reviewer (not the author)" } };
}

export default {
  name: "review record",
  summary: "record one independent review's verdict on a PR head (decision 111)",
  usage: USAGE,
  options: { pr: { type: "string" }, head: { type: "string" }, "act-on": { type: "string" }, reviewer: { type: "string" }, repo: { type: "string" } },
  run: ({ values }) => reviewRecord(values),
} satisfies CommandDef;
