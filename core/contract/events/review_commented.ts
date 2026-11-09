import { defineEvent, prRef, who } from "../define.ts";

export default defineEvent("review_commented", { pr: prRef, reviewer: who }, { needs: "action" });
