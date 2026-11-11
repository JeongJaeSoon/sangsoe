import { defineEvent, str } from "../define.ts";

// command_file: the path of the file holding the refused command, never the command text. act and
// category are that file's `Act:` and `Category:` header lines (decision 196), read by orca-monitor
// from the refused session's escalation.
export default defineEvent("refusal_report", { act: str, category: str, command_file: str }, { needs: "judgment" });
