import { defineEvent, str } from "../define.ts";

export default defineEvent("mention_new", { url: str }, { needs: "judgment" });
