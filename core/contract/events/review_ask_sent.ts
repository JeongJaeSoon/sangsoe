import { bool, defineEvent, opt, prRef, who } from "../define.ts";

export default defineEvent("review_ask_sent", { pr: prRef, reviewer: who, reminder: opt(bool) });
