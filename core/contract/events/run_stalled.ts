import { defineEvent, opt, orcaId, str } from "../define.ts";

// `session`: the Dispatch-less coordinator whose Run mail sits unread (decision 245); absent when every worker of the Run stalled.
export default defineEvent("run_stalled", { run: orcaId, session: opt(str) }, { needs: "judgment" });
