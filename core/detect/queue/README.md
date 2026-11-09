<!-- layout: slot=④ layer=감지 tokens=free -->
# core/detect/queue — queue-monitor · 타이머 멈춤 감지

queue-monitor 라운드 하나는 읽기 → 판정 → 규칙을 가진 코어 함수 호출이다. 규칙은 이 폴더에 다시 쓰지 않는다: 준비됨은 GRAPH 의 `readiness`, 깨움은 `notifyReady`, probe 는 `probeRound`, 풀리지 않은 대기는 `unreleasedWaits`·`recordUnreleased`, moot 는 `decisionMoot`, 답 재전달은 `decisionAnswer`, 간선 맞추기는 `syncGraph`, 플러그인 어긋남은 `orcaPluginDrift`(시작 점검과 같은 함수)다. 항목(Task)을 닫거나 바꾸는 호출은 없다(결정 76 의 6번, 시험 "closes nothing").

- `judge.ts` — 순수 판정: `item_ready`·`todo_due`·`trigger_unclear` 와 moot·재전달·멈춘 전달 목록.
- `drift.ts` — `job_drift`(결정 90).
- `stall.ts` — `timer_stalled`: `reap_round` 행만 읽는다(결정 83). 타이머가 아니라 Orca 이벤트·패널 갱신이 부른다.
- `round.ts` — `queueRound`(dry run 이면 함수 호출 대신 `calls` 에 이름만)와 `stallCheck`.

워커에는 묶인 Run 이 없어서, 함수에 넘기는 호출자 Run 은 `QUEUE_CALLER`(Run 이 아님)다. 그래서 열린 게이트는 모두 그 게이트의 Run 을 쥔 세션에 메시지로 넘어가고 그 세션이 같은 함수로 푼다(결정 0148).
