import { type BriefInput, loadBriefInput, readiness, renderWhy } from "../../../core/index.ts";
import type { ResourceDef } from "../contract.ts";

/** The 🟢 items a lead may start, then why each waiting item is not ready, over the Runs `brief` reads. */
export function readyText(input: BriefInput): string {
  const reports = readiness(input);
  const start = reports.filter((r) => r.readiness === "ready");
  const waiting = reports.filter((r) => r.readiness !== "ready" && r.readiness !== "not_waiting");
  const lines = start.length > 0 ? start.map((r) => `🟢 ${r.item}  ${r.task}`) : ["준비된 항목 없음"];
  return [lines.join("\n"), ...waiting.map(renderWhy)].join("\n\n");
}

export default {
  name: "ready",
  uri: "sangsoe://ready",
  description:
    "Items a lead may start (🟢, owner-started ones excluded), then for each waiting item why it is not ready: blocking predecessor, edge kind, its state, what to do.",
  mimeType: "text/markdown",
  read: async () => {
    const input = await loadBriefInput({ now: new Date().toISOString() });
    if (!input.ok) throw new Error(`${input.refusal.code}: ${input.refusal.reason}`);
    return readyText(input.value);
  },
} satisfies ResourceDef;
