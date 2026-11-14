import type { Got } from "../../../orca-plugin/panel/resources.ts";
import type { PanelView } from "../../../orca-plugin/panel/view.ts";

// The owner's rc.3 panel (U116) with every name made generic: 현황 with one group of one item, 16 done
// in the last 7 days, and the 리소스 section open on a 24-hour band with nothing to clean up.

export const NOW = "2026-11-14T07:42:59.000Z";
const H = 3_600_000;
const at = (h: number) => new Date(Date.parse(NOW) - h * H).toISOString();

const table = (title: string, count: number, columns: string[], rows: unknown[]) => ({
  title,
  count,
  columns: columns.map((name) => ({ name, max: 12 })),
  rows,
});

export const VIEW = {
  model: {
    stage: 1,
    now: NOW,
    groups: 1,
    todo: { total: 0, decisions: 0, other: 0 },
    summary: { done: 16, doing: 0, left: 1, blocked: 0 },
    decisions: table("결정 필요", 0, ["ID", "결정", "추천", "묶음", "경과"], []),
    ownerTodo: table("지금 오너가 할 일", 0, ["ID", "할 일", "풀리는 일", "어디서", "경과"], []),
    inProgress: table("열린 항목", 1, ["상태", "항목", "PR", "다음", "누가"], [
      { id: "lead:acme-api-503", cells: [{ text: "📅" }, { text: "acme-api-503", tail: " P2", strong: true }, { text: "—" }, { text: "1건·막힘 0" }, { text: "—" }] },
      { id: "i038", cells: [{ text: "📅" }, { text: "└ i038 api dev check (second swap, zero 503s)" }, { text: "—" }, { text: "선행 대기" }, { text: "—" }] },
    ]),
    onHold: null,
    doneDays: 7,
    evidenceShort: 7,
    reviewOnly: 6,
    done: table(
      "✅ 완료 최근 7일",
      16,
      ["항목", "PR", "닫힘"],
      Array.from({ length: 16 }, (_, i) => ({ id: `i${String(i + 10).padStart(3, "0")}`, cells: [{ text: `i${String(i + 10).padStart(3, "0")} acme task ${i}` }, { text: "—" }, { text: "11-14 01:49" }] })),
    ),
  },
  todo: [],
  fresh: { short: "11-14 16:40", full: "갱신 2026-11-14 16:40 (GMT+9)" },
} as unknown as PanelView;

const spans = [
  [24, 23.7, "ok"],
  [23.7, 23.6, "warn"],
  [23.6, 21.9, "ok"],
  [21.9, 21.8, "warn"],
  [21.8, 20.7, "ok"],
  [20.7, 19.7, "warn"],
  [19.7, 16.7, "ok"],
  [16.7, 16.3, "warn"],
  [16.3, 13.4, "ok"],
  [13.4, 13.3, "warn"],
  [13.3, 12.2, "ok"],
  [12.2, 11.7, "warn"],
  [11.7, 0, "ok"],
] as const;

export const PARTS_GOT: Required<Got> = {
  load: {
    ok: true,
    value: {
      part: "load",
      at: NOW,
      load: { ok: true, value: { level: "ok", reasons: [], loadPerCpu: 0.37, memFreePct: 73, diskFreeGb: 65.9 } },
      episode: { state: "ok", since: at(11.7) },
      band: { from: at(24), to: NOW, spans: spans.map(([a, b, state]) => ({ from: at(a), to: at(b), state })) },
    },
  },
  made: {
    ok: true,
    value: {
      part: "made",
      at: NOW,
      made: {
        worktrees: { ok: true, value: { count: 0, kb: 0 } },
        terminals: { ok: true, value: { count: 0 } },
        processes: { ok: true, value: { claude: { count: 5, kb: 2_405_088 }, node: { count: 7, kb: 211_296 } } },
        tmp: { ok: true, value: { count: 0, kb: 0 } },
        recorded: [],
      },
    },
  },
  candidates: { ok: true, value: { part: "candidates", at: NOW, worktrees: { ok: true, value: { rows: [], markOnly: false, unseen: [] } }, tmp: { ok: true, value: { count: 0, kb: 0 } }, trash: true } },
};
