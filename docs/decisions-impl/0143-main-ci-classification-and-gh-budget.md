# 143. main CI 분류, 재실행 1회의 주인, gh 한도

**읽는 것.** 저장소마다 GitHub 의 머지 시각(`pr_merged.merged_at`, 선택 칸으로 더함)이 가장 늦은 `pr_merged` 하나만 본다. land 는 저장소의 마지막 `main_*` 줄을 읽으므로, 옛 sha 를 새 sha 뒤에 판정하면 옛 빨강이 새 초록을 덮는다. 저장 순서로 고르면 늦게 처음 본 옛 머지가 가장 새것이 되므로 저장 순서는 쓰지 않는다. 그 머지가 `mainWatchHours`(24) 안이고 그 sha 에 `main_green` 이 아직 없으면(빨강인 sha 는 계속 읽어, 유예 뒤의 재실행이 통과하면 `main_green` 을 쓴다) `repos/<repo>/actions/runs?head_sha=<merge sha>&event=push` 를 읽는다. 실패한 run 만 `actions/runs/<id>/jobs?per_page=1` 의 `total_count` 를 더 읽는다.

| run 의 모양 | 판정 | 쓰는 것 |
|---|---|---|
| run 없음, 또는 하나라도 `completed` 아님 | 대기 | 없음 |
| 모두 `cancelled` | 모름(새 push 가 대신함) | 없음, `unseen` |
| 실패했는데 jobs 0 | 모름(GitHub 장애, U24a) | 없음, `unseen` |
| 실패 run 의 jobs 를 못 읽음 | 모름 | 없음, `unseen` |
| 첫 시도(`run_attempt` 1) 실패, `mainRerunMinutes`(30) 안 | 의심 | `ci_failed{pr, head_sha, run_id}`(키 `ci_failed:<run>:<attempt>`) |
| 재실행(`run_attempt` ≥ 2) 실패, 또는 첫 시도 실패가 유예를 넘김 | 빨강 | `main_red` |
| 취소 아닌 run 이 모두 `success`·`neutral`·`skipped` | 초록 | `main_green` |
| 그 밖의 결론(`action_required` 등) | 모름 | 없음, `unseen` |

**재실행은 누가 하나.** `core/gh` 는 읽기만 하고 sangsoe 의 GitHub 쓰기는 land 의 머지 하나다(결정 124). 그래서 pr-monitor 는 재실행하지 않는다. 첫 시도 실패는 `ci_failed`(`needs: action`)로 남기고, 알림을 받은 당사자가 한 번 재실행한다(agent-skills 의 리뷰 루프와 같은 "flake 는 한 번"). 재실행이 실패하거나 유예 안에 아무도 재실행하지 않으면 그때 `main_red` 다. 그래서 일시 오류 한 번으로 land 가 얼지 않고, 진짜 빨강은 길어도 유예만큼 늦는다.

**저장소 단위.** `main_green`·`main_red` 키는 `<type>:<repo>:<sha>` 이고 land 는 그 저장소의 마지막 줄을 읽는다(`repo_level_main`). 어느 묶음의 머지가 낸 초록이든 그 저장소의 빨강을 지운다.

**gh 한도(appendix `gh_budget`).** `gh_budget` 은 event 가 아니라 클라이언트 캐시다. runner 하나가 캐시 하나를 라운드 사이에 들고, 라운드 시작에 `budgetLevel` 을 본다. 30% 아래(`slow`)면 `verify_tier_set` 다시 매기기(diff·라벨 이벤트 읽기)를 건너뛰고, 10% 아래(`essential`)면 열린 PR 목록도 읽지 않아 머지 확인·main CI·Task 닫기만 남는다. 한도에 걸리면(`rate_limited` 응답) 라운드를 멈추고 `rate_limited{kind: github, reset_at}` 를 쓴다(키 `rate_limited:github:<reset epoch>`, 같은 한도는 한 줄). 주기는 2 분(`orca-plugin/monitors/pr.ts`)이고 라운드 하나는 저장소마다 목록 둘에 상태가 바뀐 PR 만 더 읽는다.
