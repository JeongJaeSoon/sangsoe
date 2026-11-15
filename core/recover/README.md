<!-- layout: slot=④ layer=실행 tokens=free -->
# core/recover — `sangsoe recover` 읽기 전용 표와 `recover auth`

결정 80 N4: 머신 재시작 뒤 되살리는 일은 Orca 가 한다(`worker-list` 의 다음 명령, `worker-start --retry-of`, `run-use`). sangsoe 는 모자란 부분만 갖는다: 워커(Dispatch) ↔ Task ↔ worktree 를 한 표로 모으는 읽기 전용 `sangsoe recover`.

`recoverPlan(orca)` 는 `worker-list` 만 읽고 아무것도 쓰지 않는다(sqlite 에도 쓰지 않는다). 행은 Task·Dispatch·상태·liveness·터미널 상태·worktree 이고, 살아 있지 않고 끝나지도 않은 행에 표시가 붙는다. 되살리는 명령은 sangsoe 가 실행하지 않는다. `/goal` 칸은 두지 않는다: `worker-start` 로 연 세션에서는 `/goal` 이 걸리지 않는다(docs/test-outcomes.md).

`sangsoe recover auth`(`auth.ts`, 결정 246)는 로그인을 잃고 멈춘 세션(결정 237)을 고르고, `--send` 일 때만 세션마다 Orca `terminal send` 로 한 줄을 보낸다. sangsoe 에서 터미널에 쓰는 유일한 코드다: 오너가 자기 셸에서 부를 때만 돌고, plugin·MCP 서버·monitor·타이머는 부르지 않는다(결정 136). 보낸 것마다 정지 seq 를 키로 한 `owner_action` 한 줄을 남겨 같은 정지에 두 번 보내지 않는다.
