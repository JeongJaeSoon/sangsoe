<!-- layout: slot=④ layer=실행 tokens=free -->
# core/orca — Orca CLI 어댑터

① 칸의 Orca CLI 내장 기능(Task·Run·게이트·메시지·워커·참조·worktree)을 부르는 유일한 자리다. 만들지 않고 부르며, 읽은 값은 저장하지 않는다(결정 74·78). 인터페이스는 `core/contract/orca.ts` 의 `OrcaAdapter` 다.

- `commands.ts` — 래퍼마다 명령 경로와 넘길 수 있는 옵션 한 행. 래퍼는 여기 없는 옵션을 넘기지 못하고, 시작 점검 `orca-commands` 가 같은 표를 `orca agent-context --json` 과 대조한다(결정 63).
- `adapter.ts` — `createOrcaAdapter(exec)`. 응답은 `OrcaResult`(ok/error)이고 JSON 봉투가 없으면 `response_lost` 다. 쓰기는 Orca 가 알려 준 요청 id 를 돌려주고, 응답을 잃은 쓰기는 `recoverWrite` 가 `request-show` 를 본 뒤에만 같은 id 로 다시 보낸다(결정 60). `absent` 는 다시 보내지 않는다.
- `host-filter.ts` — `hostId == "local"` 인 행만 돌려준다. 비어 있거나 없는 `hostId` 는 비로컬이고, 비로컬 행은 수만 남는다(결정 88 ①). `worker-list` 는 같은 값을 `host` 로 준다.
- `task-list --full` 의 행은 Orca 가 저장한 이름(`task_title`·`dispatch_id`·`assignee_handle`)으로 오고, 어댑터가 짧은 목록의 이름(`title`·`dispatchId`·`assignee`)으로 맞춘다. `run-list` 는 `worker-list` 가 바인딩된 Run 만 보이는 탓에 자기 Dispatch 를 Run 마다 찾을 때 쓴다(결정 207).
- `exec.ts` — 셸 없이 `execFile` 로 부르는 실제 `Exec`. 시험은 `test/fake-orca/` 의 가짜를 넘긴다.

없는 것: 소비하는 메일 읽기(스크립트는 `inbox` 로 읽는다, 결정 60), 대체 시작(오너 d125), `dispatch`·`automations`. 세션이 자기 글로 직접 부르는 동사(`run-create`·`run-use`·`ask`·`reply`·`worker-release`·`worktree set`·`reference list`·`search`)도 행을 두지 않는다(결정 193).
