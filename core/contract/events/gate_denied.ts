import { defineEvent, str } from "../define.ts";

// `command_file` is the path of the file holding the denied command, never the command text.
export default defineEvent("gate_denied", { gate: str, command_file: str });
