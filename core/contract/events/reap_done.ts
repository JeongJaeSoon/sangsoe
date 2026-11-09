import { defineEvent, refOrcaIdForWorktree, str } from "../define.ts";

// One row per removed resource; Docker is one id per row.
export default defineEvent("reap_done", { kind: str, ref: str }, { refine: refOrcaIdForWorktree });
