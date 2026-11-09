import { defineEvent, edgeKind, str } from "../define.ts";

// GRAPH is the only entrance for edges (decision 27); its cycle check is U7's. dedupe_key edge:<pred>:<succ>:<kind>.
export default defineEvent(
  "edge_added",
  { pred: str, succ: str, kind: edgeKind },
  { dedupe: "edge", dedupeBound: (p) => [p.pred, p.succ, p.kind], dedupeClosed: true, sources: ["GRAPH"] },
);
