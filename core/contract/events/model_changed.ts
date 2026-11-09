import { defineEvent, str } from "../define.ts";

export default defineEvent("model_changed", { from: str, to: str, reason: str });
