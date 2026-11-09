<!-- layout: slot=④ layer=실행 tokens=free -->
# core/start — 세션을 여는 유일한 길

sangsoe 가 여는 모든 세션은 `startUnit` 하나를 지난다(결정 94 (가)): `task-create --deps`(새 일일 때) → lineage·깊이 점검 → Task 가 `ready` 인지와 `capacity` 확인 → `worker-start --task <id> --worktree new-child` → 영수증과 `dispatch-show` 로 Dispatch 확인. 이것 말고 세션을 여는 코드는 없고, `test/lineage/no-other-start.test.ts` 가 저장소를 훑어 그것을 지킨다.

| 결과 | 언제 | 남기는 것 |
|---|---|---|
| `started` | Dispatch 가 있는 워커가 떴다 | 없음(Orca 가 원본) |
| `waiting` | Task 가 `ready` 가 아니거나 `capacity` 가 모자람 | 없음(거부가 아니다) |
| `refused` | 다섯 사유 중 하나(아래 순서로 판정) | `signal`{`start_refused`, reason} 한 줄 + 부모에게 escalation 한 통 |

거부 사유: `capability_missing` → `lineage_invalid` → `depth_exceeded` → `orca_error` → `no_dispatch`. 오케스트레이터가 거부되면 위가 없으므로 escalation 을 보내지 않고 `signal` 줄이 `owner_todo` 의 재료가 된다.

역할 규칙: 오케스트레이터(깊이 0) > 리드(오케스트레이터의 자식) > 워커. 워커는 시작하지 않고, 리드는 리드를 시작하지 않으며, 부모 worktree 나 요청자의 Dispatch 를 읽지 못하면 시작하지 않는다. 역할은 부르는 쪽(MCP tool·CLI)이 밝히고, 코어는 Orca 에서 그 역할이 맞는지(Dispatch 유무·깊이)를 읽어 대조한다.

T5(결정 84 ④): 시작 함수는 Task 상태를 먼저 읽어 `dispatched` 인 Task 를 다시 시작하지 않고, 같은 Task 의 `orca_error` 거부를 event 로 세어 세 번째에 `loop_detected` 를 쓰고 그 뒤로는 Orca 를 부르지 않는다.

`checkLineage` 는 회귀 시나리오 `unit_lineage_complete` 의 판정이다: 시작한 단위마다 Dispatch·Run·새 worktree 의 `parentWorktreeId` 를 읽어 하나라도 없거나 부모가 다르면 실패.
