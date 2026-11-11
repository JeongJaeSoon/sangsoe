import assert from "node:assert/strict";
import { test } from "node:test";
import { type BriefInput, panelView, renderMarkdown, Store } from "../../core/index.ts";

// G10 (decision 212 ①): restart_due's designed callers are `sangsoe brief` and status bar item B
// (design N1). Only a role's latest orchestrator or lead session is named.

function input(fill: (s: Store) => void): BriefInput {
  const s = Store.open({ path: ":memory:" });
  try {
    fill(s);
    return { orca: { tasks: [], gates: [] }, events: s.events(), now: "2026-11-11T12:00:00Z" } as BriefInput;
  } finally {
    s.close();
  }
}

const started = (s: Store, session: string, role: string, run: string, source = "startup") =>
  s.append({ type: "session_started", source: "hook", target: `run:${run}`, dedupe_key: `session_started:${session}:${source}`, payload: { session, role, model: "m" } });
const compactions = (s: Store, session: string, n: number) => {
  for (let i = 0; i < n; i++) s.append({ type: "compacted", source: "hook", payload: { session, trigger: "auto", pre_tokens: 1000 } });
};

test("a lead session past the compaction rule shows in the brief and on status bar item B", () => {
  const i = input((s) => {
    started(s, "sess_lead", "lead", "run_a");
    compactions(s, "sess_lead", 3);
  });
  const v = panelView(i, {});
  assert.ok(v.ok, JSON.stringify(v));
  const text = renderMarkdown(v.value.model);
  assert.match(text, /♻️ 재시작 권함 · lead run:run_a · 자동 압축 누적, 압축 간격이 짧음 · handoff_save 뒤 \/clear/);
  assert.match(v.value.status.text, /♻️ 1$/);
  assert.equal(v.value.status.tone, "danger");
});

test("a cleared session, a worker and a quiet session are not named", () => {
  const i = input((s) => {
    started(s, "sess_old", "lead", "run_a");
    compactions(s, "sess_old", 3);
    started(s, "sess_new", "lead", "run_a", "clear");
    started(s, "sess_worker", "worker", "run_a");
    compactions(s, "sess_worker", 3);
    started(s, "sess_orch", "orchestrator", "run_o");
    compactions(s, "sess_orch", 1);
  });
  const v = panelView(i, {});
  assert.ok(v.ok);
  assert.doesNotMatch(renderMarkdown(v.value.model), /재시작 권함/);
  assert.doesNotMatch(v.value.status.text, /♻️/);
});
