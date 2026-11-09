import { defineEvent, edgeKind, str } from "../define.ts";

// source must be GRAPH, the only entrance for edges (decision 27).
export default defineEvent("edge_added", { pred: str, succ: str, kind: edgeKind }, { dedupe: "edge" });
