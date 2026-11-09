# 133. monitor 라운드 계약, 멈춤 판정의 필드(P10), macOS 메모리

**라운드 계약.** `orca-plugin/timer.ts` 의 `startRounds` 가 monitor 마다 한 `Round` 를 돌린다. 주기(`intervalMs`) · 단일 실행(돌고 있으면 다음 틱은 건너뛴다) · 힌트(`hint(id)`: 디바운스 창 안의 힌트는 라운드 하나로 합치고, 라운드 중에 온 힌트는 끝난 뒤 한 번만 더 돈다) · 시간 상한(`capMs`: 넘으면 라운드의 `AbortSignal` 을 끊고 `timeouts` 를 센다. 다음 라운드는 그 라운드가 실제로 끝날 때까지 기다린다). 상한을 넘긴 라운드는 event 를 쓰지 않는다(`runMonitor` 가 쓰기 전에 신호를 본다). 주기는 orca 60 초 · resource 5 분(`diagnostics memory` 는 한 시점 진단, 결정 62) · chat 5 분이고, `agent.status.changed` 가 orca-monitor 에 힌트를 준다. 결정 83 의 힌트 규칙을 REAPER 만이 아니라 monitor 라운드에도 같은 꼴로 쓴다.

**세션 = 워크스페이스.** `worktree ps --json` 의 에이전트 행에는 세션 id 가 없다. Dispatch 하나는 워크스페이스 하나이므로 워크스페이스를 세션으로 보고, 그 워크스페이스의 모든 터미널(에이전트 행)을 한꺼번에 판정한다(`sessionActivity`): 하나라도 `agentWait` 이면 대기, 일하는 행이 없으면 쉼, 시각은 전부의 최댓값. 그래서 조용한 옛 탭이 세션을 멈춤으로 만들지 않는다(`one_session_two_terminals`).

**P10 결과를 적용한다(결정 87 의 "일부 필드만 맞으면 맞는 필드만").** 약 10 분 사이 두 번 읽은 `worktree ps` 에서 일하는 세션 여섯 모두 `lastOutputAt` 이 움직였고 `lastActivityAt` 은 하나도 움직이지 않았다. `lastActivityAt` 은 에이전트 활동을 따라가지 않으므로 판정에서 뺀다(UI 활동으로 갱신되면 멈춘 워커를 가린다). 쓰는 것은 `lastOutputAt` 과 에이전트 행의 `stateStartedAt`(하한)이다. 하나라도 시계보다 미래이거나 쓸 값이 없으면 행동 0. `observed_change` 대체 경로는 쓰지 않는다(`lastOutputAt` 이 활동을 따라간다).

**macOS 메모리(결정 115 의 미룬 읽기).** `diagnostics memory` 의 `host.availableMemory`(`availableMemorySource: memory-pressure`)/`totalMemory` 로 `LoadSample.memFreePct` 를 채운 뒤 `judgeLoad` 로 판정한다. 측정 칸 하나를 채울 뿐 판정 함수는 하나다. `sampleLoad` 가 이미 잰 칸은 바꾸지 않는다.

**압박 구간.** `pressure_high` 와 `capacity_free` 는 구간의 경계에서 한 번씩만 쓴다. 마지막 두 event 중 늦은 것이 구간을 정하고, `dedupe_key` 는 그 줄의 seq 라 두 입구(worker·CLI)가 같은 구간에 두 줄을 쓰지 못한다.

**dedupe 로 다시 무장하는 키.** `worker_stuck:<dispatch>:<마지막 활동 ms>`(같은 멈춤은 한 줄, 활동 뒤 다시 멈추면 새 줄) · `run_stalled:<run>:<가장 늦은 활동 또는 dead>` · `worker_dead:<dispatch>` · `wake_unconfirmed:<msg>` · `decision_untracked:<gate>` · `waiting_decision:<decision>` · `resource_leak:<kind>:<id>` · `mention_new:<url>`.

**Run 묶음은 필요 없다.** 게이트는 살아 있는 워커의 `worker-show` 가 주는 Run 마다 `gate-list --run <id>` 로 읽는다(묶지 않고 읽힌다). 그래서 U8 이 남긴 "결정 moot 에는 Run 묶음이 필요하다"는 `decision_untracked` 에 필요 없고 U17 몫으로 둔다. 압박 게이트의 대기열(U12 LATER)도 결정 83 이 monitor 에 두지 않으므로 여기서 만들지 않는다(압박은 REAPER 라운드의 힌트다).
