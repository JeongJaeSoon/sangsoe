# 140. `sangsoe migrate`: 옛 저장소의 열린 항목·결정을 코어 함수로 한 번 가져온다

port-plan 1절 D-13 과 5절 5("열린 항목·열린 결정만 읽기 전용으로")를 `core/migrate/` 로 옮기며 정한 것이다. 결정 68(한 번에 전환)·74 O-6 을 바꾸지 않는다.

- **읽는 곳과 읽는 법.** 옛 저장소는 `agent-skills.db` 하나다(`$ORCH_FLEET_STATE`, 없으면 `~/.local/state/agent-skills/dashboard/`, `--from` 으로 바꾼다). `node:sqlite` 의 `readOnly` 로 열고 `SELECT` 만 한다. WAL 이 쓰인 DB 도 이 열기는 내용을 바꾸지 않는다. 열지 못하면 거부하고 다른 열기(복사·`immutable`)로 돌아가지 않는다: `immutable` 은 체크포인트 안 된 WAL 을 못 보아 옛 행을 말없이 읽는다. 옛 저장소가 자기 이행 단계 `4a-decisions`·`4b-board` 를 `migration` 표에 적지 않았으면 거부한다(옛 코드도 그 DB 를 정본으로 보지 않는다). sangsoe 의 `node:sqlite` 는 `core/store/` 가 쥐지만 그것은 sangsoe 자신의 DB 이고, 이 모듈은 남의 DB 를 한 번 읽는 다른 원천이라 여기에 둔다.
- **고르는 것.** 항목은 `item.status IN ('todo','doing','held')`, 결정은 `decision.status = 'open'` 뿐이다. 닫힌 항목·결정은 개수만 보인다. `board_row`(리드·카드 행)와 `lead` 는 Orca 의 Run·worktree 를 비춘 것이라 가져오지 않고 개수와 이유만 보인다(원본은 하나, 결정 74).
- **항목 → Orca Task + 부가 정보.**

| 옛 칸 | sangsoe 의 자리 |
|---|---|
| `title` | Task `title`, spec 첫 줄 |
| `next` · `note` | Task spec 의 다음 줄들(Orca 만 가진다, event 에 넣지 않는다) |
| `who` | `item_created.who`(비면 `owner`) |
| — | `item_created.done_when`: 옛 칸에 없으므로 고정 문장 "옛 항목의 목표가 이뤄진다(처음 손댈 때 다시 적는다)"(R-14 가 칸을 요구한다) |
| `status = held` (`later` 칸) | `item_extra_set.hold = true` |
| `lane = owner_todo` | `item_extra_set.exec_by = owner` |
| `trig` · `due` · 항목을 가리키지 않는 `after_ref` | `item_extra_set.trigger` 한 줄(`trig`, `due <시각>`, `after <글>` 을 ` · ` 로 잇는다) |
| 다른 열린 항목 id 를 그대로 가리키는 `after_ref` | GRAPH `addEdgeTo`(`after`, 앞 항목 → 이 항목) |
| `program` | `item_extra_set.links` 의 `agent-skills-program:<이름>` |
| `id` | `item_extra_set.links` 의 `request:agent-skills/item/<id>` (멱등 열쇠) |
| `waiting`·`waiting_since`·`pos`·시각 칸 | 가져오지 않는다: 막힘은 sangsoe 가 Orca 게이트·`waiting_*` 로 새로 잰다 |

`doing` 이던 항목도 Task 를 만들기만 한다. 시작은 `startUnit` 하나뿐이다(결정 94).

- **결정 → `decisionOpen`.** 주제는 `scope:agent-skills-<id>`, 선택지는 옛 `options` 의 `label` 이고 추천(`recommend`, 1부터 센 번호)을 맨 앞에 둔다(현황의 `추천` 은 게이트 선택지의 첫째다). 질문 글은 `title`·`body`·`link` 를 이어 게이트에만 간다. 기다리는 Task 가 없으므로 `carrierRun` = `--run` 이 운반 Task 를 만든다.
- **멱등 열쇠.** 항목은 `expandFlow` 와 같은 요청 id 꼴이다: `item_extra_set.links` 에 `request:agent-skills/item/<id>` 가 있는 Task 가 있으면 이미 가져온 것이다. Task 를 만든 직후 그 줄을 쓰므로 둘 사이에서 죽으면 다시 돌릴 때 Task 하나가 더 생길 수 있다(`expandFlow` 와 같은 틈). 결정은 `decisionKey(주제, 선택지)` 가 열쇠라 `decisionOpen` 의 재질문 게이트가 두 번째를 만들지 않는다. 간선은 GRAPH 의 `dedupe_key` 가 막는다. Orca 의 요청 id 는 응답을 잃은 쓰기의 복구(결정 103)에만 쓰는 것이라 열쇠로 쓰지 않는다.
- **입구.** `sangsoe migrate` 는 `--dry-run` 이 기본이고 Orca 를 부르지 않는다. 계획은 개수와 `id · 종류 · 할 일` 만 보이고 제목은 보이지 않는다(공개 보고에 옮기지 않게). 쓰기는 `--apply --run <run>` 일 때만이고, sangsoe store 가 없을 때 dry-run 은 store 를 만들지 않고 "아직 가져온 것 없음" 으로 읽는다.
