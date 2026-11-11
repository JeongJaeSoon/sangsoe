---
name: deliver-ticket
description: "Use when a sangsoe worker takes one Task from first edit to merge-ready: plan, implement with tests, independent review, evidence for the verification tier, PR, then the land tool and the merge_ready report — \"PR 올려줘\", \"머지까지 진행해줘\", \"리뷰 코멘트 대응해줘\", \"이 항목 끝내줘\", \"ship it\"."
---

# 항목 하나를 머지 대기까지

워커가 바꾸는 일 하나를 끝내는 순서다. 머지하는 길은 `land` tool 하나다. GitHub 의 머지 명령을 직접 부르지 않고, 자동 머지·관리자 머지 플래그도 쓰지 않는다. 막는 hook(`[gate:self-land]`)이 열린 PR 을 두고 끝나는 것을 막는다.

## 1. 계획

브리프의 완료 조건을 다시 읽고, 무엇을 바꿀지와 어떻게 확인할지를 PR 본문 초안에 먼저 적는다. 계획은 승인을 기다리는 단계가 아니다. 브리프가 승인이다. 범위가 브리프와 크게 다르면 PR 하나로 리뷰할 수 있는지 보고, 안 되면 리드에게 나누자고 묻는다.

## 2. 구현과 시험

- 자기 worktree 의 새 브랜치에서 일한다.
- 로직을 바꾸면 그 변경을 확인하는 시험을 같이 쓰고 실제로 돌린다. 버그 수정은 실패하는 시험부터(`tdd`).
- 확인한 증거만 남긴다. "도움이 될 것 같은" 변경은 가설이고, 증거가 아니라고 하면 되돌린다.
- 브리프 밖에서 찾은 것은 고치지 않고 worker_done 에 NOW·LATER·DROP 제안으로 적는다.

## 3. 독립 리뷰

- 리뷰어는 작성자가 아니다. 변경 파일과 관련 시험만 주고, 너의 설명·결론은 주지 않는다. 리뷰어의 모델과 effort 는 resource `models` 의 review 행이고, 안정 릴리스 앞 마지막 리뷰는 release-review 행이다.
- 찾은 것을 Act-on · Consider · Noted · Dismissed 로 가르고, Act-on 이 0 인 회차가 나올 때까지 고치고 다시 받는다.
- **판정은 리뷰한 head 에 묶인다.** 리뷰 뒤에 커밋하거나 main 을 합치면 그 판정은 낡는다. 충돌을 풀며 main 을 합쳤으면 그 합침의 차이만 다시 리뷰받는다(delta 리뷰).
- **작성자는 자기 판정을 기록하지 않는다.** 리뷰한 head sha, 리뷰어, 리뷰 원문(남은 Act-on 수가 적힌 것)의 위치를 리드에게 보낸다. 기록은 리드가 `review_record` 로 한다(결정 111). 네 세션에서 부르면 거부된다(결정 162). 요약은 근거가 아니다.

## 4. 증거: 검증 등급

PR 의 검증 등급(V0–V3)은 diff 로 정해진다. 너는 고르지 않고, 그 등급이 요구하는 증거를 머지할 head 에서 만든다.

| 등급 | 무엇이 바뀌었나 | 필요한 증거 |
|---|---|---|
| V0 | 문서·주석 | 필수 CI 통과 |
| V1 | 시험만·리팩터 | V0 + 대상 시험 실행 출력 |
| V2 | 로직(분류 안 된 경로 포함) | V1 + 바꾼 동작을 로컬이나 dev 에서 실제로 돌린 출력: 무엇을 돌렸고, 무엇을 확인했고, 무엇을 확인하지 못했는지 |
| V3 | 화면·외부 연동·의존성·CI·배포·인증·권한·마이그레이션·보호 경로 | V2 + 화면이면 스크린샷·GIF 와 리드 판정, 배포·연동이면 dev 반영 확인, 사람 승인 |

- 등급을 낮추는 라벨은 설정의 owners 만 유효하다. 올리는 것은 누구나 한다.
- 증거는 `evidence_record` tool 로 남긴다: 그 head 의 `kind`(`test`·`run`·`ui`·`dev`)마다 종료 코드와 "확인하지 못한 것" 목록. PR 을 쓴 세션은 기록하지 못한다(결정 171). 실행 출력과 확인 못 한 것을 리드에게 보내고, 리드가 기록한다. 판정과 같은 길이다.
- "확인하지 못한 것" 칸을 비우지 않는다. 비거나 기록이 없으면 `land` 가 `evidence_missing` 으로 거부한다.
- 머지 뒤 배포 단계(`merge`·`dev`·`prod`)는 `stage_record` tool 로 남긴다. 흐름 틀의 배포 단계는 이 기록을 기다린다.
- 검증하려고 띄운 compose·프로세스는 확인한 그 턴에 내린다.
- 초록 체크는 증거가 아니다. CI 로그에서 그 단계가 실제로 돌았는지 읽는다.

## 5. PR

- 본문: 왜 · 범위 · 트레이드오프 · 영향 범위 · 검증(각 확인을 VERIFIED · NOT VERIFIED · INCONCLUSIVE 로). 어떤 리뷰를 돌렸는지 한 줄(리뷰 범위 줄).
- PR 을 열면 자기 카드에 한 번 적는다: `orca worktree set --worktree current --workspace-status in-review --comment "<PR URL>"`. 카드는 오너가 Orca 에서 보는 한 방향 표시이고 원본이 아니다. 오너가 이미 다른 열로 옮긴 카드(`orca worktree show --worktree current --json` 의 `workspaceStatus` 가 `todo`·`in-progress` 가 아님)는 덮지 않는다. PR 과 항목의 연결(Orca 참조)은 pr-monitor 가 붙인다(결정 193).
- 다른 열린 PR 에 기대는 변경이면 그 PR 위에 쌓는다. 의존은 `stacked_on` 간선이다.
- 리뷰를 사람에게 부탁했으면 `review_ask_record` 로 남긴다.
- 필수 CI 가 초록이고, 리뷰 스레드가 모두 풀리고, 독립 리뷰의 Act-on 이 0 일 때까지 따라간다. 기다릴 때는 백그라운드 명령의 완료 알림이나 Orca 메시지가 깨우게 한다.

## 6. land 와 머지 대기 보고

1. `land` 를 부른다: `{pr, head_sha}`. head 는 리뷰하고 증거를 만든 그 sha 다.
2. 결과를 읽는다. 성공이면 `action`, 거부면 `refusal.code` 다. 먼저 `dry_run: true` 로 불러 조건만 볼 수 있다.
   - `auto_merge`: GitHub 이 필수 리뷰와 CI 가 찰 때 머지한다. `merge_approved`·`merge_verdict`: 승인이나 기록된 리뷰 판정으로 지금 머지했다(결정 158).
   - `merge_on_approval`: 승인이 찰 때 pr-monitor 가 리드를 깨우고, 리드가 같은 `land` 로 머지한다.
   - 거부 code(`evidence_missing`, `review_missing`, `review_stale`, `head_moved`, `stack_order`, `main_red` 등): `refusal.fix` 대로 원인을 고치고 다시 부른다. `review_stale`·`head_moved` 는 리뷰한 head 가 지금 head 가 아니라는 뜻이니, 새 head 를 다시 리뷰받는다. 브랜치 보호가 조건을 채우지 않으면(못 읽음·없음·요구하지 않음) land 가 그 조건을 스스로 확인한다(조건의 `source: own`, 결정 204): `checks_pending`·`checks_red`·`checks_missing` 은 head 의 모든 검사, `behind_base` 는 head 가 base 끝을 품지 않는다는 뜻이다. base 를 합쳐 push 하고(충돌을 풀었으면 `git show --remerge-diff` 로 delta 리뷰) 새 head 를 리뷰받는다. `main_red` 동안에는 `main_fix: true` 로 요청한 PR 만 들어간다.
   - 거부(hook·권한): 다른 길로 머지하지 않는다. 일을 맡긴 쪽에 거부 보고로 알린다.
3. 머지했든 예약했든 "승인되면 머지"든, `merge_ready` 를 담은 worker_done 한 번으로 끝낸다: PR, head sha, 리뷰 판정과 리뷰어, 등급과 증거, 확인 못 한 것. `--type merge_ready` 메시지를 따로 보내지 않는다(결정 175, `[gate:self-land]` 가 막는다). Orca 는 worker_done 으로 Task 를 닫지만, 브리프는 PR 이 머지될 때까지 항목을 🚧 막힘(리뷰어)으로 읽는다. 네가 항목을 닫지 않는다.

worker_done 전에 `end-session` skill 을 읽는다.
