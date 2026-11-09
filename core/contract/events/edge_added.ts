import { defineEvent, edgeKind, str } from "../define.ts";

// GRAPH is the only entrance for edges (decision 27). dedupe_key edge:<pred>:<succ>:<kind>[:<n>], where
// n is how many times the edge was removed before, so re-adding a removed edge is a new row (decision 0126).
export default defineEvent(
  "edge_added",
  { pred: str, succ: str, kind: edgeKind },
  { dedupe: "edge", dedupeBound: (p) => [p.pred, p.succ, p.kind], sources: ["GRAPH"] },
);
