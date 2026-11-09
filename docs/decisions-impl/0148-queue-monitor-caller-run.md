# 148. queue-monitor 는 Run 없는 호출자로 결정 함수를 부르고, 열린 게이트는 그 Run 에 넘긴다

**규칙.** queue-monitor 가 `decisionMoot`·`decisionAnswer` 를 부를 때 `callerRun` 은 `QUEUE_CALLER`(`monitor:queue`, Run id 가 아님)다. 그래서 `release` 는 열린 게이트를 하나도 직접 풀지 않고, 게이트마다 그 Run 의 리드에게 `…:resolve` 키로 메시지를 한 번 보낸다. 받은 세션이 같은 함수(`decision_answer` 또는 `sangsoe decision moot`)를 자기 Run 에서 다시 불러 푼다. 닫힌 Task 의 대기자는 게이트를 부르지 않고 그 Run 에 한 번 알린다(91④(ii), 함수의 규칙 그대로).

**왜.** plugin worker 는 어느 Run 에도 묶여 있지 않고 `gate-resolve` 는 묶인 Run 안에서만 된다(결정 77 라). 대기자의 Run 을 호출자로 넘기면 worker 가 직접 `gate-resolve` 를 부르다 실패하고, 그 실패는 라운드마다 되풀이된다. 설계 문장도 같은 길이다: "답은 있는데 게이트가 열려 있으면 queue-monitor 가 그 게이트의 Run 을 쥔 세션에 Orca 메시지로 답을 다시 알리고 그 세션이 `decision_answer` 로 푼다." 넘긴 뒤 `decision_wait_minutes`(기본 30) 안에 풀리지 않으면 `escalation_stale{ref: dNNN}` 을 대기자당 한 번 쓰고, 같은 `…:resolve` 조건을 `notify` 의 escalate 로 오케스트레이터에 한 단계 올린다.

**Run 범위.** 라운드가 읽는 Run 은 brief 와 같다(`briefRuns`): 호출자의 현재 Run(worker 에는 없다)과 event 가 이름을 댄 Run. 결정의 대기자 Run 은 `decision_joined.run` 이 늘 갖고 있으므로 moot·재전달 판정에는 빠지는 Run 이 없다. 읽지 못한 Run 의 Task 는 모름이라 moot 도, `undelivered` 도 아니다(행동 0).

**대안.** 대기자의 Run 을 `callerRun` 으로 넘김 — worker 에서 `gate-resolve` 가 실패하므로 버렸다. 오케스트레이터 Run 을 넘김 — 그 Run 의 게이트가 아니면 같은 실패이고, worker 가 오케스트레이터 Run 을 아는 길도 아직 없다.
