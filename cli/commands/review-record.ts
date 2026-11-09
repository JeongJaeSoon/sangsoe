import { type ApproveExec, approveExec, recordReviewVerdict, SANGSOE_REPO, Store } from "../../core/index.ts";
import type { CommandDef } from "../contract.ts";

const OPTIONS = ["pr", "head", "act-on", "reviewer", "repo"] as const;

// The router has already rejected unknown options and handled --help; reviewRecord re-reads the
// same options from argv so its own tests keep driving it directly.
export default {
  name: "review record",
  summary: "record one independent review's verdict on a PR head (decision 111)",
  usage: "--pr <N> --head <sha> --act-on <N> --reviewer <name> [--repo <owner/name>]",
  options: Object.fromEntries(OPTIONS.map((o) => [o, { type: "string" }])),
  run: async ({ values }) => {
    const argv = OPTIONS.flatMap((o) => (typeof values[o] === "string" ? [`--${o}`, values[o]] : []));
    const { code, out } = await reviewRecord(argv);
    return { code, lines: [out] };
  },
} satisfies CommandDef;

export const USAGE = `usage: sangsoe review record --pr <N> --head <sha> --act-on <N> --reviewer <name> [--repo <owner/name>]

Records one independent review's verdict on one PR head (review_verdict, decision 111). The only
writer of that event; \`sangsoe plugin approve\` reads review evidence from it. The PR's author is
read from GitHub and a reviewer equal to it is refused. --repo defaults to ${SANGSOE_REPO}.`;

type Parsed =
  | { repo: string; pr: number; head: string; actOn: number; reviewer: string }
  | { help: true }
  | { error: string };

const FLAGS = ["--pr", "--head", "--act-on", "--reviewer", "--repo"] as const;

export function parseArgs(args: readonly string[]): Parsed {
  const v: Partial<Record<(typeof FLAGS)[number], string>> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "--help" || a === "-h") return { help: true };
    const next = args[i + 1];
    if (!(FLAGS as readonly string[]).includes(a) || next === undefined || next.startsWith("--")) {
      return { error: `unknown or incomplete argument: ${a}` };
    }
    v[a as (typeof FLAGS)[number]] = next;
    i++;
  }
  const missing = FLAGS.filter((f) => f !== "--repo" && v[f] === undefined);
  if (missing.length > 0) return { error: `missing ${missing.join(", ")}` };
  const num = (s: string | undefined) => (s !== undefined && /^[0-9]+$/.test(s) ? Number(s) : Number.NaN);
  return {
    repo: v["--repo"] ?? SANGSOE_REPO,
    pr: num(v["--pr"]),
    head: v["--head"] ?? "",
    actOn: num(v["--act-on"]),
    reviewer: v["--reviewer"] ?? "",
  };
}

export async function reviewRecord(
  args: readonly string[],
  deps: { exec: ApproveExec; openStore: () => Store } = { exec: approveExec, openStore: () => Store.open() },
): Promise<{ code: number; out: string }> {
  const p = parseArgs(args);
  if ("help" in p) return { code: 0, out: USAGE };
  if ("error" in p) return { code: 2, out: `${p.error}\n${USAGE}` };
  const r = await recordReviewVerdict(p, deps);
  return { code: r.ok ? 0 : 1, out: r.note };
}
