<!-- layout: slot=④ layer=실행 tokens=free -->
# core/unit — 끝난 단위의 에이전트 터미널 닫기

`closeUnit`(`close.ts`) 하나다. MCP tool `unit_close` 가 부른다(결정 263). Orca 만 읽고(`worker-show`·`terminal list`·`worktree ps --agent-wait`) 그 handle 하나를 `terminal close --terminal` 로 닫는다. `--tab`·`--all`·`--worktree` 는 쓰지 않고, worktree 는 건드리지 않는다.

닫는 조건(하나라도 아니면 한 줄로 거부하고 어디서도 다시 시도하지 않는다): Dispatch 가 `succeeded`·`failed`·`cancelled` · 그 Dispatch 가 터미널을 이름 지었고 `released`·`release_pending` 이 아님 · 호출자의 터미널이 아님(`ORCA_TERMINAL_HANDLE` 이 없으면 거부) · `terminal list` 가 그 handle 을 agent 가 있는 터미널로 보임 · `worktree ps` 의 그 agent 행 상태가 `done`·`idle` 이고 `agentWait` 가 정확히 `null`(없는 값은 Orca 가 보지 않았다는 뜻이라 거부).

남기는 것: `unit_closed{dispatch, terminal}` 한 줄(Dispatch 로 dedupe). Orca 의 상태는 복사하지 않는다(결정 74).
