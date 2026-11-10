---
name: start
description: "Use when a sangsoe lead or the orchestrator starts a session on an item: a worker for a ready Task, or a lead for a program — \"워커 띄워줘\", \"이 항목 시작해줘\", \"리드 붙여줘\", \"start a worker on i012\". Calls the start_unit tool; a worker never uses this."
---

# 세션 시작

세션을 여는 길은 MCP tool `start_unit` 하나다. 이 skill 은 언제 부르고, 무엇을 넘기고, 돌아온 결과를 어떻게 읽는지만 정한다. 검사는 코어가 한다.

<!-- sangsoe:rules:begin -->
## 역할·완료·깊이 규칙

- lineage 는 오케스트레이터(깊이 0, 자기 Run) > 리드(오케스트레이터의 자식, 자기 Run) > 워커(리드나 오케스트레이터의 자식)다. 리드의 Dispatch 깊이는 1 이다(오케스트레이터의 자식은 1).
- 워커는 세션을 시작하지 않는다.
- 리드는 리드를 시작하지 않는다.
- 세션을 여는 길은 MCP tool `start_unit` 하나다. Orca 의 agent launch, 프롬프트를 붙인 worktree 생성, 백그라운드 `claude`, Orca 의 감독 없는 dispatch 는 어느 역할도 쓰지 않는다.
- 부모 worktree·Dispatch 를 읽지 못하면 시작하지 않는다.
- 시작이 거부되면(`start_refused`) 같은 일을 다른 길로 시작하지 않는다. 거부는 이미 일을 맡긴 쪽에 escalation 으로 갔으니 답을 기다린다. `waiting`(준비 안 됨·이미 Dispatch 됨·자리 없음)은 거부가 아니라 기다림이다.
- 오케스트레이터는 완료 판정이 없다. /goal 을 걸지 않고 종료하지 않으며, 쉬는 동안은 Orca 메시지가 깨울 때까지 토큰을 쓰지 않는다.
- 리드는 프로그램의 완료 조건을 채웠다는 증거가 event 에 있을 때, 또는 오너가 중단을 지시했을 때 끝난다. 끝은 자기 Dispatch 로 보내는 worker_done 한 번이다.
- 워커는 받은 Task 의 완료 조건을 채우고 worker_done 을 한 번 보냈을 때 끝난다. PR 이 걸린 일은 `land` 뒤의 머지 대기 보고(`merge_ready`)를 담은 worker_done 이다. 첫 프롬프트에 /goal 줄이 있어도 워커·리드에게는 걸리지 않는다. 끝나는 조건은 Dispatch 와 worker_done 이다.
- 막히면 escalation 으로 한 단계 위에 묻는다. 권한·hook·사람이 거부한 행위는 다른 형태로 다시 하지 않고, 일을 맡긴 쪽에 거부 보고로 알린다.
<!-- sangsoe:rules:end -->

## 시작하기 전에

1. **항목이 준비됐나.** resource `ready` 에 그 항목이 있어야 한다. 없으면 resource 가 "왜 준비되지 않았나"(막는 선행·간선 종류·해야 할 일)를 보인다. 막힌 것을 풀거나 기다린다.
2. **브리프가 있나.** 새 Task 면 `write-brief` skill 로 spec 을 쓴다. 이미 있는 Task 면 그 spec 을 다시 읽어 완료 조건이 들어 있는지 본다.
3. **누구를 띄우나.** 오케스트레이터만 리드를 띄운다(`childRole: "lead"`). 리드와 오케스트레이터 모두 워커를 띄운다(`childRole: "worker"`).

## 부르는 법

`start_unit` 에 넘기는 것:

| 칸 | 값 |
|---|---|
| `role` | 네 역할(`orchestrator` 또는 `lead`) |
| `worktreeId` | 네 Orca worktree id. 새 worktree 는 그 자식이 된다 |
| `taskId` | 리드면 네 Task id. 오케스트레이터는 비운다 |
| `runId` | 네가 쥔 Run |
| `childRole` | `worker` 또는 `lead` |
| `task` 또는 `spec` | 있는 Task id, 또는 새 Task 의 브리프(`title`·`deps` 함께) |
| `lateAnswers` | 앞 워커가 끝난 뒤 도착한 답. 새 Task 의 첫 프롬프트에 한 번 붙는다. `spec` 과만 쓴다(`task` 와 함께면 `invalid_input`) |
| `references` | 티켓·이슈 URL. 새 worktree 에 붙는다 |
| `class` | 워커 단위의 class: `default`(구현, 기본) · `hard`(리드가 어렵다고 판단한 단위) · `design` · `mechanical`(버전 올림·링크 고침·수집, 구현에는 쓰지 않는다). 비우면 `item_create` 가 남긴 class, 그것도 없으면 `default`. 모델·advisor·effort 는 코어가 resource `models` 로 정한다(결정 187) |
| `kind` | class 가 아닌 일: 리드는 `lead`, 워커는 `review` · `release-review`. `class` 와 함께 주면 같은 행이어야 한다 |
| `effort` · `tier` · `reason` | 기본값으로 모자랄 때만. 그 행의 effort 사다리를 먼저 올리고, 사다리 끝에서도 모자라면 다음 tier 로 간다. 둘 다 `reason` 이 있어야 하고, 시작이 `model_changed` 로 남긴다 |

역할 줄(`sangsoe-role: …`)은 코어가 spec 첫 줄에 붙인다. 네가 쓰지 않는다. 있는 Task 로 시작하면 그 줄이 `childRole` 과 같아야 한다: 리드 항목은 `item_create` 의 `role: "lead"` 로 만든다(빼면 worker). 다르면 Orca 가 spec 을 고치지 못하므로 `start_unit` 이 `lineage_invalid` 로 거부하고, 항목을 맞는 `role` 로 다시 만든다. Orca 가 `ready` 로 보여도 같은 Run 의 선행 항목에 묶인 PR 이 아직 머지되지 않았으면 `waiting`(`not_ready`)이 온다(결정 178): 머지를 기다린다. `ready` resource 도 그 항목을 준비됨으로 보이지 않는다. 모델 이름·버전·effort 를 브리프에 적지 않는다. 고르는 것은 `class`·`kind` 와 승격 칸뿐이다.

advisor 는 행이 정한 tier 로 붙는다. 지금 Orca 의 `worker-start` 에는 advisor 옵션이 없어서, `started` 의 `notes` 가 어떻게 붙었는지 말한다: 오너 설정 `advisorModel` 이 있으면 그 advisor 가 붙고(짝 검사는 Claude Code 가 한다), 없으면 advisor 없이 시작하며 advisor 가 꼭 있어야 하는 행(구현 워커)은 `withoutAdvisor` tier 로 시작하고 `model_changed` 를 남긴다. 짝이 맞지 않는 선택(advisor 가 본 모델보다 낮은 tier)은 `model_invalid` 로 거부된다. `advisorModel` 을 정하는 것은 오너의 일이다. sangsoe 는 그 설정을 쓰지 않는다.

alias 는 바깥 설정(`ANTHROPIC_DEFAULT_*_MODEL`)에 고정될 수 있다. 시작한 워커의 첫 보고나 상태 줄에서 실제로 풀린 모델이 그 tier 의 현재 ID 와 다르면 워커를 다시 띄우지 말고 그 사실을 위로 올린다. `doctor` 의 `model-table` 행이 지금 걸린 고정을 보인다.

## 결과 읽기

`ok: true` 면 `value.kind`(와 `waiting`·`stopped` 의 `why`)를, `ok: false` 면 `refusal.code` 를 읽는다.

| 결과 | 뜻 | 할 일 |
|---|---|---|
| `started` | Dispatch 가 생겼다 | 끝. 워커의 보고는 Orca 메시지로 온다. 기다리며 폴링하지 않는다 |
| `waiting` · `not_ready` | Task 가 준비되지 않았다 | 선행을 본다. 다시 부르는 것은 준비된 뒤다 |
| `waiting` · `already_dispatched` | 이미 누가 일하고 있다 | 다시 시작하지 않는다 |
| `waiting` · `no_capacity` | 자리·부하 여유가 없다 | 자리가 나면(`capacity_free` 알림) 다시 부른다 |
| `stopped` · `start_failed_3x` | 같은 Task 의 시작이 세 번 실패했다 | 다시 부르지 않는다. 위에 올린다 |
| `ok: false`, `refusal.code` 가 거부 사유 | 시작하지 않았고, `start_refused` 신호로 이미 위에 보고됐다 | 같은 일을 다른 길로 시작하지 않는다. 원인이 Orca 설정이면 오너 몫이다 |
| `ok: false`, `refusal.code` 가 `invalid_input` | 입력이 틀렸다 | `refusal.fix` 대로 고쳐 한 번 다시 부른다 |

거부 사유 여섯은 `capability_missing` · `lineage_invalid` · `depth_exceeded` · `orca_error` · `no_dispatch` · `model_invalid`(advisor 짝이 맞지 않는 모델 선택) 다. 어느 것도 "다시 해 보면 되는" 사유가 아니다. 부모는 같은 일을 자기 Run 에 새 Task 로 만들지도 않는다(같은 일의 원본이 둘이 된다).

## 깊이가 모자랄 때

오케스트레이터는 리드를 시작하기 전에 Orca 의 중첩 워커 깊이 설정을 확인한다. 리드 아래에 워커를 열 수 없으면(깊이 2 미만) 리드 대신 그 프로그램을 자기 Run 의 워커로 돌린다. 설정을 읽지 못했으면 리드를 시작하고, 리드의 첫 워커 시작 결과가 판정한다(`no_dispatch` 면 거부 보고가 올라온다).
