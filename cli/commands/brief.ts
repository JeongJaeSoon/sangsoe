import { briefText, loadBriefInput } from "../../core/index.ts";
import type { CommandArgs, CommandDef, Outcome } from "../contract.ts";

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Shared by brief and todo: read-only input from the store and Orca, or from fixture files. */
export function loadOptions(values: CommandArgs["values"]) {
  const eventsFile = str(values.events);
  const orcaFile = str(values.orca);
  return {
    now: str(values.now) ?? new Date().toISOString(),
    runs: list(values.run),
    ...(eventsFile ? { eventsFile } : {}),
    ...(orcaFile ? { orcaFile } : {}),
  };
}

export const INPUT_OPTIONS = {
  run: { type: "string", multiple: true },
  events: { type: "string" },
  orca: { type: "string" },
  now: { type: "string" },
} as const;

export async function brief({ values, positionals }: Pick<CommandArgs, "values" | "positionals">): Promise<Outcome> {
  const input = await loadBriefInput(loadOptions(values));
  if (!input.ok) return input;
  const [group, item] = positionals;
  return briefText(input.value, { ...(group ? { group } : {}), ...(item ? { item } : {}) });
}

export default {
  name: "brief",
  summary: "현황: four tables (stage 1), a group's detail (stage 2) or an item's chain (stage 3); writes nothing",
  usage: "[<group> [<iNNN>]] [--run <run id>]... [--events <jsonl> --orca <snapshot.json> --now <iso>]",
  options: INPUT_OPTIONS,
  maxPositionals: 2,
  run: (a) => brief(a),
} satisfies CommandDef;
