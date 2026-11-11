<!-- layout: slot=④ layer=실행 tokens=free -->
# core/start — 세션을 여는 유일한 길

sangsoe 가 여는 모든 세션은 `startUnit` 하나를 지난다(결정 94 (가)): `task-create --deps`(새 일일 때) → lineage·깊이 점검 → Task 가 `ready` 인지와 `capacity` 확인 → 고른 정책 행을 `unit_started` 로 남김(결정 200) → `worker-start --task <id> --worktree new-child`(대상 저장소는 `--repo`, 리드는 `--keep-open`, worktree 밖의 오케스트레이터만 `new-top-level --repo`, 결정 197) → 영수증과 `dispatch-show` 로 Dispatch 확인. spec 으로 만든 Task 에는 `item_created` 별칭을 붙인다. 이것 말고 세션을 여는 코드는 없고, `test/lineage/no-other-start.test.ts` 가 저장소를 훑어 그것을 지킨다.

| 결과 | 언제 | 남기는 것 |
|---|---|---|
| `started` | Dispatch 가 있는 워커가 떴다 | 없음(Orca 가 원본) |
| `waiting` | Task 가 `ready` 가 아니거나 `capacity` 가 모자람 | 없음(거부가 아니다) |
| `refused` | 여섯 사유 중 하나(아래 순서로 판정) | `signal`{`start_refused`, reason} 한 줄 + 부모에게 escalation 한 통 |

거부 사유: `capability_missing` → `lineage_invalid` → `depth_exceeded` → `model_invalid` → `orca_error` → `no_dispatch`. `model_invalid` 은 advisor tier 가 본 tier 보다 낮거나 fast tier 인 선택이다(결정 187): Claude Code 는 그런 advisor 를 말없이 떼므로 거부하는 곳은 여기 하나다.

모델(결정 187): `worker-start` 는 `--model`·`--effort` 를 받고, `--advisor` 는 Orca 의 `agent-context` 가 `orchestration worker-start` 의 flag 로 `advisor` 를 보일 때만 넘긴다(`orcaTakesAdvisor`, `ORCA_COMMANDS.workerStart.optional`; 지금 Orca 에는 없다). 없으면 advisor 는 오너 설정 `advisorModel`(키가 있는지만 읽는다)에서 오고, 그것도 없으면 `withoutAdvisor` 가 있는 행(구현 워커)은 그 tier 로 시작하고 `model_changed` 를 남긴다. 어느 쪽이었는지는 `started.notes` 와 `started.launch` 가 말한다. 오케스트레이터가 거부되면 위가 없으므로 Orca 메시지 대신 `escalation`{to `owner`} 한 줄을 쓴다(오너 할 일의 재료).

역할 규칙: 오케스트레이터(깊이 0) > 리드(오케스트레이터의 자식) > 워커. 워커는 시작하지 않고, 리드는 리드를 시작하지 않으며, 부모 worktree 나 요청자의 Dispatch 를 읽지 못하면 시작하지 않는다. 역할은 부르는 쪽(MCP tool·CLI)이 밝히고, 코어가 Orca 로 대조한다: 부르는 세션이 그 Run 을 쥐었는지(`run-current`), 리드·워커의 Dispatch 가 밝힌 worktree 의 것이고 시작하려는 Run 밖에 있는지, 리드의 깊이가 1 인지, 오케스트레이터의 worktree 에 끝나지 않은 Dispatch 가 없는지(`worker-list` 전 페이지), 밝힌 worktree 의 경로가 부르는 세션의 작업 폴더를 품는지(모든 역할; 코어는 그 세션의 자식 프로세스다). 앞의 둘을 함께 보아야 시작 함수가 연 리드가 오케스트레이터라고 밝혀도 거부된다. Dispatch 없이 손으로 연 리드는 Orca 로는 오케스트레이터와 같아 가르지 못한다(docs/test-outcomes.md). MCP `start_unit` 은 정해진 값이 아닌 `role`·`childRole` 과 기존 Task 에 붙은 `lateAnswers` 를 Orca 를 부르기 전에 `invalid_input` 으로 거부한다.

**남은 것(LATER, 결정 91 ④(i))**: 기존 대기자 Task 에 새 워커를 시작할 때 늦은 답을 싣고 `notified` 를 쓰는 길은 없다. `worker-start` 에는 기존 Task 의 첫 프롬프트를 바꿀 입력이 없고, 결정 뷰와 `dNNN` 도 아직 없다. 지금은 그 조합을 거부해 답이 말없이 사라지지 않게만 한다. 결정 뷰가 생기면(U8) 다시 본다.

새 Task 의 spec 첫 줄은 역할 줄 `sangsoe-role: <lead|worker>` 다(결정 46, `ROLE_LINE_PREFIX`). SessionStart hook 이 이 줄로 역할을 붙이고, 리드는 그때 자기 Run 을 만든다. Orca 는 spec 을 고치지 못하므로, 기존 Task 는 첫 줄이 `childRole` 의 역할 줄일 때만 시작하고 아니면 `lineage_invalid` 로 거부한다(`task-list --full` 로 읽는다). 리드 항목은 `item_create` 에 `role: lead` 를 밝혀 만든다. `/goal` 줄은 `worker-start` 세션에서 걸리지 않는다(docs/test-outcomes.md).

T5(결정 84 ④): 시작 함수는 Task 상태를 먼저 읽어 `dispatched` 인 Task 를 다시 시작하지 않고, 같은 Task 의 시작 시도 실패(`worker-start` 오류와 `no_dispatch`)를 event 로 세어 세 번째에 `loop_detected` 를 쓰고 그 뒤로는 Orca 를 부르지 않는다. 시작 전 읽기 실패는 세지 않는다.

`checkLineage` 는 회귀 시나리오 `unit_lineage_complete` 의 판정이다: 시작한 단위마다 Dispatch·워커·새 worktree 를 읽어 한 사슬인지(Dispatch 가 그 Task 의 것이고 기대한 Run 에 있음, 워커가 그 Dispatch 의 것, worktree 의 `parentWorktreeId` 가 기대한 부모. `new-top-level` 단위는 부모를 기대하지 않고 Run 만 본다, 결정 197) 보고, 하나라도 없거나 어긋나면 실패.
