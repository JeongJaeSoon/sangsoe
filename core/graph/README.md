<!-- layout: slot=④ layer=실행 tokens=free -->
# core/graph — GRAPH · 실행 · 토큰 X

간선의 유일한 입구다(결정 26–32·44·49·50, 부록 `#dependencies-detail`). 상주하지 않고, 부를 때마다 Orca Task 읽기와 event 만 읽고 쓴다. Orca 는 `core/orca` 어댑터로만, event 는 `core/store` 로만 부른다.

## 한 간선은 한 곳에

| 간선 | 사는 곳 | 쓰는 길 |
|---|---|---|
| 항목을 만들 때 알려진 `blocks` | Orca Task 의 `deps`(`task-create --deps`) | `createItem`(U10) · `graph expand` |
| 그 밖의 `blocks` · `after` · `stacked_on` · `deploys_after` | `edge_added` · `edge_removed` event(`source = GRAPH`) | `graph add` · `graph remove` · `graph expand` · `graph sync` |

노드 이름: 항목 `item:<Orca Task id>`, PR `pr:<owner/repo#N>`, 결정 `decision:<dNNN>`. 후속은 늘 항목이다. 입력에서는 `iNNN` 별칭도 받아 Task id 로 바꾼다.

## 파일

| 파일 | 하는 일 |
|---|---|
| `nodes.ts` | 노드 이름 읽기·만들기 |
| `snapshot.ts` | `task-list --full` 행 → `OrcaSnapshot`(Run 여럿) |
| `facts.ts` | event 를 접어 현재 부가 간선 · 항목 부가 정보 · PR · 결정 · 단계 기록을 낸다 |
| `ready.ts` | `edgeOk` · `ready` · `why` (순수 함수, 저장하지 않음) |
| `read.ts` | `graphRead`: 다른 유닛이 task id 로 읽는 포트(`ready` · `edges` · `criticalPath` · `why`) |
| `edit.ts` | `addEdge` · `removeEdge`: 순환 · 없는 항목 · 후속이 항목이 아닌 간선 거부, 같은 간선 합치기 |
| `critical.ts` | `criticalPath` · `impact` |
| `toml.ts` | 흐름 틀이 쓰는 TOML 부분집합 파서(런타임 의존 없음) |
| `flow.ts` | 흐름 틀 읽기 · 검사 · `planFlow`(`--dry-run`) · `expandFlow` · `flowGap` · `doneBlockers` |
| `sync.ts` | 부르는 쪽이 준 쌓인 PR(`--stack <pr>=<base>`)로 `stacked_on` 을 더하고, 머지·닫힌 선행과 dangling 을 알린다 |
| `notify-ready.ts` | 새로 준비됨이 된 항목의 소유 리드에게 `notify` 한 번 |
| `flows/` | 기본 흐름 틀 `ship-change.toml` · `ship-batch.toml` |

순환 거부는 둘이다: `addEdge` 가 Orca deps + 부가 간선 합집합에서 닿는지 보고, `event` 삽입 트리거 `edge_no_cycle` 이 부가 간선만으로 같은 검사를 한다(Store 가 트랜잭션을 밖에 내지 않아 원자적인 마지막 방어선은 트리거다).

## 흐름 틀 TOML 부분집합

`key = value` 줄, `[table]` · `[a.b]` · `[[steps]]` 머리, 값은 큰따옴표 문자열 · 정수 · `true`/`false` · 한 줄 배열 · 한 줄 인라인 표, `#` 주석. 여러 줄 문자열 · 날짜 · 점 찍힌 키 대입은 받지 않고 줄 번호와 함께 거부한다.
