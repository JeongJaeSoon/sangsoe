<!-- layout: slot=④ layer=실행 tokens=free -->
# cli — ④ 셸 호출자 전용 `sangsoe` 명령 · 실행 · 토큰 X

코어의 얇은 진입점이다(결정 75 나). 에이전트는 MCP 만 쓰고 이 CLI 를 부르지 않는다. 호출자는 여섯 행뿐이다: SessionStart hook · 막는 hook · 기록 hook · 오너 전용 skill 의 상태 주입 줄 · 사람 터미널·시험·CI · `sangsoe plugin approve`.

지금 있는 것: `sangsoe --version`·`install`·`uninstall`·`doctor`·`plugin approve`·`review record`(리뷰 판정 기록, 결정 111). 하위 명령은 뒤 유닛이 코어 함수를 그대로 노출하는 방식으로 더한다(`land`·`brief`·`recover`·`verify-tier`·`install`·`plugin approve` 등).
