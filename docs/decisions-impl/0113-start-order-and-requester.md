# 113. 시작 함수는 쓰기 전에 거부 사유부터 보고, 요청자의 역할은 부르는 쪽이 밝힌다

결정 94 (가)의 순서는 `task-create --deps` → `ready`·`capacity` → lineage·깊이 → `worker-start` 이고, (나)는 거부 사유를 `capability_missing` → `lineage_invalid` → `depth_exceeded` → `orca_error` → `no_dispatch` 순서로 판정한다. `startUnit`(core/start/)은 앞의 셋을 **Task 를 만들기 전에** 판정한다. 기능이 없거나 lineage 를 어기거나 깊이가 모자라면 어차피 세션은 열리지 않으므로, 그 전에 Task 를 만들면 일이 없는 Task 만 남는다("모르면 행동 0"). 그 뒤의 순서는 결정 94 그대로다: Task(새로 만들거나 이미 있는 것) → `ready`·`capacity` → `worker-start --task <id> --worktree new-child` → 영수증, 없으면 `dispatch-show` 로 Dispatch 확인.

**요청자.** 역할은 부르는 쪽(MCP tool `start_unit`·CLI)이 `Requester{role, worktreeId, taskId?, runId}` 로 밝힌다. 환경 변수에서 읽지 않는다(결정 94 (마): 환경 표지는 에이전트가 흉내 낼 수 있다). 코어는 그 말을 Orca 로 대조한다. 코어는 부르는 세션의 자식 프로세스라 Orca 가 답하는 `run-current` 는 그 세션의 것이고, 이것이 흉내 낼 수 없는 신원이다: 부르는 세션이 `runId` 를 쥐고 있어야 한다(워커는 Run 을 쥐지 않는다). 리드·워커는 `dispatch-show --task <자기 Task>` 로 Dispatch 와 `depth` 를 읽을 수 있어야 하고(리드는 깊이 1), 그 Dispatch 는 `worker-show` 로 밝힌 worktree 의 것이며 시작하려는 Run 밖(부모의 Run)에 있어야 한다. 오케스트레이터는 Task 를 들고 오지 않고, 그 worktree 에는 살아 있는 Dispatch 가 없어야 한다: 리드도 자기 Run 을 쥐므로 `run-current` 만으로는 오케스트레이터와 가를 수 없고, Run 을 가로질러 읽는 `worker-list`(모든 페이지)에서 그 worktree 의 살아 있는 Dispatch 가 리드·워커를 드러낸다(실제 Orca 에서 이 워커의 worktree 에 자기 Dispatch 가 `liveness: live` 로 읽힘). 읽지 못하면 거부다. 부모 worktree 는 로컬 `worktree list` 에 있어야 한다. 이 읽기에서 escalation 을 받을 부모(`creator_handle`)도 얻는다. 읽기는 판정 전에 모두 해 두어, 어느 사유로 거부되든 보고 길이 같다.

**새 세션의 역할.** 새 Task 의 spec 첫 줄은 역할 줄 `sangsoe-role: <lead|worker>` 다(결정 46). 역할은 Orca 의 Task spec 에만 있고 sqlite 에 사본을 두지 않는다. SessionStart hook 이 이 줄로 역할을 붙이고, 리드는 그때 자기 Run 을 만들어 쥔다(시작 함수는 남의 세션의 Run 을 만들지 않는다). `/goal` 줄은 `worker-start` 세션에서 걸리지 않으므로(docs/test-outcomes.md) 역할도 끝 조건도 `/goal` 에 싣지 않는다. Orca 자신도 같은 규칙을 지킨다: 워커 세션에서 자기 Run 에 `task-create` 를 부르면 `worker_cannot_coordinate_own_run` 으로 거부하고 아무것도 만들지 않는다(실제 Orca, docs/test-outcomes.md T5 행).

**거부 기록.** `signal`{kind `start_refused`, reason} 한 줄. 사유 문장은 `subject` 칸, 대상 Task 는 `entity_id` 다(페이로드에 Orca 의 사실을 넣지 않는다, 결정 74). `contract/events/signal.ts` 의 kind 목록에 남아 있던 `start_fallback` 을 `start_refused` 로 바꿨다(결정 94 (바), 문서 단위 U22 가 코드를 바꾸지 않았다). escalation 은 리드·워커가 `send --type escalation` 으로 부모에게 한 통, 오케스트레이터는 위가 없어 Orca 메시지 대신 `escalation`{to `owner`, reason `start_refused:<사유>`} 한 줄을 쓴다(그 줄을 `owner_todo` 뷰가 읽는 것은 U14 몫). 부모를 읽지 못한 `lineage_invalid` 는 보낼 곳이 없어 `escalatedTo: null` 이다.

**기다림.** Task 가 `ready` 가 아니거나 `capacity` 가 0 이면 `waiting` 을 돌려주고 아무것도 쓰지 않는다(결정 94 "거부가 아닌 것").

대안: Task 를 먼저 만들고 거부(빈 Task 가 남아 버림). 역할을 Orca 에서만 추론(리드와 워커는 둘 다 깊이 1 Dispatch 라 Orca 로는 가를 수 없어 버림).
