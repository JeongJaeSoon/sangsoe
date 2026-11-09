<!-- layout: slot=④ layer=실행 tokens=free -->
# core/decision — 실행 · 토큰 X

결정 루프의 코어 함수다(결정 36·74 O-8·O-11·76(10)·84③·91③④, 부록 `#decision-loop-detail`). 막기와 풀기는 Orca 게이트가 하고, 여기는 결정 키 · `dNNN` · 게이트 id 연결과 재질문 차단만 갖는다. Orca 는 `core/orca` 어댑터로만, event 는 `core/store` 로만 부른다.

- `key.ts` — `decisionKey(subject, options)`: 질문 대상과 선택지를 정규화해 sha256 앞 16자. 질문 문장은 넣지 않는다.
- `open.ts` — `decisionOpen`: 재질문 게이트. 같은 키가 닫혔으면 기존 답을 돌려주고, 열려 있으면 대기자를 더하고, 없으면 `dNNN` 을 발번해 대기자 Task 마다 `gate-create`(대기자가 없으면 오케스트레이터 Run 의 결정 운반 Task).
- `answer.ts` — `decisionAnswer`: `decision_answered` → `decision_closed` → 부른 쪽 Run 의 열린 게이트마다 `gate-resolve` → 대기자마다 `notify` 한 번. 다른 Run 의 게이트는 그 Run 에 `notify` 로 넘긴다. 다시 불러도 같다.
- `moot.ts` — `decisionMoot`: 원인이 사라진 결정을 닫는다(대기자 Task 가 모두 닫힘·취소, 또는 PR 닫힘). 부르는 쪽은 queue-monitor 이고 MCP tool 은 없다.
- `held.ts` — `waiterReading`: 결정 84③. 게이트가 풀린 Task 를 워커가 쥐고 있으면 🔄 로 읽는다. `item_status` 뷰(U9)가 이 함수를 부른다.
- `waiters.ts` — 결정 하나의 대기자(Task · 게이트 · Run · 결정 운반 여부)를 event 에서 읽는다.
- `receipt.ts` — Orca 쓰기 영수증에서 id 를 찾는다(영수증 모양은 아직 기록된 적이 없다).
- `deps.ts` — CLI·MCP 가 쓰는 기본 의존(sqlite store + Orca 어댑터).
