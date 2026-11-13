import { defineEvent, opt, orcaId, str } from "../define.ts";

// `coordinator`: the terminal handle of a Dispatch-less coordinator whose Run mail sits unread (decision 245); absent when every worker of the Run stalled.
export default defineEvent("run_stalled", { run: orcaId, coordinator: opt(str) }, { needs: "judgment" });
