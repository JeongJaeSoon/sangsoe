# 116. 결정 루프의 열쇠와 칸: 대기자마다 Run id, 답의 `notified` 키는 `notify:<task>:dNNN`

결정 36·91 을 계약에 맞추며 정한 것이다.

- **`notified` 키.** 결정 91④ 는 `notified:dNNN:<task>` 로 적었다. 계약의 `notified` 는 접두가 `notify` 이고 첫 칸을 줄의 `target` 에 묶으므로(U1 `dedupe.ts`) 받아들여지는 꼴은 `notify:<task>:dNNN`(`target` = 대기자 Task) 하나다. 받는 쪽이 워커든 Run 이든 같은 키다: 답 하나는 대기자 Task 하나에 한 번 간다. `decision_answer`, 시작 절차의 첫 프롬프트(91④(i), U10), SessionStart(U13)가 모두 `answerNotifiedKey(dNNN, task)` 를 부른다. `moot` 알림은 `mootNotifiedKey` = `notify:<task>:moot:dNNN` 이다.
- **받는 순서의 다음 사람.** 같은 조건을 다음 사람에게 올릴 때는 앞사람의 줄이 있어야 하고 키 끝에 받는 쪽(`lead`·`orchestrator`)을 붙인다. 처음 받는 사람의 키에는 붙이지 않는다. 그래서 위 키를 읽는 쪽은 "처음 전달"만 본다.
- **대기자의 Run id.** `gate-create`·`gate-resolve` 는 묶인 Run 안에서만 된다(결정 77 라). Task 의 Run 은 Orca 가 원본이지만 Orca id 는 sqlite 가 가질 수 있는 유일한 Orca 사실이므로(결정 74) `decision_joined` 에 선택 칸 `run` 을 더했다. 답할 때 Dispatch 로 Run 을 찾는 대안은 아직 워커가 없는 대기자에서 실패한다.
- **여는 쪽은 자기 Run 의 대기자만 넣는다.** 세 입구(`decision_open`·`decision_answer` tool, `sangsoe decision add|answer|moot`)는 부르는 세션의 Run 을 입력으로 받지 않고 `run-current` 로만 읽는다. 게이트는 그 Run 에 묶이므로 다른 값은 거짓이 된다. `decision_open` 은 다른 Run 의 대기자나 운반 Run 이 섞이면 아무것도 쓰기 전에 `cross_run_waiter` 로 거부한다. 여러 Run 의 Task 가 같은 결정을 기다리면 Run 마다 같은 질문으로 부르고, 키가 같으므로 같은 dNNN 에 합류한다.
- **다른 Run 의 게이트.** 닫을 때 다른 Run 의 열린 게이트는 그 Run 에 `handoff` 한 통을 보내고, 본문에 거기서 부를 것을 그대로 적는다. 답이면 `decision_answer`(서 있는 답의 `owner_action` seq 포함), `moot` 면 `sangsoe decision moot --decision dNNN` 이다. `moot` 는 MCP tool 을 늘리지 않으므로(결정 91③) CLI 만 있고, 이미 `moot` 인 결정에 부르면 처음 증거로 풀기를 이어 간다. 이 입구는 증거를 받지 않는다: 열린 결정은 Orca 가 대기자를 모두 닫힘으로 보여 줄 때만 `moot` 가 되고, PR 이 닫혔다는 증거는 그것을 관측한 queue-monitor 가 `decisionMoot` 를 직접 불러 싣는다. 이름만 대서 결정을 닫을 수는 없다(결정 91⑥). 입구는 모두 Run 을 쥔 세션에서만 되므로, queue-monitor 도 Run 이 묶여 있어야 한다(그 유닛의 일).
- **한 대기자의 실패는 다른 대기자를 막지 않는다.** 풀기는 대기자를 모두 돌고 나서 실패를 모아 `release_incomplete` 로 거부한다. 다시 부르면 남은 것만 한다.
- **동시에 연 두 호출.** 둘 다 게이트를 만들 수 있다. `decision_joined` 를 먼저 쓴 쪽의 게이트가 남고, 늦은 쪽은 자기가 만든 게이트를 `dNNN: duplicate gate, see <gate>` 로 닫는다. 그 닫기가 실패하거나 사이에 죽으면 남은 게이트는 다시 보지 않는다(검토 2회차 C2, 남겨 둠).
- **답의 근거.** `owner_action` 은 실제 `owner_action` 줄의 seq 여야 하고(`linked_by=observed` 면 `pr_merged` 줄), 다른 결정에 이미 쓰인 seq 는 `owner_action_used` 로 거부한다.
- **답과 `moot` 가 엇갈리면 답이 이긴다.** `moot` 가 열린 결정을 보고 닫는 줄을 쓰기 전에 답이 기록되면, 닫는 줄은 `moot` 의 것이 되지만 U1 뷰는 답을 남긴다(`state=answered`). `decision_answer` 는 답이 기록된 결정을 언제나 전달한다. 이 결정은 뷰에서 `closed` 로 바뀌지 않는다.
- **취소된 Task.** Orca 의 취소는 `status=failed`, `result=cancelled` 이고 `result` 는 `task-list --full` 에서만 보인다. U2 의 `taskList` 에 `full` 을 더했다. 그냥 `failed` 는 닫힌 Task 로 치지 않는다.
- **대기자는 모두 `decision_joined` 로 적는다.** `decision_opened` 는 키를 잡는 줄이고 게이트가 생기기 전에 쓴다(`task`·`gate` 를 비운다). 대기자마다 `decision_joined`(`dedupe_key = decision_joined:<dNNN>:<task>`)를 쓰고, 그 전에 같은 Task 에 `dNNN:` 으로 시작하는 열린 게이트가 있으면 새로 만들지 않는다. 도중에 죽은 `decision_open` 을 다시 불러도 게이트는 하나다.
- **결정 운반 Task 표시.** 부록이 말한 `exec_by=owner` 를 `item_extra_set` 로 쓴다. `moot` 판정은 이 Task 를 대기자에서 뺀다. 같은 Run 에 제목이 `dNNN` 인 Task 가 이미 있으면 다시 만들지 않는다.
- **닫는 줄은 결정마다 하나.** `decision_answered` 는 `decision_answered:<dNNN>`, 늦은 답은 `decision_answered:<dNNN>:late:<seq>`, `decision_closed` 는 답이든 `moot` 든 `decision_closed:<dNNN>` 하나다. 먼저 쓴 쪽이 이긴다.
- **`decision_closed.evidence`.** 결정 91③ 이 `moot` 에 증거를 싣는다고 해서 선택 칸을 더했다(`tasks_closed` 또는 `pr_closed:<owner/repo#N>`).
- **`owner_direct_merge` 의 `owner_action` 칸.** `linked_by=observed` 에는 오너의 말이 없다. 그 칸에는 답의 근거가 된 관측 event(`pr_merged`)의 seq 를 넣는다. 칸 이름은 바꾸지 않았다(U1 계약, 읽는 쪽 없음).
- **다시 묻기(`reopens`, `:r<n>`)는 이번에 만들지 않았다.** U8 수락 항목에 없고 `decision_opened` 에 칸이 없다.
