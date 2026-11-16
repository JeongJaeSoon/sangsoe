<!-- layout: slot=④ layer=실행 tokens=free -->
# core/owner — 실행 · 토큰 X

오너 큐의 실행 쪽이다(결정 12·37·49·89·91·92⑥, 구현 결정 134·135). 결정은 오너의 답으로 닫히고, 할 일은 검증으로 닫힌다(결정 181). 오너의 그 밖의 입력은 표지까지만 단다.

- `todo.ts` — `owner_todo` 뷰의 몸체: 열린 결정 · 오너가 who 인 🟢 · 리드가 못 푼 `waiting_human` · 전달되지 않은 답(+ 오케스트레이터 시작 거부는 그 항목의 줄로).
- `marks.ts` — 오너 항목의 `verify`·`cmd_hint`·표지(`입력 확인됨 · 검증 중` · `검증 안 됨` · `실행 실패` · `검증 없음`)를 event 에서 접는다. 무엇이 증거인지 가르는 술어도 여기 있다.
- `pending.ts` — `verify` 가 있는 오너 항목마다 probe 가 참을 본 시각(없으면 ⏳ 검증 대기). GRAPH 와 브리프가 같은 것을 읽는다(결정 181).
- `link.ts` — 오너 입력(`!` 줄 · 채팅)을 열린 항목에 잇는 규칙(결정 91⑥(2), 오탐 방지 (가)–(마))과 그 기록.
- `probe.ts` — `verify` kind 다섯의 읽기(Orca 는 `core/orca` 어댑터, GitHub 은 `core/gh` 로만)와 라운드 한 번의 기록.
- `prompt.ts` — 채팅 hook 이 받은 prompt 가 오너의 말인지, Orca·Claude Code 가 넣은 줄(`orca_nudge`)인지 머리의 꼴로 가른다(결정 173·196·206). 글 전체를 싼 붙여 넣기 틀(`<pasted_content id="…">`)은 `unwrapPaste` 가 벗긴 뒤에 보고, 서브에이전트가 넘긴 결과(`<agent-message`)도 `orca_nudge` 다(결정 282). `orca_nudge` 는 `owner_action` 을 쓰지 않으니 결정을 답하지도, 대기를 오너가 푼 것으로 적지도 않는다.
- `release.ts` — `waiting_human` 이 풀리는 신호와 `waiting_released`, 리드가 못 푼 대기의 판정. 비로컬 행은 풀지도 `moot` 로 닫지도 않는다. hook 이 더는 못 푸는 세션 대기(결정 232)는 `orphanedWaits` 가 고르고 orca-monitor 가 쓴다: 그 worktree 에 산 터미널이 없으면 `terminal_gone`, 열린 지 `show_hours` 가 지나면 `expired`.
- `act_pr.ts` — 오너의 `gh pr merge|close` 줄이 가리키는 PR 을 읽고, 그 PR 의 `pr_merged`·`pr_closed` 행이 줄에 이어지는지 판정한다(`settledByFact`). 브리프가 "오너 직접 · 연결?" 행을 모을 때 읽기만 한다(결정 342).
- `done.ts` — 패널 "완료" 버튼 함수.
- `extra.ts` — 항목의 `verify`·`cmd_hint` 를 `item_extra_set` 으로 적는 것과, 이미 있는 항목의 리드 묶음 · 보류 · trigger 를 바꾸는 `setItemExtra`(`sangsoe item set`, 결정 279).

감지 층(hook·monitor)이 이 함수들을 부르고, 여기는 항목을 닫지 않는다. Task 를 닫는 것은 버튼 함수 하나이고, `verify` 가 있는 항목은 그 뒤에도 probe 가 통과할 때까지 ⏳ 검증 대기로 읽힌다.
