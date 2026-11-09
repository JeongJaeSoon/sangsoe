<!-- layout: slot=④ layer=실행 tokens=free -->
# core/notify — 실행 · 토큰 X

깨움의 유일한 길이다(결정 60·74 O-9·76(5)·80 N8, 부록 `#delivery`). Orca 메시지를 `send` 로 한 번 보내고 `notified` 를 쓴다. sangsoe 에는 받은 편지함이 없다.

- `notify.ts` — `notify`: Task·Run·Dispatch id 만 받아 주소를 `dispatch:<id>` · `run:<id>` 두 꼴로 만든다. 받는 순서(워커 → 소유 리드 → 오케스트레이터)를 어기는 보내기, `term_` 주소, 이미 만든 주소 문자열은 거부한다. 같은 키로 이미 `notified` 가 있으면 보내지 않는다.
- `address.ts` — `reportAddress`: 브리프·보고 주소의 모양 검사(`term_` 거부, 결정 80 N8).
- `result.ts` — 코어 함수가 돌려주는 `Result`·`Refusal` 꼴.
