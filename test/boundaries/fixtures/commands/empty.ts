import type { CommandDef } from "../../../../cli/contract.ts";

export default {
  name: "empty",
  summary: "does nothing",
  usage: "",
  run: () => ({ ok: true, value: null }),
} satisfies CommandDef;
