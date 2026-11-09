# 138. "전달되지 않은 답"은 `decision` 뷰 한 곳에서 대기자별로 판정한다

**규칙.** 결정 행의 `undelivered` 는 답이 기록되었고(`state` 가 `answered` 이거나 `closedReason` 이 `answered`) 대기자 중 하나라도 아직 답을 받지 못했을 때 참이다. 대기자가 답을 받았다는 것은 둘 중 하나다: (가) 그 대기자의 Orca 게이트가 열려 있지 않다(풀렸다). (나) 그 대기자 Task 가 닫혔고(`completed`, 또는 `failed` + `cancelled`) 답의 `notified` 키(`answerNotifiedKey(dNNN, task)`, 결정 91④ 의 `notified:dNNN:<task>`)가 이미 있다.

**왜 (나) 가 닫힌 Task 에만 해당하나.** 게이트를 일부러 열어 두는 길은 결정 91④(ii) 하나다: Task 가 이미 닫혔으면 `core/decision/release.ts` 는 게이트를 풀지 않고 Run 에 메시지 하나를 보낸다. 게이트만 보면 이 대기자는 영원히 "전달 안 됨"이 된다. 살아 있는 Task 의 게이트는 `decision_answer` 가 자기 Run 에서 먼저 풀고(91④(i) 의 아직 워커가 없는 Task 도 그렇다), SessionStart 의 늦은 답 주입(`core/session/session-start.ts`)은 같은 키를 쓰지만 게이트를 풀지 않는다. 그래서 살아 있는 Task 는 키가 있어도 게이트가 열려 있으면 전달 안 됨으로 남아, 도중에 죽은 `decision_answer` 를 다시 부르게 한다(부록 `answer_gate_unresolved`). 다른 Run 으로 넘긴 게이트(`…:resolve` 키)도 그 Run 이 풀 때까지 전달 안 됨이다.

**보냈는지 모르는 전송.** `notify` 는 응답을 잃은 전송도 `notified`(`msg_id: undetermined:…`)로 남긴다. 닫힌 Task 에 대해서는 이것도 전달로 센다: 도착 여부는 받는 쪽이 말할 일이고, 읽지 않으면 기존 `escalation_stale` 이 올린다(91④(iii)).

**고친 것.** U8 의 뷰는 `state === "answered"` 일 때만 참이었는데, `decisionAnswer` 는 답 바로 뒤에 `decision_closed{answered}` 를 써서 행이 곧 `closed` 가 된다. 그래서 게이트가 열린 채 닫힌 답이 "전달됨"으로 읽혔다. U9 는 `core/brief` 에 `isUndelivered` 를 따로 두어 이를 덮었는데, 규칙이 두 곳이 되므로 이 결정으로 뷰를 고치고 그 함수를 지웠다. 계약 `DecisionRow.undelivered` 의 설명 한 줄도 같이 고쳤다. 0128 의 "전달되지 않은 답" 항목을 이 결정이 대체한다.
