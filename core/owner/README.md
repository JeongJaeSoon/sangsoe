<!-- layout: slot=④ layer=실행 tokens=free -->
# core/owner — 실행 · 토큰 X

오너 큐의 실행 쪽이다(결정 12·37·49·89·91·92⑥, 구현 결정 134·135). 오너 앞의 줄은 관측한 사실이나 기록된 답으로만 닫히고, 오너의 입력은 표지까지만 단다.

- `todo.ts` — `owner_todo` 뷰의 몸체: 열린 결정 · 오너가 who 인 🟢 · 리드가 못 푼 `waiting_human` · 전달되지 않은 답(+ 오케스트레이터 시작 거부는 그 항목의 줄로).
- `marks.ts` — 오너 항목의 `verify`·`cmd_hint`·표지(`입력 확인됨 · 검증 중` · `검증 안 됨` · `실행 실패` · `검증 없음`)를 event 에서 접는다. 🔍 를 푸는 증거인지 가르는 술어도 여기 있다.
- `link.ts` — 오너 입력(`!` 줄 · 채팅)을 열린 항목에 잇는 규칙(결정 91⑥(2), 오탐 방지 (가)–(마))과 그 기록.
- `probe.ts` — `verify` kind 다섯의 읽기(Orca 는 `core/orca` 어댑터, GitHub 은 `core/gh` 로만)와 라운드 한 번의 기록.
- `release.ts` — `waiting_human` 이 풀리는 신호와 `waiting_released`, 리드가 못 푼 대기의 판정. 비로컬 행은 풀지도 `moot` 로 닫지도 않는다.
- `done.ts` — 패널 "완료" 버튼 함수.

감지 층(hook·monitor)이 이 함수들을 부르고, 여기는 항목을 닫지 않는다. 닫는 것은 버튼 함수(명시적 답) 하나다.
