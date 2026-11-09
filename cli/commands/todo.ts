import { loadBriefInput, todoText } from "../../core/index.ts";
import type { CommandArgs, CommandDef, Outcome } from "../contract.ts";
import { INPUT_OPTIONS, loadOptions } from "./brief.ts";

export async function todo({ values }: Pick<CommandArgs, "values">): Promise<Outcome> {
  const input = await loadBriefInput(loadOptions(values));
  return input.ok ? { ok: true, value: todoText(input.value) } : input;
}

export default {
  name: "todo",
  summary: "내가 할 일: owner_todo's count and rows, the same as the brief's top line; writes nothing",
  usage: "[--run <run id>]... [--events <jsonl> --orca <snapshot.json> --now <iso>]",
  options: INPUT_OPTIONS,
  run: (a) => todo(a),
} satisfies CommandDef;
