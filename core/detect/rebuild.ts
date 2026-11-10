import type { MonitorDeps, MonitorReport, Planned, Written } from "./monitor.ts";
import { orcaRound } from "./orca/round.ts";
import { prRound } from "./pr/round.ts";

/** The readers whose rows are host facts (core/store/backup.ts HOST_TYPES). */
const READERS = { orca: orcaRound, pr: prRound } as const;

export type Reread = { written: Written[]; unseen: string[]; acts: MonitorReport["acts"] };

/**
 * After the database was lost (decision 184): one pass of the orca and pr readers that writes what
 * they see and runs only their wake acts, so nothing re-observed closes a Task or adds a reference,
 * while a wake the hosts' state now calls for (a PR that became ready to merge meanwhile) still goes
 * out. Token-free; the rows come from Orca and GitHub as they are now.
 */
export async function rereadHostRows(d: MonitorDeps, signal: AbortSignal = new AbortController().signal): Promise<Reread> {
  const out: Reread = { written: [], unseen: [], acts: [] };
  const append = d.append;
  if (!append) return out;
  const write = (e: Planned) => {
    const a = append(e);
    out.written.push({ type: e.type, dedupe_key: e.dedupe_key ?? null, seq: a.seq, inserted: a.inserted });
  };
  for (const [name, read] of Object.entries(READERS)) {
    const { planned, unseen, acts = [] } = await read(d, signal);
    out.unseen.push(...unseen.map((u) => `${name}: ${u}`));
    if (signal.aborted) return out;
    for (const e of planned) write(e);
    for (const act of acts.filter((a) => a.wake)) {
      if (signal.aborted) return out;
      const r = await act.run(d);
      out.acts.push({ what: act.what, ok: r.ok, detail: r.detail });
      for (const e of r.planned) write(e);
    }
  }
  append({
    type: "signal",
    source: "store",
    payload: { kind: "host_rows_reread", reason: `${out.written.length} row(s) read again${out.unseen.length ? `; not seen: ${out.unseen.join(", ")}` : ""}` },
  });
  return out;
}
