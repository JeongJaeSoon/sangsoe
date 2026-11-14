import { homedir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { judgeLoad, sampleLoad, waitForLoad } from "../../core/index.ts";
import type { CommandDef, Report } from "../contract.ts";

// Decision 256: the session a [gate:pressure] refusal names runs this with run_in_background; its exit
// wakes that session once. Both endings exit 0, so the wake is never read as a failed command.

export default {
  name: "pressure wait",
  summary: "wait in the background until the load the pressure gate reads is ok twice in a row (decision 256)",
  usage: "",
  async run({ host }): Promise<Report> {
    const home = host.env.HOME ?? homedir();
    const r = await waitForLoad({ load: () => judgeLoad(sampleLoad(home)), now: Date.now, sleep: (ms) => sleep(ms) });
    return { code: 0, lines: r.lines };
  },
} satisfies CommandDef;
