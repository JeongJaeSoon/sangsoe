import { uninstall } from "../../core/index.ts";
import type { CommandDef } from "../contract.ts";

export default {
  name: "uninstall",
  summary: "remove those registrations; data and settings stay",
  usage: "",
  run: ({ host }) => uninstall(host),
} satisfies CommandDef;
