import { defineEvent, str } from "../define.ts";

// command_file: the path of the file holding the refused command, never the command text.
export default defineEvent("refusal_report", { act: str, category: str, command_file: str }, { needs: "judgment" });
