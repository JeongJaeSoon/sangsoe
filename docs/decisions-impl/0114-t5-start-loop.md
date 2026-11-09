# 114. T5: 시작 함수가 Task 상태를 먼저 읽고, 같은 Task 의 실패 시작을 세 번째에 멈춘다

결정 84 ④ 는 "Orca 가 이중 시작과 세 번 실패를 막으면 그대로 두고, 아니면 시작 함수가 막는다"고 했다. 이 유닛은 실제 Orca 에서 쓰기를 한 번(버리는 시작)만 허락받아 이중 시작과 세 번 실패를 실제로 재지 못했다(docs/test-outcomes.md T5 행). 그래서 두 막이 모두 시작 함수에 있다. Orca 가 막더라도 해가 없다: 먼저 읽고 거르는 것은 `worker-start` 한 번을 아낄 뿐이다.

- `worker-start` 전에 `task-list --run` 으로 Task 를 읽어 `dispatched` 면 `waiting{already_dispatched}`, `ready` 가 아니면 `waiting{not_ready}` 로 돌려준다. 시작하지 않는다.
- 같은 Task 의 `signal{start_refused, orca_error}` 줄을 센다. 세 번째 실패에서 `loop_detected`{reason `start_failed_3x`} 를 한 번 쓰고, 그 뒤 호출은 Orca 를 부르지 않고 `stopped` 를 돌려준다. 실패 응답에 Dispatch id 가 실려 있으면(Dispatch 를 받고 시작 도중 죽음) `worker_dead`{`start_failed`} 도 쓴다(결정 53·94).
- 응답을 잃은 `task-create`·`worker-start` 는 `recoverWrite`(`request-show` 뒤 같은 요청 id)로만 다시 보낸다(결정 60). `--retry-of` 는 어댑터 명령 표에 없어 쓰지 않는다.

**미확인으로 남는 것**: Orca 의 이중 시작 거부·3회 컷오프 자체, `merge_ready` 로 끝낸 Task 가 열린 채 남는지. 실제 Orca 에서 Run 을 쥔 세션이 재면 이 결정을 다시 본다.
