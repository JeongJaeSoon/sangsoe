import { type CoreDeps, done, type Result, refuse } from "../notify/result.ts";
import { type DecisionAnswered, type DecisionAnswerInput, decisionAnswer } from "./answer.ts";
import { type DecisionMooted, type DecisionMootInput, decisionMoot } from "./moot.ts";
import { type DecisionOpened, type DecisionOpenInput, decisionOpen } from "./open.ts";

// One parser per function, shared by the MCP tool and the CLI command, so both entrances accept and
// refuse the same input. Parsing runs before the store is opened. The caller's Run is never taken from
// the input: gate-create and gate-resolve bind to the Run Orca reports, so only that one is true.

type Raw = Readonly<Record<string, unknown>>;
/** The caller's deps, or a factory the entrance gives so a malformed call opens nothing. */
type DepsSource = CoreDeps | (() => CoreDeps);

const bad = (field: string, want: string) => refuse("bad_input", `${field}: expected ${want}`, `pass ${field} as ${want}`);
const text = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const LINKED_BY = ["hook", "button", "orchestrator", "observed"] as const;
const DECISION = /^d\d{3,}$/;

export function parseDecisionOpen(raw: Raw): Result<Omit<DecisionOpenInput, "callerRun">> {
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

export function parseDecisionAnswer(raw: Raw): Result<Omit<DecisionAnswerInput, "callerRun">> {
  if (!text(raw.decision) || !DECISION.test(raw.decision)) return bad("decision", "dNNN");
  if (!text(raw.answer)) return bad("answer", "the masked answer text");
  const seq = Number(raw.owner_action);
  if (!Number.isInteger(seq) || seq < 1) return bad("owner_action", "the owner_action seq");
  const linkedBy = raw.linked_by ?? "orchestrator";
  if (!LINKED_BY.includes(linkedBy as (typeof LINKED_BY)[number])) return bad("linked_by", LINKED_BY.join("|"));
  return done({ decision: raw.decision, answer: raw.answer, ownerAction: seq, linkedBy: linkedBy as DecisionAnswerInput["linkedBy"] });
}

/**
 * The entrance takes no evidence: an open decision is mooted only when Orca shows every waiter closed,
 * and a moot decision resumes under the evidence first recorded. A closed PR is queue-monitor's to
 * observe; it calls `decisionMoot` itself, so no caller can moot a decision by naming a PR.
 */
export function parseDecisionMoot(raw: Raw): Result<Omit<DecisionMootInput, "callerRun">> {
  if (!text(raw.decision) || !DECISION.test(raw.decision)) return bad("decision", "dNNN");
  return done({ decision: raw.decision, evidence: { kind: "tasks_closed" } });
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

/** Parse, open the deps, read the caller's Run, then call. */
async function entrance<I, O>(
  parsed: Result<I>,
  source: DepsSource,
  call: (deps: CoreDeps, input: I & { callerRun: string }) => Promise<Result<O>>,
): Promise<Result<O>> {
  if (!parsed.ok) return parsed;
  return withDeps(source, async (deps) => {
    const current = await deps.orca.runCurrent();
    if (!current.ok) return refuse("orca_error", `run-current: ${current.error.code}`, "retry once Orca answers");
    const run = current.value.runId;
    if (!text(run)) return refuse("no_run", "this session holds no Run", "run-use the Run first");
    return call(deps, { ...parsed.value, callerRun: run });
  });
}

export const decisionOpenFrom = (raw: Raw, deps: DepsSource): Promise<Result<DecisionOpened>> =>
  entrance(parseDecisionOpen(raw), deps, decisionOpen);

export const decisionAnswerFrom = (raw: Raw, deps: DepsSource): Promise<Result<DecisionAnswered>> =>
  entrance(parseDecisionAnswer(raw), deps, decisionAnswer);

/** The CLI's only: queue-monitor's call, and the other Run's resume of a moot (decision 91③ adds no MCP tool). */
export const decisionMootFrom = (raw: Raw, deps: DepsSource): Promise<Result<DecisionMooted>> =>
  entrance(parseDecisionMoot(raw), deps, decisionMoot);
