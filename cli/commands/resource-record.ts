import { lazyStore, nodeExec, type RecordInput, resourceRecord } from "../../core/index.ts";
import type { CommandArgs, CommandDef, Outcome } from "../contract.ts";

const USAGE = "--owner <task or worktree id> (--kind <container|volume|network|image> --ref <id> | --compose <project>) [--action created|released]";

export async function resourceRecordCommand(values: CommandArgs["values"]): Promise<Outcome> {
  const input: RecordInput = { owner: "" };
  for (const o of ["owner", "kind", "ref", "compose", "action"] as const) {
    const v = values[o];
    if (typeof v === "string") (input as Record<string, string>)[o] = v;
  }
  const store = lazyStore();
  try {
    return await resourceRecord(store, nodeExec(30_000), input);
  } finally {
    store.close();
  }
}

export default {
  name: "resource record",
  summary: "record a Docker id (or a compose project's ids) you just made, so REAPER may clear it once the work is done",
  usage: USAGE,
  required: ["owner"],
  options: {
    owner: { type: "string" },
    kind: { type: "string" },
    ref: { type: "string" },
    compose: { type: "string" },
    action: { type: "string" },
  },
  run: ({ values }) => resourceRecordCommand(values),
} satisfies CommandDef;
