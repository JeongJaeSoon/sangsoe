import { defineEvent, orcaId } from "../define.ts";

export default defineEvent("decision_untracked", { gate: orcaId }, { needs: "judgment" });
