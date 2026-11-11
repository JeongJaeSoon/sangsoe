import { localStamp } from "./time.ts";
import type { BriefModel, Cell, Column, GroupDetail, ItemDetail, Overview, Table } from "./types.ts";
import { fit, textWidth } from "./width.ts";

export interface RenderOptions {
  readonly maxWidth: number;
}

// Cuts and escapes only: every number below is read from the model, none is counted here.

function cell(c: Cell, col: Column): string {
  const tail = c.tail ?? "";
  const body = fit(c.text, col.max - textWidth(tail)) + tail;
  const shown = c.strong ? `**${body}**` : body;
  const label = shown.replaceAll("|", "\\|").replaceAll("\n", " ");
  return c.link ? `[${label}](${c.link})` : label;
}

function grid(t: Table): string[] {
  return [
    `| ${t.columns.map((c) => c.name).join(" | ")} |`,
    `|${t.columns.map(() => "---").join("|")}|`,
    ...t.rows.map((r) => `| ${r.cells.map((c, i) => cell(c, t.columns[i] ?? { name: "", max: 78 })).join(" | ")} |`),
  ];
}

function section(t: Table, emptyText: string | null): string[] {
  const head = `### ${t.title} ${t.count}`;
  if (t.rows.length === 0) return emptyText ? [head, "", emptyText, ""] : [];
  return [head, "", ...grid(t), ""];
}

const stamp = localStamp;

function overview(m: Overview): string[] {
  const s = m.summary;
  return [
    `현황 · ${stamp(m.now)} · 묶음 ${m.groups} · 내가 할 일 ${m.todo.total} (결정 ${m.todo.decisions} + 할 일 ${m.todo.other})`,
    "",
    `✅ 완료 ${s.done}건 · 🔄 진행 중 ${s.doing}건 · 남은 것 ${s.left}건 · 🚧 막힌 것 ${s.blocked}건`,
    "",
    ...section(m.decisions, "없음"),
    ...section(m.ownerTodo, "없음"),
    ...section(m.inProgress, "없음"),
    ...(m.onHold ? section(m.onHold, null) : []),
    `완료는 최근 ${m.doneDays}일 · 🔍 근거 부족 ${m.evidenceShort} · 상세: \`sangsoe brief <묶음>\``,
    ...(m.advisorToday ? [m.advisorToday] : []),
    ...(m.restartDue ?? []),
  ];
}

function group(m: GroupDetail): string[] {
  const edges = m.edges.map((e) => `- ${e.pred} → ${e.succ} (${e.kind}${e.met === null ? ", 외부 선행" : e.met ? ", 충족" : ""})`);
  return [
    `묶음 상세 · ${m.lead} ${m.priority} · ${m.items}건·막힘 ${m.blockedCount} · ${stamp(m.now)}`,
    "",
    `크리티컬 패스: ${m.criticalPath.length > 0 ? `${m.criticalPath.join(" → ")} (추정)` : "없음"}`,
    "",
    "### 의존",
    "",
    ...(edges.length > 0 ? edges : ["없음"]),
    "",
    ...section(m.why, "없음"),
    ...m.sections.flatMap((t) => section(t, null)),
    `✅ 완료 ${m.doneFolded}건 (접힘) · 항목: \`sangsoe brief ${m.lead} <항목>\``,
  ];
}

function item(m: ItemDetail): string[] {
  return [
    `항목 상세 · ${m.id} ${m.title} · ${m.state}${m.flags} · ${m.who} · ${m.priority}`,
    ...(m.model ? [m.model] : []),
    "",
    ...section(m.chain, "없음"),
  ];
}

/** The text every surface sends: chat, `sangsoe brief`, the MCP resource `brief`. */
export function renderMarkdown(model: BriefModel, _opts: RenderOptions = { maxWidth: 78 }): string {
  const lines = model.stage === 1 ? overview(model) : model.stage === 2 ? group(model) : item(model);
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

/** `sangsoe todo`: the header count and the two owner sections of the same model. */
export function renderTodo(m: Overview): string {
  const lines = [
    `내가 할 일 ${m.todo.total} (결정 ${m.todo.decisions} + 할 일 ${m.todo.other})`,
    "",
    ...section(m.decisions, "없음"),
    ...section(m.ownerTodo, "없음"),
  ];
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}
