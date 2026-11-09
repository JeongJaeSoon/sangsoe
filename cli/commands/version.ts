import { VERSION } from "../../core/index.ts";
import type { CommandDef } from "../contract.ts";

export default {
  name: "version",
  summary: "print the sangsoe version",
  usage: "",
  run: () => ({ ok: true, value: `sangsoe ${VERSION}` }),
} satisfies CommandDef;
