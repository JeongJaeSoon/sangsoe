import { defineEvent, orcaId } from "../define.ts";

export default defineEvent("wake_unconfirmed", { msg_id: orcaId }, { needs: "judgment" });
