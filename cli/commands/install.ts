import { install, realCheckContext, treeRoot } from "../../core/index.ts";
import type { CommandDef } from "../contract.ts";

export default {
  name: "install",
  summary: "register this tree with Claude Code and Orca (idempotent), then run doctor",
  usage: "",
  run: ({ host }) => {
    const root = treeRoot(host);
    return install(host, root, realCheckContext(root));
  },
} satisfies CommandDef;
