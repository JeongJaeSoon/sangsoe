// Item state transition table (appendix #schema "항목 상태 전이표"; design §6 calls the same 19/30
// split a schema invariant — split X10 settles on "transition table"). There is no state table:
// a transition is an Orca task-update plus one item_transition event, and this table says which
// calls are allowed.

export const ITEM_STATES = ["planned", "ready", "in_progress", "blocked", "on_hold", "done", "cancelled"] as const;
export type ItemState = (typeof ITEM_STATES)[number];

export const STATE_LABEL: Readonly<Record<ItemState, string>> = {
  planned: "📅 예정",
  ready: "🟢 준비됨",
  in_progress: "🔄 진행 중",
  blocked: "🚧 막힘",
  on_hold: "⏸️ 보류",
  done: "✅ 완료",
  cancelled: "🗑️ 취소",
};

export const ALLOWED_TRANSITIONS: Readonly<Record<ItemState, readonly ItemState[]>> = {
  planned: ["ready", "on_hold", "cancelled"],
  ready: ["in_progress", "done", "on_hold", "cancelled"],
  in_progress: ["blocked", "on_hold", "done", "cancelled", "ready"],
  blocked: ["in_progress", "on_hold", "done", "cancelled"],
  on_hold: ["planned", "ready", "cancelled"],
  done: [],
  cancelled: [],
};

export function canTransition(from: ItemState, to: ItemState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
