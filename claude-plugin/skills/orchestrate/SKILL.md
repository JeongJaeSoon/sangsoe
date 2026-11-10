---
name: orchestrate
description: "Use when this session is the sangsoe orchestrator or a lead handling a wake-up: an Orca message arrived (worker_done, escalation, question, notify), a program needs its next unit, or work must be split, ordered and driven to its exit condition — \"오케스트레이터로 돌아줘\", \"이 프로그램 끝까지 진행해줘\", \"다음 단위 시작해줘\", \"리드로 맡아줘\"."
---

# 오케스트레이션 판단 절차

오케스트레이터와 리드가 깨어났을 때 무엇을 판단하는지 정한다. 기록·계산·검사는 sangsoe 의 tool·resource·hook 이 한다. 여기 있는 것은 판단뿐이다.

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

## 깨움 처리

깨우는 것은 Orca 메시지 하나다. 하나를 처리하고 턴을 끝낸다. 다음 깨움은 Orca 가 가져온다.

| 받은 것 | 판단 | 쓰는 tool |
|---|---|---|
| 워커의 worker_done(PR 없는 일) | 브리프의 완료 조건마다 실제 출력이 있나. 있으면 Task 를 닫고, 없으면 무엇이 빠졌는지 워커(살아 있으면)나 새 워커에게 | Orca `task-update --id <task_id> --status completed` |
| 워커의 worker_done(`merge_ready`) | `land` 가 머지했나, 예약했나, "승인되면 머지"인가. Orca 가 Task 를 닫아도 PR 이 머지될 때까지 항목은 🚧 막힘(리뷰어)으로 읽히고, 머지 확인 뒤 ✅ 가 된다(결정 175). 손대지 않는다 | — |
| 리뷰한 head·리뷰어·증거(리드만) | 리뷰어가 작성자가 아니고 head 가 PR 의 현재 head 인가. 맞으면 판정을 기록한다(`pr`·`head_sha`·`act_on`·`reviewer`). 그 PR 을 쓴 세션은 거부된다 | `review_record` |
| 워커의 실행 출력(리드만) | 리뷰한 head 의 출력인가, 확인 못 한 것이 적혔나. 맞으면 등급이 묻는 `kind` 마다 증거를 기록하고, 머지 뒤에는 배포 단계를 기록한다. 그 PR 을 쓴 세션은 거부된다(결정 171) | `evidence_record` · `stage_record` |
| "승인되면 머지" PR 이 승인됨(리드만) | 같은 `land` 요청으로 머지한다 | `land` |
| 질문(`ask`) | 브리프와 승인 줄 안에서 답할 수 있나. 있으면 Orca `reply`, 없으면 한 단계 위로 | `decision_open`(오너 판단일 때) |
| escalation | 네 단위 안에서 풀 수 있나. 아니면 선택지·추천·기다리는 것을 붙여 위로 | `decision_open` 또는 Orca `send --type escalation` |
| 거부 보고 | 거부된 행위를 다른 길로 하지 않는다. 규칙이 바뀌어야 하면 오너 몫으로 올린다 | `decision_open` |
| `item_ready`·`capacity_free` | 시작할 항목이 생겼다 | `start_unit`(`start` skill) |
| `close_suggested` | 증거가 그 오너 항목의 완료를 보이나. 보이면 오너에게 완료 버튼을 누를 항목이라고 알린다. 오너 항목은 오너가 닫는다 | — |
| `main_red` | 머지한 PR 의 당사자에게 원인 좁히기를 맡긴다. 동결 중에는 `main_fix` 만 land 된다 | `start_unit` 또는 Orca `send` |
| `worker_dead`·`worker_stuck` | 같은 Task 를 다시 시작할지(`start_unit` 의 `task`), 멈출지 | `start_unit` |

## 리드: 프로그램을 끝까지

1. **완료 조건 먼저.** 시작 전에 "끝"과 미루는 것을 적는다. 진행률은 "N/M 완료 조건"이다.
2. **나누기.** 항목 하나가 리뷰 가능한 PR 하나다. 만들 때 알려진 선행은 `item_create` 의 `deps`, 그 밖의 순서는 `edge_add`. 같은 파일을 건드리는 두 항목은 `after` 로 순서를 적는다.
3. **고르기.** resource `ready` 에서 크리티컬 패스 위 항목부터 시작한다. 자리가 없으면 기다린다.
4. **기다리기.** 워커를 띄운 뒤 결과를 폴링하지 않는다. Orca 메시지가 깨운다.
5. **후속 일.** 완료 조건에 비춰 NOW(조건 항목이거나 이 프로그램이 머지한 것의 재현된 결함) · LATER(재검토 trigger) · DROP(이유)로 가른다. NOW 만 항목이 된다.
6. **끝.** 조건마다 증거를 확인하고 자기 Dispatch 로 worker_done 을 보낸다.

## 오케스트레이터: 프로그램 사이

- 오너의 말은 `intake` skill 로 가른다.
- 한 프로그램의 일은 그 리드에게만 보낸다. 리드의 워커에게 직접 지시하지 않는다.
- 리드가 끝났다고 보고하면, 완료 조건별 증거를 읽기 전용 서브에이전트로 확인한 뒤에 오너에게 "끝났다"고 말한다.
- 현황은 resource `brief` 를 그대로 보내고 판단 한 문장만 덧붙인다.

## 결정과 오너

- 오너에게 묻는 것은 `decision_open` 하나로 한다: `subject`(`item:iNNN` 또는 `scope:<group>`), `question`(추천과 이유도 이 글에), `options`, 기다리는 Task 는 `waiters`(`{task, run}`, `run` 은 네 Run), 기다리는 Task 가 없으면 `carrier_run` 에 네 Run. 결정 키는 `subject` 와 `options` 다. 같은 결정 키가 닫혀 있으면 기존 답이 돌아오니 다시 묻지 않는다.
- 답을 기다리는 동안 할 수 있는 일은 계속한다. 답이 없다고 기본값을 적용하지 않는다.
- 오너의 답은 `decision_answer` 가 결정을 닫고, 게이트를 풀고, 기다리던 워커를 한 번 깨운다. 다시 불러도 같다.

## 재시작

압축이 잦으면(`restart_due`) `handoff_save` 로 다음 할 일·기다리는 답·답 없는 질문·회신 경로를 남긴다. 리드가 다시 뜨면 자기 Run 을 `run-use` 로 다시 쥔다. 오케스트레이터의 Run 을 쥐지 않는다.
