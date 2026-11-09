import { arr, defineEvent, str } from "../define.ts";

export default defineEvent(
  "flow_expanded",
  { flow: str, version: str, parent: str, steps: arr(str) },
  { sources: ["GRAPH"] },
);
