import { doctor, treeRoot } from "../../core/index.ts";
import type { CommandDef } from "../contract.ts";

export default {
  name: "doctor",
  summary: "check the install; --offline checks only the installed tree",
  usage: "[--offline]",
  options: { offline: { type: "boolean" } },
  run: ({ values, host }) => doctor(host, treeRoot(host), { offline: values.offline === true }),
} satisfies CommandDef;
