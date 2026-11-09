import { defineEvent, str } from "../define.ts";

// subject points at the owner_action row; a correction is a newer owner_class row (decision 3).
export default defineEvent("owner_class", { class: str });
