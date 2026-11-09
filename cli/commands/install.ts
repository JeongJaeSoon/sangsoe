import { install, treeRoot } from "../../core/index.ts";
import type { CommandDef } from "../contract.ts";

export default {
  name: "install",
  summary: "register this tree with Claude Code and Orca (idempotent), then run doctor",
  usage: "",
  run: ({ host }) => install(host, treeRoot(host)),
} satisfies CommandDef;
