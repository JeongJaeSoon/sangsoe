import { install, treeRoot } from "../../core/index.ts";
import type { CommandDef } from "../contract.ts";

export default {
  name: "install",
  summary: "register this tree with Claude Code and Orca (idempotent), then run doctor",
  usage: "",
  run: ({ host, checkContext }) => {
    const root = treeRoot(host);
    return install(host, root, checkContext(root));
  },
} satisfies CommandDef;
