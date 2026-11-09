# 138. "전달되지 않은 답"은 `decision` 뷰 한 곳에서 대기자별로 판정한다

**규칙.** 결정 행의 `undelivered` 는 답이 기록되었고(`state` 가 `answered` 이거나 `closedReason` 이 `answered`) 대기자 중 하나라도 아직 답을 받지 못했을 때 참이다. 대기자가 답을 받았다는 것은 둘 중 하나다: (가) 그 대기자의 Orca 게이트가 열려 있지 않다(풀렸다). (나) 그 대기자 Task 로 답의 `notified` 키(`answerNotifiedKey(dNNN, task)`, 결정 91④ 의 `notified:dNNN:<task>`)가 이미 있다.

**왜 (나) 가 필요한가.** 결정 91④(ii) 에서 Task 가 이미 닫혔으면 게이트는 일부러 열어 둔 채 Run 에 메시지 하나를 보낸다(`core/decision/release.ts`). 91④(i) 의 새 워커 첫 프롬프트도 게이트를 풀지 않고 같은 키를 쓴다. 게이트만 보면 이런 대기자는 영원히 "전달 안 됨"이 된다. 다른 Run 으로 넘긴 게이트(`…:resolve` 키)는 같은 키가 아니므로 그 Run 이 풀 때까지 전달 안 됨이다.

**고친 것.** U8 의 뷰는 `state === "answered"` 일 때만 참이었는데, `decisionAnswer` 는 답 바로 뒤에 `decision_closed{answered}` 를 써서 행이 곧 `closed` 가 된다. 그래서 게이트가 열린 채 닫힌 답이 "전달됨"으로 읽혔다. U9 는 `core/brief` 에 `isUndelivered` 를 따로 두어 이를 덮었는데, 규칙이 두 곳이 되므로 이 결정으로 뷰를 고치고 그 함수를 지웠다. 계약 `DecisionRow.undelivered` 의 설명 한 줄도 같이 고쳤다. 0128 의 "전달되지 않은 답" 항목을 이 결정이 대체한다.
