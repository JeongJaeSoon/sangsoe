import { defineEvent, orcaId } from "../define.ts";

export default defineEvent("run_stalled", { run: orcaId }, { needs: "judgment" });
