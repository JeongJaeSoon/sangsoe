import { defineEvent, orcaId } from "../define.ts";

export default defineEvent("todo_due", { task: orcaId }, { needs: "action" });
