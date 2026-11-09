# 128. 현황 모델(`BriefModel`)이 읽는 뷰와 한 번 세는 법

결정 12·21·89·91·92⑤ 를 `core/brief/` 로 옮기며 정한 것이다.

- **함수 쌍.** `buildBrief(input, opts) → Overview`(1단계) · `buildGroup(input, 묶음) → GroupDetail`(2단계) · `buildItem(input, iNNN) → ItemDetail`(3단계)이 `BriefModel` 을 만들고, `renderMarkdown(model, {maxWidth: 78})` 이 글로 옮긴다. `input` 은 뷰 입력(`events` · Orca 스냅샷 · `now`)이고 아무것도 쓰지 않는다. 칸은 `{text, link?, tail?, strong?}` 이고 `text` 는 자르지 않은 전문이다: 자르기(`…`)와 `|` 이스케이프는 렌더러가 열 최대 폭으로 하므로 패널은 같은 모델에서 전문을 쓸 수 있다. PR 라벨 규칙(12칸)만 모델을 만들 때 적용한다.
- **숫자마다 읽는 곳.**

| 숫자 | 읽는 곳 |
|---|---|
| 맨 위 `내가 할 일 N (결정 a + 할 일 b)` · 절 (1)(2) 제목 · `sangsoe todo` | `owner_todo`(이 단위가 만든 몸체). 열린 결정과 전달되지 않은 답은 U8 의 `decision` 뷰에서, 오너 항목과 대기 세션의 항목은 아래 항목 사실에서 |
| 건수 줄 `summary{done,doing,left,blocked}` | `buildBrief` 가 표를 채우는 같은 항목 사실 한 번 훑기. `done` 만 `brief.done_days` 창 |
| 리드 행 · `묶음 N` · 2단계 머리 | `group_brief` |
| 항목 행의 상태 | 항목 사실 = Orca Task 상태 + `item_extra` 접기 + U8 의 `waiterReading`(결정 84③) + GRAPH 의 `ready` |
| 2단계 그래프 · 크리티컬 패스 · 왜 준비되지 않았나 | `GraphRead` 포트(U7). U7 이 들어오기 전에는 `depsGraph`(Orca `deps` 와 `edge_added` 만, 순환 검사 없음) |
| 3단계 사슬 | U1 의 `item_timeline` |

- **전달되지 않은 답.** `decision` 뷰는 행이 `answered` 일 때만 `undelivered` 를 세우는데 `decisionAnswer` 는 답 바로 뒤에 `decision_closed{answered}` 를 쓴다. 그래서 답으로 닫힌 행의 대기자 게이트가 Orca 에서 아직 열려 있으면 전달되지 않은 답으로 읽는다(`isUndelivered`). 뷰 쪽 수정은 이 단위의 범위 밖이라 발견으로 넘긴다.
- **오너 할 일은 네 종류만.** 오케스트레이터 시작 거부가 쓰는 `escalation{to: owner}` 는 결정 89·용어집 "오너 할 일" 의 네 종류에 없어 세지 않는다(시험이 고정한다). 결정 94·용어집 "시작 거부" 는 그것이 `owner_todo` 로 간다고 쓰므로 U14 가 둘을 맞춘다.
- **대기 세션의 항목.** 열린 `waiting_human` 행(`escalation_stale{waiting_unreleased}` 가 붙고 `waiting_released` 가 없는 것)은 그 행의 `entity_id` 가 가리키는 Task 의 `iNNN` 행이다(결정 92). 가리키는 항목이 없으면 `w<seq>` 행이고 어느 버킷에도 들지 않는다.
- **칸의 값.** `다음`: 열린 결정 `dNNN 답` → 전달되지 않은 답 `dNNN 전달` → 🚧 는 마지막 전환의 `reason` → 🟢 `시작` → 📅 `선행 대기`, 풀리지 않은 경보가 있으면 앞에 🚨(칸이 비면 경보 이름). 경보는 그 뒤에 항목이 다시 전환하면 풀린 것으로 본다. `추천` 은 Orca 게이트 선택지의 첫째다(`decision_opened` 에 추천 칸이 없다). `어디서` 는 오너 항목의 `cmd_hint`, 대기 세션은 `터미널`, 답 다시 보내기는 `sangsoe`. 리드 행의 `N건·막힘 M` 은 `group_brief` 의 열린 항목 수·🚧 수라 오너 할 일 절·보류 절의 항목도 세고, 2단계 머리와 같은 수다. `owner_act_unlinked` 는 "그 외" 리드 아래 PR 행 하나(`act:<pr>`, 상태 `—`, `항목` 은 act 글, `다음` 은 `오너 직접 · 연결?`)이고 `show_hours`(기본 24) 안에서만 보인다. 오케스트레이터가 이었을 때 바로 빠지는 길(결정 91⑤의 `decision_answered{ref}`)은 `decision_answered` 계약에 `ref` 칸이 없어 아직 없다. 그 입력 모양은 `UnlinkedAct` 한 타입이다(U14). `brief.done_days` · `unlinked.show_hours` 는 설정 읽기가 아직 없어 기본값 7·24 를 쓴다.
- **골든.** 입력은 `test/fixtures/brief/sample.events.jsonl`(메모리 store 에 다시 써서 계약 검사를 지난다)과 Orca 스냅샷 `sample.orca.json`, 기대 글은 `sample.md` 이고 `UPDATE_GOLDEN=1` 로만 바뀐다. 시험은 `core/brief/brief.golden.test.ts`(확인 (1)–(8), 2·3단계)와 `test/brief/todo-count.test.ts`(PN3).
