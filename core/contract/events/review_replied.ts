import { defineEvent, prRef, who } from "../define.ts";

export default defineEvent("review_replied", { pr: prRef, by: who });
