# A skill body with one missing name of each kind (test/spec-names.test.ts)

Read resource `timeline` first, then close the Task with Orca `task-close` and `item_snooze` it.

| 받은 것 | 쓰는 tool |
|---|---|
| worker_done | `item_transition` |
| 시작 | `start_unit`(`nope` skill) |
| 답 | Orca `reply` |
