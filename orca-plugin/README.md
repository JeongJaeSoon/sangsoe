<!-- layout: slot=② layer=- tokens=free -->
# orca-plugin — ② Orca plugin · 토큰 X

Orca plugin 이 할 수 있는 것은 전부 여기에 싣는다(결정 78 의 판정 순서 ②). 모델을 부르는 코드는 없다.

- `monitors/` — 감지: monitor 다섯(chat · queue · resource · orca · pr)과 타이머 멈춤 감지
- `reaper/` — 실행: REAPER 라운드(표시 → 정리)를 돌리는 타이머
- `panel/` — 실행: 패널(현황 세 단계 · 오너 할 일 · 결정 버튼)과 상태 표시줄 항목 B(결정 92)

매니페스트 `orca-plugin.json` 은 뒤 유닛이 이 폴더에 둔다. Orca plugin 은 skill·MCP 서버·agent 정의·Claude Code hook 을 싣지 못하므로 그것들은 `claude-plugin/` 에 있다. worker 는 코어를 `core/index.ts` 로 직접 import 한다(MCP·CLI 를 거치지 않는다).
