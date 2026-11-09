<!-- layout: slot=④ layer=실행 tokens=free -->
# core/migrate — agent-skills 의 열린 항목·결정을 한 번 가져오기

`sangsoe migrate` 의 코어다(port-plan 1절 D-13, 5절 5, 구현 결정 140). 옛 저장소 `agent-skills.db` 를 읽기 전용으로 열어 열린 항목(`item.status` 가 `todo`·`doing`·`held`)과 열린 결정(`decision.status = 'open'`)만 고른다. 닫힌 기록과 Orca 가 원본인 행(`board_row`·`lead`)은 가져오지 않고 개수만 보인다.

- `source.ts` — 옛 DB 를 `readOnly` 로 열어 읽는다. 옛 저장소가 자기 이행 단계(`4a-decisions`·`4b-board`)를 마치지 않았으면 거부한다. 쓰는 일은 없다.
- `plan.ts` — 순수 함수. 옛 행 → 만들 것(Orca Task·부가 정보·간선·결정)과 이미 가져온 것을 가른다. `--dry-run`(기본)은 이것만 돈다.
- `apply.ts` — 계획을 코어 함수로 쓴다: 항목은 `createItem`, 부가 정보는 `item_extra_set`, 간선은 GRAPH `addEdgeTo`, 결정은 `decisionOpen`. 같은 요청 id 로 다시 돌리면 아무것도 두 번 만들지 않는다.

가져온 항목의 글(제목·다음 행동·메모)은 Orca Task 의 title·spec 에만 가고 event 에는 들어가지 않는다(원본은 하나). `doing` 이던 항목도 Task 를 만들기만 하고 시작하지 않는다: 시작은 `startUnit` 의 일이다.
