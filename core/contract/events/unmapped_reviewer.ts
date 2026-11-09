import { defineEvent, who } from "../define.ts";

export default defineEvent("unmapped_reviewer", { reviewer: who }, { needs: "action" });
