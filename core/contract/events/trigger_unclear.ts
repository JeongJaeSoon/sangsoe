import { defineEvent, orcaId } from "../define.ts";

export default defineEvent("trigger_unclear", { task: orcaId }, { needs: "judgment" });
