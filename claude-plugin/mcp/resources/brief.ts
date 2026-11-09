import { briefText, loadBriefInput } from "../../../core/index.ts";
import type { ResourceDef } from "../contract.ts";

export default {
  name: "brief",
  uri: "sangsoe://brief",
  description: "현황 stage 1 as the Markdown tables `sangsoe brief` prints; send it to the owner unchanged.",
  mimeType: "text/markdown",
  read: async () => {
    const input = await loadBriefInput({ now: new Date().toISOString() });
    if (!input.ok) throw new Error(`${input.refusal.code}: ${input.refusal.reason}`);
    const text = briefText(input.value, {});
    if (!text.ok) throw new Error(`${text.refusal.code}: ${text.refusal.reason}`);
    return text.value;
  },
} satisfies ResourceDef;
