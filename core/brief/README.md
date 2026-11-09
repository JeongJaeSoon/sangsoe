<!-- layout: slot=④ layer=실행 tokens=free -->
# core/brief — 현황 세 단계 · 실행 · 토큰 X

채팅 · `sangsoe brief`/`sangsoe todo` · MCP resource `brief` · 패널 · 상태 표시줄의 숫자가 모두 여기서 나온다(결정 12·89·92⑤). 읽기만 하고 아무것도 쓰지 않는다. 설명은 구현 결정 128·129.

- `build.ts` — `buildBrief`(1단계 표 네 절 + `summary`) · `buildGroup`(2단계) · `buildItem`(3단계). 표와 건수를 같은 훑기에서 채운다.
- `render.ts` — `renderMarkdown`(열 폭으로 자르기 · `|` 이스케이프만, 다시 세지 않는다) · `renderTodo`.
- `item_status.ts` · `owner_todo.ts` · `group.ts` — 계약 뷰 `item_status` · `owner_todo` · `group_brief` · `group_items` 의 몸체.
- `graph.ts` — `GraphRead` 포트(U7 의 ready · 간선 · 크리티컬 패스 · why)와 그 전의 대체 `depsGraph`.
- `width.ts` — 표시 폭(agent-skills `table_width.py` 이식), `…` 자르기, PR 라벨, 기간.
- `load.ts` — store event + Orca 스냅샷 하나를 읽는다. `replay.ts` — JSONL fixture 를 메모리 store 에 다시 쓴다.
- 골든: `brief.golden.test.ts` ↔ `test/fixtures/brief/sample.{events.jsonl,orca.json,md}`. 기대 글은 `UPDATE_GOLDEN=1` 로만 바꾼다.
