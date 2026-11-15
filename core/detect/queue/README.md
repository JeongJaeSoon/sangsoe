<!-- layout: slot=④ layer=감지 tokens=free -->
# core/detect/queue — queue-monitor · 타이머 멈춤 감지

queue-monitor 라운드 하나는 읽기 → 판정 → 규칙을 가진 코어 함수 호출이다. 규칙은 이 폴더에 다시 쓰지 않는다: 준비됨은 GRAPH 의 `readiness`, 깨움은 `notifyReady`, probe 는 `probeRound`, 풀리지 않은 대기는 `unreleasedWaits`·`recordUnreleased`, moot 는 `decisionMoot`, 답 재전달은 `decisionAnswer`, 간선 맞추기는 `syncGraph`, base 가 바뀐 PR 의 재리뷰 항목은 `rereviewItems`(결정 215; Orca 가 그 Run 밖이라 거부한 항목은 깨움 없이 round 기록에만 남고, 그 Run 에 묶인 세션의 hook 이 만든다, 결정 219), 플러그인 어긋남은 `orcaPluginDrift`(시작 점검과 같은 함수)다. 항목(Task)을 닫거나 바꾸는 호출은 없다(결정 76 의 6번, 시험 "closes nothing").

- `judge.ts` — 순수 판정: `item_ready`·`todo_due`·`trigger_unclear` 와 moot·재전달·멈춘 전달 목록.
- `drift.ts` — `job_drift`(결정 90).
- `stall.ts` — `timer_stalled`: `reap_round` 행만 읽는다(결정 83). 타이머가 아니라 Orca 이벤트·패널 갱신이 부른다.
- `round.ts` — `queueRound`(dry run 이면 함수 호출 대신 `calls` 에 이름만)와 `stallCheck`.
- `own-run.ts` — `deliverOwnRun`(결정 274): Run 을 쥔 세션의 `UserPromptSubmit` hook 이 자기 Run 만 읽어 같은 `judgeQueue` 로 판정한다. 답이 달렸거나 원인 소멸로 닫혔는데 열린 Task 의 게이트가 남은 결정은 자기 Run 을 호출자로 같은 함수를 다시 불러 게이트를 풀고, 준비됨·기한·trigger 불명은 수를 한 줄로 낸다(`leadNotice` 의 검증 안 된 입력은 내지 않는다). 다른 Run 에 선행이 있으면 그 Run 의 Task 도 읽는다. 알렸다는 기록은 메일이 썼을 키의 `notified` 행이라, 타이머가 행을 먼저 써 두어도 한 번은 알리고 두 번은 알리지 않는다.

워커에는 묶인 Run 이 없어서, 함수에 넘기는 호출자 Run 은 `QUEUE_CALLER`(Run 이 아님)다. 열린 게이트는 그 게이트의 Run 을 쥔 세션이 같은 함수로 푼다(결정 0148). plugin worker 는 터미널이 없어 Orca 가 그 메시지를 받지 않는다(`no_active_sender_terminal`). 첫 거부를 어댑터가 기억하고(`noSender`), 그 뒤 라운드는 알림을 쌓지 않고 `calls` 에 수만 적는다. 전달은 `own-run.ts` 의 몫이다(결정 274).
