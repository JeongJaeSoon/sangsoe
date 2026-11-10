import { done, type Result, refuse } from "../notify/result.ts";
import { type BuildOptions, buildBrief, buildGroup, buildItem } from "./build.ts";
import { renderMarkdown, renderTodo } from "./render.ts";
import type { BriefInput } from "./types.ts";

export { type BuildOptions, buildBrief, buildGroup, buildItem } from "./build.ts";
export type { Edge, EdgeKind, GraphRead } from "./graph.ts";
export { group_brief, group_items } from "./group.ts";
export { type ItemFacts, itemFacts, item_status } from "./item_status.ts";
export { briefRuns, type LoadOptions, loadBriefInput, readSnapshot } from "./load.ts";
export { owner_todo } from "./owner_todo.ts";
export {
  ACTED_LABEL,
  openPanelCore,
  PANEL_RUN,
  type PanelAct,
  type PanelActed,
  type PanelCore,
  type PanelPorts,
  type PanelTarget,
  type PanelView,
  panelCore,
  panelView,
  STATUS_TEXT_MAX,
  type StatusBarItem,
  statusBarItem,
} from "./panel.ts";
export { type RenderOptions, renderMarkdown, renderTodo } from "./render.ts";
export { replayJsonl } from "./replay.ts";
export type * from "./types.ts";
export { fit, prLabel, tableWidths, textWidth } from "./width.ts";

/** `sangsoe brief` · `sangsoe brief <group>` · `sangsoe brief <group> <item>` as text. */
export function briefText(input: BriefInput, target: { group?: string; item?: string }, opts: BuildOptions = {}): Result<string> {
  if (target.item) {
    const m = buildItem(input, target.item, opts);
    return m ? done(renderMarkdown(m)) : refuse("not_found", `no item ${target.item}`, "sangsoe brief <group> <iNNN>");
  }
  if (target.group) {
    const m = buildGroup(input, target.group, opts);
    return m ? done(renderMarkdown(m)) : refuse("not_found", `no open group ${target.group}`, "sangsoe brief");
  }
  return done(renderMarkdown(buildBrief(input, opts)));
}

/** `sangsoe todo`: the same model's to-do count and owner sections. */
export const todoText = (input: BriefInput, opts: BuildOptions = {}): string => renderTodo(buildBrief(input, opts));
