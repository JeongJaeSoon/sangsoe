import { defineEvent, edgeKind, str } from "../define.ts";

export default defineEvent("edge_removed", { pred: str, succ: str, kind: edgeKind, reason: str });
