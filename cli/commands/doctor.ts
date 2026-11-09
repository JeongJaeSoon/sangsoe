import { doctor, treeRoot } from "../../core/index.ts";
import type { CommandDef } from "../contract.ts";

export default {
  name: "doctor",
  summary: "check the install; --offline checks only the installed tree",
  usage: "[--offline]",
  options: { offline: { type: "boolean" } },
  run: ({ values, host, checkContext }) => {
    const root = treeRoot(host);
    return doctor(host, root, values.offline === true ? { offline: true } : { ctx: checkContext(root) });
  },
} satisfies CommandDef;
