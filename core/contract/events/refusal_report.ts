import { defineEvent, str } from "../define.ts";

// command_file: the path of the file holding the refused command, never the command text.
// No writer yet: the source is the refused session's escalation, read from Orca by orca-monitor (decision 193).
export default defineEvent("refusal_report", { act: str, category: str, command_file: str }, { needs: "judgment" });
