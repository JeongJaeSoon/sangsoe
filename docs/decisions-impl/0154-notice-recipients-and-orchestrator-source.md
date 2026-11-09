# 154. 감지층 알림의 받는 쪽, 오케스트레이터 Run 을 Orca 에서 읽는 길, 알림 길 하나

**알림 길 하나.** 감지 라운드가 Orca 메시지를 보내는 길은 `core/detect/notice.ts` 의 `sendNotice` 하나이고, 그 안에서만 코어 `notify` 를 부른다. pr-monitor 의 `MonitorDeps.notify`(U16)와 queue-monitor 의 직접 호출(U17)은 없어졌다. 두 라운드 모두 `MonitorDeps.core` 를 넘기고, `core` 가 없는 dry run 에서는 보내지 않는다. 받는 순서·한 키 한 번·escalate 는 그대로 `notify` 몫이다. 시험 "one notify path" 가 `core/detect`·`orca-plugin` 에서 `notify` 를 부르거나 가져오는 파일이 `notice.ts` 하나인지 본다(GRAPH 의 `notifyReady` 는 코어 함수라 라운드가 부르는 것이지 두 번째 길이 아니다).

**오케스트레이터 Run 은 Orca 가 갖는다.** sangsoe 는 오케스트레이터 Run 을 설정이나 store 에 두지 않는다(`MonitorConfig.orchestratorRun` 은 지웠다). Orca 가 Run 과 그 위 세션을 잇는 칸은 하나다: `orchestration run-show --full` 의 `run.coordinator_handle`(그 Run 을 쥔 터미널)과, `worker-list` 행의 `terminal`·`worker-show` 의 `runId`. 그래서 `runAbove(run)` 은 Run 의 `coordinator_handle` 을 워커 터미널로 쓰는 Dispatch 를 찾아 그 Dispatch 의 Run 을 돌려준다(리드가 오케스트레이터의 `worker-start` 로 떴을 때의 모양). 답은 셋이다: 위 Run, 꼭대기(목록을 끝까지 읽었고 그 터미널을 쓰는 Dispatch 가 없음), 모름(읽기 실패, 빈 칸, 20 쪽 안에 끝나지 않은 목록, 다른 호스트의 행이 빠진 목록, 한 터미널을 두 Dispatch 가 씀). 위 Run 이 아니면 행동 0 이다(`unseen` 에 `Run above <run>`). `worker-list` 는 묻는 일이 있을 때만, 라운드마다 한 번, 100 행씩 20 쪽까지 읽고, 이미 올린 escalation 은 다시 찾지 않는다.

- 한 단계 위(`escalation_stale` 의 전달 안 된 답, 결정 0148): 그 대기자 Run 의 `runAbove`.
- 리드 Run 이 없는 `timer_stalled`(결정 83): store 의 event 가 이름 댄 Run 마다 `runAbove` 를 꼭대기까지 올라가 닿은 꼭대기가 하나일 때만 그 Run. 한 칸이라도 모름이거나, 다섯 단계를 넘거나, 꼭대기가 없거나 둘 이상이면 모름이고 event 만 쓴다(모름을 꼭대기로 읽으면 중간 리드에게 잘못 보낸다). 이미 알린 멈춤은 다시 찾지 않는다(재확인마다 `worker-list` 를 읽지 않게).

**지금 운영 모양에서는 모름이다.** 2026-11-10 의 실제 Orca 에서 리드 Run 의 `coordinator_handle` 을 터미널로 쓰는 Dispatch 는 전체 771 행 가운데 없었다(리드는 카드로 떴고 `worker-start` 로 뜨지 않았다). 그래서 오늘은 두 알림 모두 event 만 쓰고 `unseen` 에 이름을 남긴다. 리드를 `worker-start` 로 띄우면 같은 코드가 그 Run 을 읽는다. 대안으로 본 것: 설정에 오케스트레이터 Run 을 적기(데이터 2중), 이름 없는 Run 중 가장 새것(대시보드도 이것만으로는 틀린다고 적은 추정), Run 목록의 objective 문자열(뜻이 아니라 글).

**알림 → 받는 쪽.**

| event | 받는 쪽 | Orca 명령 | 근거 |
|---|---|---|---|
| `timer_stalled` | 오케스트레이터(위 꼭대기) | `orchestration send --to run:<id>` | 결정 83 |
| `escalation_stale`(전달 안 된 답) | 대기자 Run 의 한 단계 위 | 같은 send, `notify` escalate | 결정 91④(iii)·0148 |
| `escalation_stale{verify_unconfirmed}` | 항목의 소유 리드(Task 의 Run) | 같은 send | 결정 91② 11번 |
| `escalation_stale{waiting_unreleased}` | 오너 큐(`owner_todo` 가 이 줄을 읽어 올린다). Orca 메시지는 없다 | — | 결정 91①: 리드는 `waiting_human` 때 이미 들었고, 이 event 는 오너 앞에 올리는 표지다. 오너는 `notify` 의 받는 순서에 없다 |
| `todo_due` | 항목의 소유 리드 | 같은 send(`type todo_due`) | 부록 queue-monitor 카드 "그 항목 리드에게 Orca 메시지". 항목은 오너 큐에도 `todo_due` 로 오른다 |
| `trigger_unclear` | 항목의 소유 리드 | 같은 send(`type trigger_unclear`) | 같은 카드, 결정 39(⚠️ 하나) |
| `pr_ready_to_merge` | PR 항목의 소유 리드 | 같은 send | 결정 81(U16, 길만 바뀜) |

**메시지 종류.** `orchestration send --type` 은 닫힌 목록(`status`·`dispatch`·`worker_done`·`merge_ready`·`escalation`·`handoff`·`decision_gate`·`question`·`heartbeat`)만 받는다. event 이름은 제목에 싣고 종류는 `status`(`todo_due`·`trigger_unclear`·`pr_ready_to_merge`) 또는 `escalation`(`verify_unconfirmed`)이다. U16 의 `pr_ready_to_merge` 종류는 실제 Orca 에서 거부되므로 함께 고쳤다. 가짜 Orca 도 목록 밖의 종류를 거부한다.

리드 알림 셋의 키는 `notify:<task>:<event>:<그 줄의 조건>` 이라 줄 하나에 알림 하나다. 소유 리드는 snapshot 의 Task `runId` 다. 그 Task 를 못 읽었으면 `unseen` 에 `owning lead of <task>` 만 남긴다. 리드 알림은 `acts` 로 돌려 `runMonitor` 가 event 를 쓴 뒤 보내고, dry run 에서는 `acts` 에 무엇을 누구에게 보낼지만 남는다. 보내기가 실패한 줄은 `notified` 가 없으므로 다음 라운드에 다시 보낸다.

**moot 의 모름(U17 LATER).** 대기자 Task 하나라도 snapshot 에 없으면(그 Run 을 못 읽음) PR 이 닫혔다는 갈래로도 `moot` 하지 않는다. 결정 0148 의 "읽지 못한 Run 의 Task 는 모름이라 moot 도 아니다" 를 PR 갈래에도 적용했다.
