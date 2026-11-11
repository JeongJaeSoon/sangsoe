<!-- layout: slot=④ layer=감지 tokens=free -->
# core/detect — monitor 판정

plugin worker 의 타이머 라운드와 `sangsoe monitor run <name>` 이 같은 함수를 부른다(`run.ts` 의 `MONITORS`). 라운드 하나는 읽기 → 판정 → event 쓰기이고, 깨움은 `notify` 몫이다. Orca 는 `core/orca` 어댑터로만 읽고 쓰는 것은 store 의 event 뿐이다. 읽지 못한 칸은 행동 0 이고 `unseen` 에 이름만 남긴다.

- `notice.ts` — 라운드가 Orca 메시지를 보내는 유일한 길(`sendNotice` → 코어 `notify`, dry run 이면 보내지 않음)과 받는 쪽 찾기: `runAbove`(Run 의 `coordinator_handle` 을 터미널로 쓰는 Dispatch 의 Run), `orchestratorRun`(이름 난 Run 들 위의 꼭대기 하나). 결정 154.
- `rebuild.ts` — 잃은 데이터베이스를 다시 세운 뒤 호스트 행을 orca·pr reader 로 한 번 다시 쓴다. act 는 깨움(`Act.wake`)만 돌린다. `run.ts` 의 `afterHostReread` 가 첫 라운드 전에 부르고, 다른 호출자가 멈춘 다시 읽기는 자기 signal 로 다시 시작하며, 다시 읽기를 마치기 전에 멈춘 호출자는 라운드를 돌리지 않는다(결정 184).
- `monitor.ts` — 계약: `MonitorDeps`(`append` 가 없으면 dry run) · `Reading`(event 와, event 를 쓴 뒤 실행할 Orca 쓰기 `acts`) · `MonitorReport` · 설정 기본값.
- `orca/` — orca-monitor. `judge.ts` 는 읽은 행만 받는 순수 함수(`sessionActivity` 가 `one_session_two_terminals` 의 세션 단위 판정), `round.ts` 가 `worktree ps --agent-wait`·`worker-list`·`worker-show`·`gate-list`·`inbox` 를 읽는다. `mail.ts` 는 같은 `inbox` 에서 Orca 의 멈춤·대기 escalation, `worker_done`, 거부 보고를 판정한다(결정 196). `check` 는 부르지 않는다.
- `resource/` — resource-monitor. `diagnostics memory` 의 가용 메모리로 macOS 메모리 칸을 채운 뒤 `judgeLoad` 하나로 판정하고, `docker` 의 컨테이너·볼륨 id 를 `resource` 기록과 맞춘다.
- `queue/` — queue-monitor 와 타이머 멈춤 판정. 자기 README 가 있다.
- `chat/` — chat-monitor. `ChatProvider` 인터페이스와 null 제공자(기본). 제공자 이름은 이 저장소에 없다(결정 45).
- `pr/` — pr-monitor. `gh` 는 `core/gh` 로만 읽고, 머지 확인 뒤 PR 항목의 Task 를 닫는 유일한 예외를 가진다(결정 142·143).
