# 126. GRAPH 의 간선은 한 곳에만 있고, 가장 아래에서 순환을 막는다

U7(GRAPH)을 만들며 정한 것이다. 결정 92④ 의 표와 split.md §2 U7 을 코드로 옮겼다.

- **간선은 한 곳에만 산다.** 만들 때 아는 `blocks` 는 Orca `task-create --deps` 에, 나머지(`after`·`stacked_on`·`deploys_after`, 만든 뒤에 더하는 `blocks`, PR·결정이 선행인 간선)는 `edge_added`/`edge_removed` 이벤트에 산다. 같은 간선을 두 곳에 쓰지 않는다: `graph add` 가 Orca dep 에 이미 있는 `blocks` 를 받으면 `already`(where `orca`)로 돌려주고 이벤트를 쓰지 않는다. Orca dep 은 지울 수 없으므로 `graph remove` 는 `orca_dep` 로 거부하고 "dep 없이 다시 만들고 이 Task 를 취소한다"를 고치는 법으로 준다.
- **`ready` 의 모양.** `ready(input: ViewInput): ReadyRow[]`(계약의 `ReadyView`). 선행 상태를 모르면(`null`) 준비되지 않은 것이다. 간선 종류마다 충족 조건은 `blocks` = 항목 완료·결정 닫힘·PR 머지, `after` = 완료 또는 취소·PR 머지 또는 닫힘, `stacked_on` = 선행 항목에 붙은 PR 이 모두 머지, `deploys_after` = 선행 flow 의 PR 이 머지되고 선행 단계(`stage`, 기본 `merge`)의 `stage_recorded` 가 있음. `blocks`·`stacked_on`·`deploys_after` 의 선행 항목이 🗑️(취소·실패)거나 PR 이 닫히면 dangling 이고, `after` 는 🗑️ 로도 풀린다(결정 26). PR 로 판단하는 `stacked_on`·`deploys_after` 도 선행 항목의 Task 상태를 먼저 읽는다: 읽지 못한 Run 의 선행은 PR 이 머지됐어도 모름이다. 오너 항목(`exec_by=owner`)은 `ready` 에 들지 않고 `graph why` 의 `owner_ready` 로 보인다.
- **`edge_added` 의 dedupe 는 닫히지 않는다.** 지운 간선을 다시 더할 수 있어야 하므로 `dedupeClosed` 를 뺐다. 키는 `edge:<pred>:<succ>:<kind>[:<n>]` 이고 `n` 은 그 간선이 지워진 횟수다. 같은 간선을 두 번 더하면 같은 키라 두 번째는 `already` 다.
- **`item_extra_set` 에 `stage`(`merge|dev|prod`)를 더했다.** `deploys_after` 가 어느 단계의 `stage_recorded` 를 기다릴지 적을 곳이 계약에 없었다.
- **순환은 두 겹으로 막는다.** TS 쪽 `addEdgeTo` 가 Orca dep 과 추가 간선의 합집합에서 BFS 로 막고, 순환을 닫는 노드 경로를 이유로 준다. store 쪽은 스키마 2 의 트리거 `edge_no_cycle` 가 추가 간선끼리의 순환을 원자적으로 막는다(store 가 트랜잭션을 내놓지 않아 TS 검사와 쓰기 사이에 창이 있다). SQL view 를 쓸 수 없어 트리거가 현재 간선을 재귀 CTE 안에서 바로 계산한다. `edge_source_graph` 트리거는 `source <> 'GRAPH'` 인 간선 이벤트를 거부한다(GRAPH 밖 쓰기 거부). 스키마 1 DB 는 열 때 두 트리거를 받고 2 로 표시된다.
- **단계의 `blocks` 밖 간선은 그 단계를 만든 바로 뒤에 쓴다.** 단계는 모든 `needs` 순서로 만들어지므로 선행은 이미 있다. Orca 읽기는 첫 만들기 전에 한 번 하므로 만들기와 그 간선 사이에 실패할 Orca 호출이 없다. 펼치기가 중간에 끊겨도 이미 만든 단계는 제 게이트를 가지고, 남는 창은 그 사이의 프로세스 중단뿐이다(다 만든 뒤 한꺼번에 쓰면 끊긴 펼치기의 단계가 게이트 없이 준비됨이 된다). 이어 펼치기는 이미 있는 단계의 간선도 다시 쓴다(같은 간선은 `already`).
- **`flow_expanded` 를 단계보다 먼저 쓴다.** 펼치기가 중간에 끊기면 템플릿의 단계 수와 만든 단계 수가 달라 `flow_gap` 으로 보이고, 같은 요청 id 로 다시 펼치면 이어서 만든다. flow 루트의 `flow` 는 자기 task id, 단계의 `flow` 는 루트 id 다. 단계는 루트를 Orca `parent` 로 갖는다(`NewItem.parent` 를 더했다).
- **`deploy_prod` 는 `verify_dev` 를 `blocks`, `deploy_dev` 를 `deploys_after` 로 받는다.** `deploys_after` 하나만으로는 dev 검증 전에 prod 가 열릴 수 있다(prod_gate 회귀).
- **`graph sync` 는 쌓인 PR 의 base 를 부르는 쪽에서 받는다.** `pr_opened` 계약에 base 가 없다. `--stack <pr>=<base>` 로 받아 `stacked_on` 을 더하고, 이미 머지된 선행·dangling 을 알린다.
- **읽기 포트.** 다른 유닛(U9 단계 2 등)이 task id 로 읽도록 `graphRead`(`ready`·`edges`·`criticalPath(input, tasks)`·`why`)를 내놓는다.
