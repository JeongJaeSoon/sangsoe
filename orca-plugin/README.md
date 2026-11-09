<!-- layout: slot=② layer=- tokens=free -->
# orca-plugin — ② Orca plugin · 토큰 X

Orca plugin 이 할 수 있는 것은 전부 여기에 싣는다(결정 78 의 판정 순서 ②). 모델을 부르는 코드는 없다.

- `monitors/` — 감지: monitor 다섯(chat · queue · resource · orca · pr)과 타이머 멈춤 감지
- `reaper/` — 실행: REAPER 라운드(표시 → 정리)를 돌리는 타이머
- `panel/` — 실행: 패널(현황 세 단계 · 오너 할 일 · 결정 버튼)과 상태 표시줄 항목 B(결정 92)

이 폴더가 plugin 뿌리다: 매니페스트 `orca-plugin.json`, worker 진입점 `main.ts`(`activate(orca)`), 타이머 라운드 `timer.ts`(monitor 하나 = `Round` 하나), 첫 빌드 시험 프로브 `probe.ts`(요청할 때만 돈다). 시험은 지문에 들지 않게 `test/orca-plugin.test.ts` 에 둔다. 계약과 시험 결과는 `docs/architecture.md` "Orca plugin 골격"과 `docs/test-outcomes.md`. Orca plugin 은 skill·MCP 서버·agent 정의·Claude Code hook 을 싣지 못하므로 그것들은 `claude-plugin/` 에 있다. worker 는 코어를 `core/index.ts` 로 직접 import 한다(MCP·CLI 를 거치지 않는다).
