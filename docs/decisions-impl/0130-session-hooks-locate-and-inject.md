# 130. 기록 hook 은 세션의 자리를 Orca 에서 찾고, 주입한 것은 `notified` 로 한 번만 싣는다

U13 의 기록 hook 일곱(`core/session/`)이 정한 것이다. 설계 결정 91(대기·늦은 답)과 95(세션 시작)를 구현하면서 생긴 빈칸을 채운다.

- **역할과 Task 는 저장하지 않고 Orca 에서 찾는다.** SessionStart 는 `cwd` 를 담은 main 이 아닌 worktree(realpath, 가장 긴 경로) → 그 workspace 의 끝나지 않은 worker → `worker-show` 의 Task·Run → `task-list --full` 의 spec 첫 줄 `sangsoe-role: <role>` 순서로 읽는다. `--agent sangsoe:<role>` 로 연 세션은 `agent_type` 이 역할이다. sqlite 에 역할 표를 따로 두지 않는다(이중 저장 금지).
- **`session_started` 한 행이 세션의 주소다.** `entity=task`·`entity_id=<Task>`, `subject=run:<Task 의 Run>`, `target=run:<run-current>`. 나머지 여섯 hook 은 이 행만 읽고 Orca 를 부르지 않는다. 이 행이 없는 세션(오너가 연 일반 세션)에서는 아무것도 쓰지 않는다. 키는 `session_started:<session>:<source>` 라 `/clear`·`resume`·`compact` 가 각자 한 행이다.
- **`model` 은 `"unknown"` 일 수 있다.** P9: SessionStart(startup) 입력에 `model` 이 없다(compact 에는 있다). 계약이 `model` 을 필수 문자열로 두므로 없으면 `"unknown"` 을 쓴다.
- **역할 줄이 없는 Dispatch 는 `worker_stuck{no_role_line}`.** worktree·Dispatch 는 찾았는데 역할을 못 읽으면 키 `worker_stuck:<Task>:no_role_line` 으로 한 번 쓰고 한 줄만 주입한다. Dispatch 도 없으면 아무것도 하지 않는다.
- **주입 순서.** 역할 줄과 id → Run 줄(쥐고 있으면 그 Run, 비었으면 같은 Task 의 앞 세션이 쥐던 Run 으로 `run-use` 지시) → 자기 Run 우편함의 마지막 `handoff` 한 번 → 버전 어긋남 → 늦은 답.
- **한 번만 싣기는 `notified` 로.** 인계는 `notify:<run>:handoff:<msg id>`(`msg_id` 는 Orca 메시지 id), 늦은 답은 U8 의 `answerNotifiedKey(dNNN, Task)` 를 그대로 쓰고 `msg_id` 는 `inject:<session>` 이다. U8 이 이미 그 답을 Orca 로 보냈으면 같은 키라 다시 싣지 않는다. 그래서 `/clear` 뒤 새 세션은 같은 인계·답을 받지 않는다(`late_answer_reaches_next_worker`).
- **기록 hook 은 막지 않는다.** CLI 가 없거나, 입력을 못 읽거나, Orca·sqlite 가 실패해도 0 으로 끝난다(`record.sh` · `sangsoe hook <event>`). 막는 hook(결정 75 나)과 반대다. 실패한 SessionStart 는 반쪽 주입 대신 아무것도 출력하지 않는다.
- **`handoff_save` 는 sqlite 에 쓰지 않는다.** 네 칸(`next`·`waiting`·`open_questions`·`reply_to`, 빈 문자열·4000자 초과·모르는 칸 거부)을 검사해 `run:<run-current>` 로 `send --type handoff` 한 번. 정본은 Orca 우편함이다.
