<!-- layout: slot=④ layer=실행 tokens=free -->
# core/recover — `sangsoe recover` 읽기 전용 표

결정 80 N4: 머신 재시작 뒤 되살리는 일은 Orca 가 한다(`worker-list` 의 다음 명령, `worker-start --retry-of`, `run-use`). sangsoe 는 모자란 부분만 갖는다: 워커(Dispatch) ↔ Task ↔ worktree 를 한 표로 모으는 읽기 전용 `sangsoe recover`.

`recoverPlan(orca)` 는 `worker-list` 만 읽고 아무것도 쓰지 않는다(sqlite 에도 쓰지 않는다). 행은 Task·Dispatch·상태·liveness·터미널 상태·worktree 이고, 살아 있지 않고 끝나지도 않은 행에 표시가 붙는다. 되살리는 명령은 sangsoe 가 실행하지 않는다. `/goal` 칸은 두지 않는다: `worker-start` 로 연 세션에서는 `/goal` 이 걸리지 않는다(docs/test-outcomes.md).
