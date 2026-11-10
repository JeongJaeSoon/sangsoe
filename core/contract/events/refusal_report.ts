import { defineEvent, str } from "../define.ts";

// command_file: the path of the file holding the refused command, never the command text.
// No writer yet: its designed source, the PermissionDenied hook, is not registered (decision 177).
export default defineEvent("refusal_report", { act: str, category: str, command_file: str }, { needs: "judgment" });
