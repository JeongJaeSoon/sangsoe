<!-- Generated from core/models/table.ts by `sangsoe models --markdown`. Do not edit; test/models-view.test.ts fails when it drifts. -->
# 모델 표

원본은 `core/models/table.ts` 하나다. Claude Code 2.1.322 기준으로 확인했다.

## 카탈로그

| tier | alias | 지금 모델 id | 가격(입력/출력, 백만 토큰) | API 기본 effort | 확인한 날 | 출처 |
|---|---|---|---|---|---|---|
| frontier | fable | claude-fable-5-2 | $8 / $40 | high | 2026-11-10 | https://platform.claude.com/docs/en/about-claude/models/overview |
| primary | opus | claude-opus-5-5 | $4 / $20 | medium | 2026-11-10 | https://platform.claude.com/docs/en/about-claude/models/overview |
| everyday | sonnet | claude-sonnet-5-5 | $2 / $10 | high | 2026-11-10 | https://platform.claude.com/docs/en/about-claude/models/overview |
| fast | haiku | claude-haiku-5-5 | $0.1 / $0.5 | medium | 2026-11-10 | https://platform.claude.com/docs/en/about-claude/models/overview |

## 일의 종류별 정책

| 종류 | kind · class | tier | effort 사다리 | 다음 tier | advisor | 호출 예산 | 오르는 때 | 이유 | 출처 |
|---|---|---|---|---|---|---|---|---|---|
| 오케스트레이터 | orchestrator | primary | medium → high → xhigh | frontier | 없음 | 0 | a hard root-cause or design call it cannot hand down | 대부분의 일은 이 tier 에서 시작하고, 어려운 판단은 effort 를 먼저 올린다 | https://platform.claude.com/docs/en/about-claude/models/choosing-a-model |
| 리드(묶음 진행) | lead | primary | medium → high → xhigh | frontier | frontier | 6회/하루 | the same step failed twice, or review found a real defect the lead missed | 묶음을 끝까지 끄는 세션: 막힐 때만 위 tier 의 조언을 받고 하루 예산 안에서 쓴다 | https://platform.claude.com/docs/en/about-claude/models/choosing-a-model |
| 구현 | worker · class default | everyday | medium → high | primary | primary (다음 tier 에서 frontier) | 3회/단위 | the first Act-on finding raises effort back; a second failed review round moves to the next tier | 낮은 tier 를 중간 effort 로 두고 위 tier advisor 를 붙이면 기본 effort 와 비슷한 결과를 더 싸게 낸다 | https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool |
| 어려운 구현 | hard · class hard | primary | high → xhigh | frontier | frontier | 3회/단위 | the same step failed twice at the ladder's top | 검증이 중요하거나 경계 사례가 많은 일이라 effort 를 한 단계 올려 시작한다 | https://code.claude.com/docs/en/model-config |
| 근본 원인·설계 | design · class design | primary | high → xhigh → max | frontier | frontier | 3회/단위 | xhigh or max still falls short on the reasoning | 되돌리기 어려운 판단이라 높은 effort 에 가장 높은 tier advisor 를 붙이고, xhigh 위는 측정한 이득이 있을 때만 | https://platform.claude.com/docs/en/about-claude/models/choosing-a-model |
| 리뷰 | review | primary | high → xhigh | frontier | 없음 | 0 | a later round found an Act-on finding an earlier round missed | 독립 판정이라 조언자 없이 높은 effort 로 읽고, 놓친 것이 나오면 effort 부터 올린다 | https://platform.claude.com/docs/en/about-claude/models/choosing-a-model |
| 안정 릴리스 마지막 리뷰 | release-review | frontier | high → xhigh → max | — | 없음 | 0 | never lowered for cost; raise effort when the release is large | 가장 높은 tier 를 실행자로 쓸 때는 high 에서 시작하고, 비용 때문에 내리지 않는다 | https://platform.claude.com/docs/en/models/fable-5-2/whats-new-fable-5-2 |
| 기계적 일 | sweep · class mechanical | fast | low | everyday | 없음 | 0 | the unit failed once, or needs judgment it gets wrong | 이름 바꾸기처럼 작은 일이라 가장 낮은 effort 로 하고, 브리프의 끝까지 하라는 줄이 일찍 멈추는 것을 막는다 | https://code.claude.com/docs/en/model-config |
| 문서 | docs · class docs | everyday | medium → high | — | 없음 | 0 | review found Act-on twice | 범위가 분명한 평소 일이라 구현 tier 를 중간 effort 로, advisor 없이 쓴다 | https://code.claude.com/docs/en/model-config |
