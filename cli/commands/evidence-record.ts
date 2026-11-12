import { agentCheckout, approveExec, type RecordPorts, recordEvidence, recorderRefusal, SANGSOE_REPO, Store } from "../../core/index.ts";
import type { CommandArgs, CommandDef, Outcome } from "../contract.ts";

const REQUIRED = ["pr", "head", "kind", "exit-code", "not-verified", "recorder"] as const;
const USAGE =
  "--pr <N> --head <sha> --kind test|run|ui|dev --exit-code <N> --not-verified <what> [--not-verified <what>...] --recorder <name> [--repo <owner/name>] [--path <file> --sha256 <hex>]";
// Word for word the evidence_record tool's fix, so both entrances return one Outcome.
const EVIDENCE_FIX = "check --pr, --head (the PR's current head), --kind, --not-verified (at least one) and --recorder (not the author)";

export async function evidenceRecord(
  values: CommandArgs["values"],
  deps: RecordPorts = { exec: approveExec, openStore: () => Store.open() },
  checkout: string | null = agentCheckout(),
): Promise<Outcome<string>> {
  const missing = REQUIRED.filter((o) => values[o] === undefined);
  if (missing.length > 0) {
    return { ok: false, refusal: { code: "invalid_input", reason: `missing ${missing.map((o) => `--${o}`).join(", ")}`, fix: `sangsoe evidence record ${USAGE}` } };
  }
  const text = (o: string) => String(values[o]);
  const opt = (o: string) => (typeof values[o] === "string" ? String(values[o]) : undefined);
  const nv = values["not-verified"];
  const path = opt("path");
  const sha256 = opt("sha256");
  const repo = opt("repo") ?? SANGSOE_REPO;
  const pr = /^[0-9]+$/.test(text("pr")) ? Number(text("pr")) : Number.NaN;
  const head = text("head");
  const what = { tool: "sangsoe evidence record", repo, pr, head, what: "evidence", refused: "evidence_refused", fix: EVIDENCE_FIX, noCheckout: "pass" } as const;
  const refused = await recorderRefusal(deps.exec, what, checkout);
  if (refused) return refused;
  const r = await recordEvidence(
    {
      repo,
      pr,
      head,
      kind: text("kind"),
      exitCode: /^-?[0-9]+$/.test(text("exit-code")) ? Number(text("exit-code")) : Number.NaN,
      notVerified: (Array.isArray(nv) ? nv : [nv]).map(String),
      recorder: text("recorder"),
      ...(path !== undefined ? { path } : {}),
      ...(sha256 !== undefined ? { sha256 } : {}),
    },
    deps,
  );
  return r.ok ? { ok: true, value: r.note } : { ok: false, refusal: { code: "evidence_refused", reason: r.note, fix: EVIDENCE_FIX } };
}

export default {
  name: "evidence record",
  summary: "record one verification run's evidence on a PR head for land (decision 171)",
  usage: USAGE,
  required: REQUIRED,
  options: {
    pr: { type: "string" },
    head: { type: "string" },
    kind: { type: "string" },
    "exit-code": { type: "string" },
    "not-verified": { type: "string", multiple: true },
    recorder: { type: "string" },
    repo: { type: "string" },
    path: { type: "string" },
    sha256: { type: "string" },
  },
  run: ({ values }) => evidenceRecord(values),
} satisfies CommandDef;
