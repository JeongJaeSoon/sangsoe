# 147. 항목 상태는 GRAPH 의 준비됨을 먼저 읽는다

`core/brief/item_status.ts` 의 `stateOf` 는 Orca 상태가 `ready` 면 GRAPH 를 보기 전에 🟢 를 돌려줬다. 그래서 Orca 의 deps 밖에 있는 간선(`deploys_after` 등, 구현 결정 126)이 아직 안 풀린 오너 항목이 `sangsoe graph why` 로는 📅 인데 현황에서는 🟢 였고, `owner_todo` 에 올라 패널의 완료 버튼을 받았다.

- **규칙.** Orca 가 끝냈거나(✅ · 🗑️) 결정 대기 · 진행 중 · 막힘이면 그 상태다. Orca 가 `pending` 이든 `ready` 든, 그 밖에는 GRAPH 가 준비됐다고 할 때만 🟢, 아니면 📅 다. 모름(`unknown`)은 준비됨이 아니다(결정 26). 단, 현황의 Orca 스냅샷(`readSnapshot`)은 task-list 에 deps 가 없어 `deps: []` 로 읽으므로, Orca deps 만으로 막힌 `pending` 항목은 GRAPH 가 볼 수 없다. 이 점은 `depsGraph` 때와 같다(이 변경으로 생긴 것이 아니다).
- **GRAPH 의 몸체.** 현황의 기본 포트가 U9 의 대체 `depsGraph` 에서 U7 의 `graphRead` 로 바뀐다(`itemFacts` · `buildBrief` · `buildGroup` · `buildItem`). `depsGraph` 는 내보내기만 남는다.
- **오너 항목을 잃지 않는다.** `core/graph` 의 `ready()`(계약 `ReadyView`, 리드가 시작할 수 있는 항목)는 `owner_ready` 를 빼고 그 뜻을 지킨다(U7 시험 prod_gate 가 고정한다). 대신 현황이 읽는 포트 `graphRead.ready` 가 `ready` 와 `owner_ready` 를 함께 돌려준다. 바꾸지 않으면 오너 항목이 모두 📅 가 되어 `owner_todo` 에서 사라진다.
