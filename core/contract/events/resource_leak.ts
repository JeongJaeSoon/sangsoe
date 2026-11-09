import { defineEvent, refOrcaIdForWorktree, str } from "../define.ts";

export default defineEvent("resource_leak", { kind: str, ref: str }, { refine: refOrcaIdForWorktree });
