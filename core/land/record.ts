// The recording entrances for what land and GRAPH read (decision 171): `evidence` at a PR head and
// `stage_recorded` after its merge. Each has one core function here, under an MCP tool and a CLI
// command. Like `recordReviewVerdict`, the PR's author and head come from GitHub, and a recorder
// named as the author is refused (the rule `evidenceGaps` applies on read).
import type { Exec } from "../approve/approve.ts";
import { ContractError } from "../contract/index.ts";
import type { Store } from "../store/store.ts";

export type RecordPorts = { exec: Exec; openStore: () => Store };
export type RecordResult = { ok: boolean; note: string };

/** The kinds `requiredEvidence` asks for; owner-queue kinds keep their own writers. */
export const EVIDENCE_KINDS = ["test", "run", "ui", "dev"] as const;
export const STAGES = ["merge", "dev", "prod"] as const;

export type EvidenceRecordInput = {
  repo: string;
  pr: number;
  head: string;
  kind: string;
  exitCode: number;
  notVerified: readonly string[];
  recorder: string;
  /** A large output kept as a file: its path and sha256. */
  path?: string;
  sha256?: string;
};
export type StageRecordInput = { repo: string; pr: number; stage: string; sha: string; recorder: string };

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const FULL_SHA = /^[0-9a-f]{40}$/;
const SHA = /^[0-9a-f]{7,40}$/;
const fail = (note: string): RecordResult => ({ ok: false, note });

function badRef(repo: string, pr: number, recorder: string): string | null {
  if (!REPO.test(repo)) return `repo must be owner/name, got ${repo}`;
  if (!Number.isInteger(pr) || pr < 1) return `pr must be a PR number, got ${pr}`;
  if (!IDENTITY.test(recorder)) return `recorder must be a login or name (letters, digits, _ . -), got ${JSON.stringify(recorder)}`;
  return null;
}

type Pr = { author: string; head: string; merged: boolean };

async function readPr(exec: Exec, repo: string, pr: number): Promise<Pr | string> {
  const r = await exec("gh", ["api", `repos/${repo}/pulls/${pr}`, "--jq", "[.user.login, .head.sha, .merged] | @tsv"]);
  const [login = "", head = "", merged = ""] = r.stdout.trim().split("\t");
  if (r.code !== 0 || !IDENTITY.test(login)) return `cannot read ${repo}#${pr}: ${r.stderr.trim() || r.code}`;
  return { author: login.toLowerCase(), head, merged: merged === "true" };
}

function append(openStore: () => Store, row: Parameters<Store["append"]>[0], note: string): RecordResult {
  let store: Store;
  try {
    store = openStore();
  } catch (e) {
    return fail(`cannot open the store: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    store.append(row);
    return { ok: true, note };
  } catch (e) {
    if (e instanceof ContractError) return fail(e.message);
    throw e;
  } finally {
    store.close();
  }
}

/** One `evidence` row at the PR's current head, written by someone other than its author. */
export async function recordEvidence(input: EvidenceRecordInput, deps: RecordPorts): Promise<RecordResult> {
  const bad = badRef(input.repo, input.pr, input.recorder);
  if (bad) return fail(bad);
  if (!FULL_SHA.test(input.head)) return fail(`head must be a full 40-character sha, got ${input.head}`);
  if (!(EVIDENCE_KINDS as readonly string[]).includes(input.kind)) return fail(`kind must be one of ${EVIDENCE_KINDS.join(", ")}, got ${input.kind}`);
  if (!Number.isInteger(input.exitCode)) return fail(`exit code must be an integer, got ${input.exitCode}`);
  const notVerified = input.notVerified.map((s) => s.trim()).filter((s) => s.length > 0);
  if (notVerified.length === 0) return fail("not_verified must name at least one thing this run did not check");
  if ((input.path === undefined) !== (input.sha256 === undefined)) return fail("path and sha256 go together");

  const pr = await readPr(deps.exec, input.repo, input.pr);
  if (typeof pr === "string") return fail(pr);
  if (pr.head !== input.head) return fail(`${input.head} is not the head of ${input.repo}#${input.pr} (${pr.head})`);
  const recorder = input.recorder.toLowerCase();
  if (recorder === pr.author) return fail(`${input.recorder} is the author of ${input.repo}#${input.pr}; its author cannot record its evidence`);

  const ref = `${input.repo.toLowerCase()}#${input.pr}`;
  return append(
    deps.openStore,
    {
      type: "evidence",
      source: "evidence record",
      subject: ref,
      actor: recorder,
      payload: {
        kind: input.kind,
        head_sha: input.head,
        exit_code: input.exitCode,
        not_verified: notVerified,
        ...(input.path !== undefined && input.sha256 !== undefined ? { path: input.path, sha256: input.sha256 } : {}),
      },
    },
    `recorded: ${input.kind} evidence on ${ref} ${input.head} by ${recorder}, exit ${input.exitCode}`,
  );
}

/** One `stage_recorded` row for a merged PR, written by someone other than its author. */
export async function recordStage(input: StageRecordInput, deps: RecordPorts): Promise<RecordResult> {
  const bad = badRef(input.repo, input.pr, input.recorder);
  if (bad) return fail(bad);
  if (!(STAGES as readonly string[]).includes(input.stage)) return fail(`stage must be one of ${STAGES.join(", ")}, got ${input.stage}`);
  if (!SHA.test(input.sha)) return fail(`sha must be a git sha (7 to 40 hex), got ${input.sha}`);

  const pr = await readPr(deps.exec, input.repo, input.pr);
  if (typeof pr === "string") return fail(pr);
  if (!pr.merged) return fail(`${input.repo}#${input.pr} has not merged; a stage is recorded after the merge`);
  const recorder = input.recorder.toLowerCase();
  if (recorder === pr.author) return fail(`${input.recorder} is the author of ${input.repo}#${input.pr}; its author cannot record its stages`);

  const ref = `${input.repo.toLowerCase()}#${input.pr}`;
  return append(
    deps.openStore,
    { type: "stage_recorded", source: "stage record", actor: recorder, payload: { pr: ref, stage: input.stage as (typeof STAGES)[number], sha: input.sha } },
    `recorded: ${ref} ${input.stage} at ${input.sha} by ${recorder}`,
  );
}
