import type { MonitorDeps, Written } from "./monitor.ts";
import { orcaRound } from "./orca/round.ts";
import { prRound } from "./pr/round.ts";

/** The readers whose rows are host facts (core/store/backup.ts HOST_TYPES). */
const READERS = { orca: orcaRound, pr: prRound } as const;

export type Reread = { written: Written[]; unseen: string[] };

/**
 * After the database was lost (decision 184): one pass of the orca and pr readers that writes what
 * they see and runs none of their acts, so nothing re-observed sends a message or closes a Task.
 * Token-free; the rows come from Orca and GitHub as they are now.
 */
export async function rereadHostRows(d: MonitorDeps, signal: AbortSignal = new AbortController().signal): Promise<Reread> {
  const out: Reread = { written: [], unseen: [] };
  if (!d.append) return out;
  for (const [name, read] of Object.entries(READERS)) {
    const { planned, unseen } = await read(d, signal);
    out.unseen.push(...unseen.map((u) => `${name}: ${u}`));
    if (signal.aborted) return out;
    for (const e of planned) {
      const a = d.append(e);
      out.written.push({ type: e.type, dedupe_key: e.dedupe_key ?? null, seq: a.seq, inserted: a.inserted });
    }
  }
  d.append({
    type: "signal",
    source: "store",
    payload: { kind: "host_rows_reread", reason: `${out.written.length} row(s) read again${out.unseen.length ? `; not seen: ${out.unseen.join(", ")}` : ""}` },
  });
  return out;
}
