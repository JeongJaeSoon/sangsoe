import { catalogAgeDays, STALE_DAYS } from "./index.ts";
import { CATALOG, CLASS_KIND, KINDS, type Kind, POLICY, type PolicyRow, SOURCES, VERIFIED_WITH_CLAUDE_CODE } from "./table.ts";

// The catalog view (decision 200): `sangsoe models`, the panel's menu entry and docs/models.md all
// draw from table.ts here; none of them keeps a copy.

const classOf = (kind: Kind) => Object.entries(CLASS_KIND).find(([, k]) => k === kind)?.[0];

const ladder = (r: PolicyRow) => [r.effort, ...r.raiseEffort].join(" → ");
const advisorText = (r: PolicyRow) => (r.advisor ? `${r.advisor}${r.thenAdvisor ? ` (다음 tier 에서 ${r.thenAdvisor})` : ""}` : "없음");
const budgetText = (r: PolicyRow) => (r.budget.calls === 0 ? "0" : `${r.budget.calls}회/${r.budget.per === "day" ? "하루" : "단위"}`);
const price = (p: { input: number; output: number }) => `$${p.input} / $${p.output}`;
const nameOf = (kind: Kind) => {
  const c = classOf(kind);
  return `${kind}${c ? ` · class ${c}` : ""}`;
};

export type ViewOptions = { now: Date; pins: readonly string[] };

/** The terminal view: catalog, policy per case, active pins and how old the check is. */
export function modelsView(o: ViewOptions): string {
  const out: string[] = [];
  const age = catalogAgeDays(o.now);
  out.push(`모델 카탈로그 — 원본 core/models/table.ts · Claude Code ${VERIFIED_WITH_CLAUDE_CODE} 기준`);
  out.push("");
  for (const c of CATALOG) {
    out.push(`  ${c.tier.padEnd(9)} ${c.alias.padEnd(7)} ${c.currentId}`);
    out.push(`    가격(입력/출력, 백만 토큰) ${price(c.price)} · API 기본 effort ${c.apiDefaultEffort} · 확인 ${c.verified}`);
    out.push(`    출처 ${SOURCES[c.source]}`);
    if (c.pin) out.push(`    고정 ${c.pin.id} (${c.pin.reason}, ${c.pin.since})`);
  }
  out.push("");
  out.push("일의 종류별 정책");
  for (const kind of KINDS) {
    const r = POLICY[kind];
    out.push("");
    out.push(`  ${r.label} (${nameOf(kind)})`);
    out.push(`    ${r.tier} · effort ${ladder(r)}${r.thenTier ? ` · 다음 tier ${r.thenTier}` : ""}`);
    out.push(`    advisor ${advisorText(r)} · 호출 예산 ${budgetText(r)}`);
    out.push(`    오르는 때: ${r.trigger}`);
    out.push(`    이유: ${r.why}`);
    out.push(`    출처: ${SOURCES[r.cite]}`);
  }
  out.push("");
  out.push(o.pins.length === 0 ? "지금 걸린 고정: 없음" : `지금 걸린 고정 ${o.pins.length}개: ${o.pins.join(" · ")}`);
  out.push(
    age > STALE_DAYS
      ? `⚠ 확인한 지 ${age}일 지났다(기준 ${STALE_DAYS}일): core/models/README.md 의 갱신 절차를 따른다`
      : `확인한 지 ${age}일(기준 ${STALE_DAYS}일)`,
  );
  return out.join("\n");
}

const cell = (s: string) => s.replace(/\|/g, "\\|");

/** docs/models.md: the same table as Markdown, without anything that changes by date or machine. */
export function modelsMarkdown(): string {
  const out = [
    "<!-- Generated from core/models/table.ts by `sangsoe models --markdown`. Do not edit; test/models-view.test.ts fails when it drifts. -->",
    "# 모델 표",
    "",
    `원본은 \`core/models/table.ts\` 하나다. Claude Code ${VERIFIED_WITH_CLAUDE_CODE} 기준으로 확인했다.`,
    "",
    "## 카탈로그",
    "",
    "| tier | alias | 지금 모델 id | 가격(입력/출력, 백만 토큰) | API 기본 effort | 확인한 날 | 출처 |",
    "|---|---|---|---|---|---|---|",
    ...CATALOG.map((c) => `| ${c.tier} | ${c.alias} | ${c.currentId} | ${price(c.price)} | ${c.apiDefaultEffort} | ${c.verified} | ${SOURCES[c.source]} |`),
    "",
    "## 일의 종류별 정책",
    "",
    "| 종류 | kind · class | tier | effort 사다리 | 다음 tier | advisor | 호출 예산 | 오르는 때 | 이유 | 출처 |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...KINDS.map((kind) => {
      const r = POLICY[kind];
      return `| ${r.label} | ${nameOf(kind)} | ${r.tier} | ${ladder(r)} | ${r.thenTier ?? "—"} | ${advisorText(r)} | ${budgetText(r)} | ${cell(r.trigger)} | ${cell(r.why)} | ${SOURCES[r.cite]} |`;
    }),
    "",
  ];
  return out.join("\n");
}
