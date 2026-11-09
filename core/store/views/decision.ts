import type { DecisionRow, DecisionView } from "../../contract/index.ts";

type Mutable = {
  -readonly [K in keyof DecisionRow]: K extends "waiters" ? { task: string; gate: string | null }[] : DecisionRow[K];
};

const s = (v: unknown): string | null => (typeof v === "string" ? v : null);

// Folds decision_opened · decision_joined · decision_answered · decision_closed. Question text and
// options are the Orca gate's; whether an answer reached a waiter is read from the gate's state now.
export const decision: DecisionView = (input) => {
  const rows = new Map<string, Mutable>();
  for (const e of input.events) {
    const p = e.payload;
    const no = s(p.decision);
    if (!no) continue;
    if (e.type === "decision_opened") {
      const task = s(p.task);
      rows.set(no, {
        decision: no,
        decisionKey: s(p.decision_key) ?? "",
        state: "open",
        answer: null,
        linkedBy: null,
        closedReason: null,
        waiters: task ? [{ task, gate: s(p.gate) }] : [],
        undelivered: false,
      });
      continue;
    }
    const row = rows.get(no);
    if (!row) continue;
    if (e.type === "decision_joined") {
      const task = s(p.waiter);
      if (task) row.waiters.push({ task, gate: s(p.gate) });
    } else if (e.type === "decision_answered") {
      // One answer per decision; a late answer is recorded but never reopens or replaces it.
      if (row.state === "open" && p.late !== true) {
        row.state = "answered";
        row.answer = s(p.answer);
        row.linkedBy = s(p.linked_by);
      }
    } else if (e.type === "decision_closed" && row.state !== "closed") {
      row.state = "closed";
      row.closedReason = p.reason === "moot" ? "moot" : "answered";
    }
  }
  const openGates = new Set(input.orca.gates.filter((g) => g.open).map((g) => g.id));
  return [...rows.values()].map((r) => ({
    ...r,
    undelivered: r.state === "answered" && r.waiters.some((w) => w.gate !== null && openGates.has(w.gate)),
  }));
};
