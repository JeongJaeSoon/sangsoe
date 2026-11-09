import { type CoreDeps, done, type Result, refuse } from "../notify/result.ts";
import { type DecisionAnswered, type DecisionAnswerInput, decisionAnswer } from "./answer.ts";
import { type DecisionOpened, type DecisionOpenInput, decisionOpen } from "./open.ts";

// One parser per function, shared by the MCP tool and the CLI command, so both entrances accept and
// refuse the same input. Parsing runs before the store is opened.

type Raw = Readonly<Record<string, unknown>>;
/** The caller's deps, or a factory the entrance gives so a malformed call opens nothing. */
type DepsSource = CoreDeps | (() => CoreDeps);

const bad = (field: string, want: string) => refuse("bad_input", `${field}: expected ${want}`, `pass ${field} as ${want}`);
const text = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const LINKED_BY = ["hook", "button", "orchestrator", "observed"] as const;

export function parseDecisionOpen(raw: Raw): Result<DecisionOpenInput> {
  if (!text(raw.subject) || !/^(item:i\d{3,}|scope:\S+)$/.test(raw.subject)) return bad("subject", "item:iNNN or scope:<group>");
  if (!text(raw.question)) return bad("question", "a non-empty string");
  const options = raw.options ?? [];
  if (!Array.isArray(options) || !options.every(text)) return bad("options", "an array of strings");
  const waiters = raw.waiters ?? [];
  if (
    !Array.isArray(waiters) ||
    !waiters.every((w) => typeof w === "object" && w !== null && text((w as Raw).task) && text((w as Raw).run))
  ) {
    return bad("waiters", "an array of { task, run }");
  }
  if (raw.carrier_run !== undefined && !text(raw.carrier_run)) return bad("carrier_run", "a Run id");
  return done({
    subject: raw.subject,
    question: raw.question,
    options,
    waiters: waiters.map((w) => ({ task: String((w as Raw).task), run: String((w as Raw).run) })),
    ...(raw.carrier_run !== undefined ? { carrierRun: raw.carrier_run } : {}),
  });
}

/** Everything but the caller's Run, which may have to be read from Orca. */
export function parseDecisionAnswer(raw: Raw): Result<Omit<DecisionAnswerInput, "callerRun"> & { run?: string }> {
  if (!text(raw.decision) || !/^d\d{3,}$/.test(raw.decision)) return bad("decision", "dNNN");
  if (!text(raw.answer)) return bad("answer", "the masked answer text");
  const seq = Number(raw.owner_action);
  if (!Number.isInteger(seq) || seq < 1) return bad("owner_action", "the owner_action seq");
  const linkedBy = raw.linked_by ?? "orchestrator";
  if (!LINKED_BY.includes(linkedBy as (typeof LINKED_BY)[number])) return bad("linked_by", LINKED_BY.join("|"));
  if (raw.run !== undefined && !text(raw.run)) return bad("run", "a Run id");
  return done({
    decision: raw.decision,
    answer: raw.answer,
    ownerAction: seq,
    linkedBy: linkedBy as DecisionAnswerInput["linkedBy"],
    ...(raw.run !== undefined ? { run: raw.run } : {}),
  });
}

async function withDeps<T>(source: DepsSource, fn: (deps: CoreDeps) => Promise<T>): Promise<T> {
  if (typeof source !== "function") return fn(source);
  const deps = source();
  try {
    return await fn(deps);
  } finally {
    deps.store.close();
  }
}

/** The MCP tool's and the CLI command's whole body: parse, then open the deps, then call. */
export async function decisionOpenFrom(raw: Raw, deps: DepsSource): Promise<Result<DecisionOpened>> {
  const input = parseDecisionOpen(raw);
  if (!input.ok) return input;
  return withDeps(deps, (d) => decisionOpen(d, input.value));
}

export async function decisionAnswerFrom(raw: Raw, deps: DepsSource): Promise<Result<DecisionAnswered>> {
  const input = parseDecisionAnswer(raw);
  if (!input.ok) return input;
  return withDeps(deps, async (d) => {
    const { run, ...rest } = input.value;
    let callerRun = run;
    if (callerRun === undefined) {
      const current = await d.orca.runCurrent();
      callerRun = current.ok && text(current.value.runId) ? current.value.runId : undefined;
      if (!callerRun) return refuse("no_run", "this session holds no Run", "pass run, or run-use the Run first");
    }
    return decisionAnswer(d, { ...rest, callerRun });
  });
}
