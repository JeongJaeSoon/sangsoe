import {
  type BriefInput,
  createGhClient,
  loadBriefInput,
  memoryGhCache,
  nodeExec,
  type Overlaps,
  overlapLines,
  prOverlaps,
  readiness,
  readWatchConfig,
  renderWhy,
} from "../../../core/index.ts";
import type { ResourceDef } from "../contract.ts";

/** The 🟢 items a lead may start, why each waiting item is not ready, then open PRs that change the same file. */
export function readyText(input: BriefInput, overlaps: Overlaps = { overlaps: [], unseen: [] }): string {
  const reports = readiness(input);
  const start = reports.filter((r) => r.readiness === "ready");
  const waiting = reports.filter((r) => r.readiness !== "ready" && r.readiness !== "not_waiting");
  const lines = start.length > 0 ? start.map((r) => `🟢 ${r.item}  ${r.task}`) : ["준비된 항목 없음"];
  const overlap = overlapLines(overlaps);
  return [lines.join("\n"), ...waiting.map(renderWhy), ...(overlap.length > 0 ? [overlap.join("\n")] : [])].join("\n\n");
}

export default {
  name: "ready",
  uri: "sangsoe://ready",
  description:
    "Items a lead may start (🟢, owner-started ones excluded), then for each waiting item why it is not ready: blocking predecessor, edge kind, its state, what to do. Last, open PRs on the same base that change the same file (decision 252), so the land order is set before one conflicts.",
  mimeType: "text/markdown",
  read: async () => {
    const input = await loadBriefInput({ now: new Date().toISOString() });
    if (!input.ok) throw new Error(`${input.refusal.code}: ${input.refusal.reason}`);
    const gh = createGhClient({ exec: nodeExec(), cache: memoryGhCache(), now: () => Date.now() });
    const overlaps = await prOverlaps({ events: input.value.events, gh, repos: readWatchConfig()?.repos ?? [] });
    return readyText(input.value, overlaps);
  },
} satisfies ResourceDef;
