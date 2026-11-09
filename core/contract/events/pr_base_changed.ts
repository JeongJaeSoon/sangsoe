import { defineEvent, prRef, str } from "../define.ts";

export default defineEvent("pr_base_changed", { pr: prRef, from: str, to: str });
