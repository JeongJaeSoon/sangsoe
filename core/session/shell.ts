import { itemFacts } from "../brief/item_status.ts";
import { briefRuns, readSnapshot } from "../brief/load.ts";
import { dedupeKey, EVENTS } from "../contract/index.ts";
import type { CoreDeps } from "../notify/result.ts";
import { linkShell, recordShellLink, type ShellLine } from "../owner/link.ts";
import { hashOf, mask, summarize } from "./mask.ts";
import type { SessionRow } from "./session.ts";
import { shellInputs, tail } from "./transcript.ts";

const SOURCE = "owner_input";

/**
 * Reads the owner's `!` commands from the transcript (decision 91⑥(1)(b), 92 (나)) and records each
 * once by its record uuid: the masked owner_action row here, the link by core/owner's linkShell
 * (decision 146). Linking reads the items' state, so a new line first reads Orca; when Orca does not
 * answer nothing is written and the next hook reads the line again.
 */
export async function recordShellInputs(deps: CoreDeps, row: SessionRow, session: string, transcriptPath: string | undefined): Promise<number> {
  const inputs = shellInputs(tail(transcriptPath));
  if (inputs.length === 0) return 0;
  const events = deps.store.events();
  const seen = new Set(events.filter((e) => e.type === "owner_action").map((e) => e.dedupe_key));
  const fresh = inputs.map((s) => ({ s, key: dedupeKey(EVENTS.owner_action, session, s.uuid) })).filter((x) => !seen.has(x.key));
  if (fresh.length === 0) return 0;
  const current = await deps.orca.runCurrent();
  // An unanswered run-current would drop the Run that holds the owner items and link nothing for good.
  if (!current.ok) return 0;
  const snap = await readSnapshot(deps.orca, briefRuns(events, current.value.runId));
  if (!snap.ok) return 0;
  // Rows this loop writes are input and marks, never state, so one fold serves every line.
  const input = { events, orca: snap.value, now: new Date().toISOString() };
  const facts = itemFacts(input);
  let n = 0;
  for (const { s, key } of fresh) {
    const masked = mask(s.command);
    const action = deps.store.appendOwnerAction(
      {
        type: "owner_action",
        source: SOURCE,
        ...(row.task ? { entity: "task", entity_id: row.task } : {}),
        dedupe_key: key,
        payload: { origin: "shell", summary: summarize(masked), hash: hashOf(masked), cc_session: session, cc_message: s.uuid },
      },
      masked,
    );
    if (!action.inserted) continue;
    // The transcript carries no exit code (P13) and the session's repo is not read here.
    const line: ShellLine = { uuid: s.uuid, command: s.command, exitCode: null, stdout: s.stdout, stderr: s.stderr, repo: null, ts: s.ts ?? "" };
    recordShellLink(deps.store, line, linkShell(input, facts, line), SOURCE, action.seq);
    n++;
  }
  return n;
}
