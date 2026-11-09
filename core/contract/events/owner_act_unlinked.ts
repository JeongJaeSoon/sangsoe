import { defineEvent, str } from "../define.ts";

// Something the owner did (a watched `!` command, a GitHub action) that answers no open item or decision.
export default defineEvent("owner_act_unlinked", { act: str }, { needs: "judgment" });
