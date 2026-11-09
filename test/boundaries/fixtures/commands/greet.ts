import type { CommandDef } from "../../../../cli/contract.ts";
import { greet } from "../greet.ts";

export default {
  name: "greet",
  summary: "greet someone, or refuse when asked",
  usage: "[--who NAME] [--refuse]",
  options: { who: { type: "string" }, refuse: { type: "boolean" } },
  run: ({ values }) => greet((values.who as string | undefined) ?? "world", values.refuse === true),
} satisfies CommandDef;
