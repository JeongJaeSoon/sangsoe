---
name: intake
description: "Use when the sangsoe orchestrator receives an owner's message and must classify it before acting: a question, a lookup, a change to work in flight, new work, something to do later or on a condition, or a call only the owner can make — \"이거 해줘\", \"그 PR 범위 바꿔줘\", \"머지되면 시작해\", \"다음 주에 다시 보자\", \"이거 어떻게 할까?\"."
---

# 지시 분류

오너의 말은 hook 이 `owner_action` 한 줄로 이미 남겼다. 오케스트레이터는 그 턴 안에 말을 여섯 갈래 중 하나로 가르고 그 갈래의 길로 보낸다. 채팅에만 남는 지시는 없다. 갈래는 기록하지 않는다: 분류를 남길 tool 이 없다(결정 162).

## 먼저: 열린 결정의 답인가

말이 열린 결정(dNNN)에 답하면 가르지 않는다. `decision_answer` 로 그 결정에 잇는다(`owner_action` 의 seq, 마스킹한 답). hook 은 이 세션(Dispatch 가 없는 오케스트레이터)에서 줄이 그 dNNN 으로 시작하고 다른 결정을 적지 않은 답만 이미 이었다(결정 173). 다시 불러도 결과는 같다. `linked_by` 는 비우거나 `orchestrator` 로 둔다: `hook`·`button` 은 그 입구가 스스로 정하고 tool 은 받지 않는다. 어느 결정의 답인지 확실하지 않으면 잇지 않고 오너에게 어느 것인지 묻는다.

## 여섯 갈래

| 갈래 | 이런 말 | 가는 곳 | 남는 것 |
|---|---|---|---|
| 바로 답 | 사실·설명을 묻는다. 네 맥락에 답이 있다 | 그 턴에 답한다 | 채팅 답 |
| 읽기·조사 | 찾아보고 알려 달라. 아무것도 바꾸지 않는다 | 읽기 전용 서브에이전트. 결과는 채팅 답 | 채팅 답 |
| 진행 중인 일의 범위 | 이미 도는 일을 고치거나 멈추거나 넓힌다 | 그 일을 쥔 세션(워커, 없으면 소유 리드, 없으면 너). 새 세션을 만들지 않는다 | Orca `send` 한 번 |
| 새 일 | 아직 없는 일을 하라 | 항목을 만들고, 준비되면 워커(프로그램 규모면 리드)를 시작한다 | `item_create`, `start_unit` |
| 시각·조건 대기 | "머지되면", "다음 주에", "X 가 끝나면" | PR 조건은 선행(`deps`·간선), 날짜 조건은 📅 예정(trigger 와 시작하는 쪽), 글로만 된 조건은 ⏸️ 보류(재검토 trigger) | 예정·보류 항목 |
| 오너 판단 | 오너만 정할 수 있는 선택이 걸렸다 | 결정을 연다: 질문·선택지·추천 | `decision_open` |

일곱째 갈래는 없다. 둘에 걸치면 더 무거운 쪽(오너 판단 > 새 일 > 진행 중인 일의 범위)으로 가르고, 판단이 서지 않으면 결정을 열고 기다린다.

## 쓰는 법

1. 갈래의 tool 이나 Orca 명령을 부른다.
   - 새 일: `item_create`(네 `runId`, `spec` 은 `write-brief` skill 로, `who`, `doneWhen` 한 줄, 알려진 `deps`). 준비되면 `start` skill.
   - 시각·조건 대기: 시작 시점은 `item_create` 그 호출에 함께 넣는다. 따로 달면 그 사이에 준비 상태로 보인다. PR 조건은 같은 Run 의 Task 면 `deps`, 아니면 `trigger` 에 `owner/repo#N`. 날짜 조건은 📅 예정으로 `trigger` 에 날짜(`2026-11-17`)와 시작하는 쪽 `exec_by`. 글로만 된 조건은 ⏸️ 보류로 `hold: true` 와 `review_trigger` 에 그 조건. 만든 뒤에 생긴 순서는 `edge_add`(`blocks`·`after`).
   - 진행 중인 일의 범위: 그 일을 쥔 세션에 Orca `send` 로 그 항목과 오너의 말 요지를 보낸다. 워커면 `--to dispatch:<dispatch_id>`, 리드면 `--to run:<run_id>`. 범위가 브리프의 승인 줄 밖으로 커지면 결정을 연다.
2. 오너에게 한두 문장으로 답한다: 무엇으로 갈랐고 어디로 갔는지.

## 하지 않는 것

- 분류하면서 일을 직접 하지 않는다. 바로 답과 읽기·조사 말고는 모두 다른 세션의 일이다.
- 결정은 오너의 답으로 닫히고, 할 일은 검증으로 닫힌다(결정 181). 결정은 오너 세션에서 그 `dNNN` 으로 시작하는 답이나 패널 버튼이 닫는다. 할 일은 오너가 끝냈다고 해도 `verify` probe 가 통과하기 전까지 ⏳ 검증 대기다. 그 밖의 말은 항목을 닫지도 결정에 답하지도 않는다.
