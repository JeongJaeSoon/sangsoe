<!-- layout: slot=④ layer=감지 tokens=free -->
# core/detect/pr — pr-monitor

`watch.repos` 의 PR 을 `core/gh` 로만 읽고 event 를 쓴다. PR 과 항목의 연결은 Orca `reference find` 가 원본이고(사본 없음), 에이전트의 `mailbox`(`dispatch:…`) → `worker-show` 로 Task 와 Run 을 찾는다. 감지기가 항목을 바꾸는 유일한 예외가 여기 있다: `merge_confirm`(GitHub 의 머지 표시 + 머지 커밋이 main 에 있음)이 참이면 `pr_merged` 를 쓴 뒤 같은 라운드에 PR 항목의 Task 를 `completed` 로 바꾼다(결정 84 ①, 142).

- `config.ts` — 설정 `watch`(`repos` · `authors` · `linked_only`)와 `owners`.
- `judge.ts` — 순수 함수: main CI 분류(`classifyMain`, 결정 143), Task 상태 → 항목 상태, `verify-tier:N` 라벨.
- `round.ts` — 라운드: 열린 PR(`pr_opened` · `pr_base_changed` · `verify_tier_set` · `pr_ready_to_merge`), 최근 닫힌 PR(`pr_merged` · `pr_closed` · `close_suggested` · `owner_act_unlinked`), 머지 sha 의 push CI(`main_green` · `main_red` · `ci_failed`), 한도(`rate_limited`). Orca 쓰기(`task-update` · `reference add` · notify)는 `Act` 로 돌려주고 `runMonitor` 가 event 를 쓴 뒤에 실행한다. dry run 은 실행하지 않는다.
