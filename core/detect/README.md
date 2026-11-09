<!-- layout: slot=④ layer=감지 tokens=free -->
# core/detect — monitor 판정

plugin worker 의 타이머 라운드와 `sangsoe monitor run <name>` 이 같은 함수를 부른다(`run.ts` 의 `MONITORS`). 라운드 하나는 읽기 → 판정 → event 쓰기이고, 깨움은 `notify` 몫이다. Orca 는 `core/orca` 어댑터로만 읽고 쓰는 것은 store 의 event 뿐이다. 읽지 못한 칸은 행동 0 이고 `unseen` 에 이름만 남긴다.

- `monitor.ts` — 계약: `MonitorDeps`(`append` 가 없으면 dry run) · `Reading`(event 와, event 를 쓴 뒤 실행할 Orca 쓰기 `acts`) · `MonitorReport` · 설정 기본값.
- `orca/` — orca-monitor. `judge.ts` 는 읽은 행만 받는 순수 함수(`sessionActivity` 가 `one_session_two_terminals` 의 세션 단위 판정), `round.ts` 가 `worktree ps --agent-wait`·`worker-list`·`worker-show`·`gate-list`·`inbox` 를 읽는다. `check` 는 부르지 않는다.
- `resource/` — resource-monitor. `diagnostics memory` 의 가용 메모리로 macOS 메모리 칸을 채운 뒤 `judgeLoad` 하나로 판정하고, `docker` 의 컨테이너·볼륨 id 를 `resource` 기록과 맞춘다.
- `queue/` — queue-monitor 와 타이머 멈춤 판정. 자기 README 가 있다.
- `chat/` — chat-monitor. `ChatProvider` 인터페이스와 null 제공자(기본). 제공자 이름은 이 저장소에 없다(결정 45).
- `pr/` — pr-monitor. `gh` 는 `core/gh` 로만 읽고, 머지 확인 뒤 PR 항목의 Task 를 닫는 유일한 예외를 가진다(결정 142·143).
