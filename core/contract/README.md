<!-- layout: slot=④ layer=실행 tokens=free -->
# core/contract — 모든 유닛이 대고 짜는 타입 계약

- `events/<type>.ts` — event type 하나에 파일 하나. 페이로드 검증기와 `dedupe_key` 접두어를 함께 둔다. 새 type 은 파일 하나 + `index.ts` 의 `EVENTS` 에 한 줄.
- `define.ts` — 검증기 조합과 `defineEvent`. Orca 가 원본인 사실(`title`·`status`·`spec`·`deps`·`question`·`options`·`message_body`)을 실은 페이로드는 type 과 상관없이 거부한다(결정 74).
- `dedupe.ts` — `dedupe_key` 규칙.
- `transitions.ts` — 항목 상태 일곱과 전이표(허용 19 · 거부 30).
- `views.ts` — 뷰 시그니처. 입력은 "Orca 행 + event + now" 하나이고 결과는 저장하지 않는다.
- `clock.ts` — 주입하는 시계.
- `orca.ts` — U2 의 Orca 행 타입·어댑터 인터페이스(U2 소유).

계약 전체 설명은 `docs/architecture.md` 의 "코어 계약" 절.
