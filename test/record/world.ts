import { join } from "node:path";
import { type ApproveExec, fixedClock, Store } from "../../core/index.ts";
import { scratchDir } from "../scratch.ts";

// One fake world for evidence_record, stage_record, their CLI commands and land: GitHub answers
// through a fake exec, the session's checkout is whatever `session` says, and the store is a file
// every entrance reopens.

export const REPO = "acme/api";
export const HEAD = "a".repeat(40);
export const PR_BRANCH = "feat/api-retry";

const dir = scratchDir("sangsoe-record-");
let n = 0;

export const world = {
  dir,
  dbPath: join(dir, "s0.db"),
  author: "alice",
  merged: false,
  /** The calling session's checkout: `git rev-parse HEAD --abbrev-ref HEAD`, or null for no repo. */
  session: { sha: "b".repeat(40), branch: "lead/program" } as { sha: string; branch: string } | null,
  calls: [] as string[],
};

export function reset(): void {
  world.dbPath = join(dir, `s${++n}.db`);
  world.author = "alice";
  world.merged = false;
  world.session = { sha: "b".repeat(40), branch: "lead/program" };
  world.calls = [];
}

export const openStore = (): Store =>
  Store.open({ path: world.dbPath, clock: fixedClock("2026-11-10T00:00:00.000Z", 1000), fsProbe: () => "apfs" });

export const exec: ApproveExec = async (cmd, args) => {
  world.calls.push([cmd, ...args].join(" "));
  const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });
  if (cmd === "git") {
    return world.session ? ok(`${world.session.sha}\n${world.session.branch}\n`) : { code: 128, stdout: "", stderr: "fatal: not a git repository" };
  }
  const jq = args[args.length - 1];
  if (args[1] !== `repos/${REPO}/pulls/12`) return { code: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" };
  if (jq === ".head.ref") return ok(`${PR_BRANCH}\n`);
  return ok(`${world.author}\t${HEAD}\t${world.merged}\n`);
};

export const ports = () => ({ exec, openStore });

export const rows = (type: "evidence" | "stage_recorded") => {
  const s = openStore();
  try {
    return s.events({ type }).map((e) => ({ actor: e.actor, subject: e.subject, payload: e.payload }));
  } finally {
    s.close();
  }
};
