import { defineEvent, str } from "../define.ts";

export default defineEvent("worker_stuck", { reason: str }, { needs: "judgment" });
