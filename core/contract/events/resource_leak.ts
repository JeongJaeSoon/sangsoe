import { defineEvent, str } from "../define.ts";

export default defineEvent("resource_leak", { kind: str, ref: str });
