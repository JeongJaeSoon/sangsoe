# 124. land 판정 함수: 순서·거부 사유·입구와 GitHub 쓰기 한 곳

결정 72·79·81·85 와 부록 `#role-cards` 의 land 판정 함수를 `core/land/land.ts` 하나로 만들면서 설계가 값을 정하지 않은 것을 정했다.

정한 것:

- **입구.** 코어 함수 `land({repo, pr, headSha?, dryRun?, mainFix?}, deps)`. 셸은 `sangsoe land --pr N [--repo owner/name] [--head SHA] [--dry-run] [--main-fix]`, 에이전트는 MCP tool `land` `{pr, repo?, head_sha?, dry_run?, main_fix?}`. 둘 다 같은 함수를 부르고 시험이 세 길(함수·CLI·MCP)의 결과가 같음을 확인한다. `repo` 의 기본은 `sangsoe review record` 와 같은 `JeongJaeSoon/sangsoe`.
- **순서.** 입력 → PR 읽기 → 열림·draft 아님 → `--head` 가 현재 head → main 동결 → 스택 순서 → 리뷰 판정 → 등급의 증거 → 조건 넷 → 머지 요청 또는 `merge_on_approval`. 증거 점검이 조건 넷보다 먼저라서 증거가 모자라면 조건 넷을 읽지 않는다(결정 85).
- **`land_failed.reason`.** `<code>` 또는 `<code>:<detail>`. 거부의 `code` 와 같다.
  - `pr_unreadable` · `rate_limited` · `pr_not_open:<merged|closed|draft>` · `head_moved`
  - `main_red` — 그 저장소(`payload.repo`)의 마지막 `main_red`/`main_green` 이 빨강. 어느 묶음이 쓴 줄이든 저장소당 한 상태다(`repo_level_main`). `--main-fix` 만 지나간다.
  - `stack_order:<pred>` — 살아 있는 `stacked_on` 간선(`edge_added` 뒤에 `edge_removed` 가 없음)의 선행 중 `pr_merged` 가 없는 맨 아래 PR. 고침 안내가 그 PR 을 먼저 land 하라고 적는다(`stack_bottom`). 간선의 `pred`·`succ` 는 Orca Task id 라서 PR 과 Task 는 `pr_opened{pr, task}` 로 잇는다. 선행 Task 에 `pr_opened` 가 없으면 그 PR 의 머지를 확인할 수 없어 Task id 로 거부한다(fail closed).
  - `review_missing` · `review_act_on:<n>` · `review_stale:<sha7>` — 판정은 `review_verdict` 로만 읽는다(결정 111). 현재 head 에 Act-on 이 남은 판정이 하나라도 있으면 거부.
  - `evidence_missing:<kind>` — 결정 0125.
  - `merge_refused` — `gh pr merge` 가 0 이 아닌 값으로 끝남(메시지를 실음).
  - 입력 오류(`invalid_input`)와 store 를 못 연 경우(`store_unavailable`)는 PR 을 특정하지 못했거나 쓸 곳이 없어 `land_failed` 를 쓰지 않는다.
- **patch-id 승계(`retarget_approval`).** 현재 head 에 판정이 없고 다른 head 에 Act-on 0 판정만 있을 때, GitHub 의 세 점 비교 `compare/<base>...<sha>` 로 그 head 의 변경을 읽어 파일 이름과 `+`/`-` 줄(공백을 지우고 hunk 줄 번호는 버림)의 sha256 을 patch-id 로 삼는다. 현재 head 는 현재 base 로, 옛 head 는 현재 base 와 그 PR 의 `pr_base_changed.from` 모두로 계산해 하나라도 같으면 승계한다. 비교를 읽지 못하거나(브랜치가 지워짐 등) 패치가 빠진 파일이 있으면 승계하지 않는다(fail closed).
- **merge_on_approval 뒤 재호출(결정 81).** 조건 넷 중 하나라도 거짓이면, 작성자 아닌 사람의 마지막 리뷰가 그 head 의 APPROVED 이고(승인자는 `author_association` 이 OWNER·MEMBER·COLLABORATOR 이거나 설정 `owners` 의 로그인. 공개 저장소의 아무나 승인으로 머지되지 않게 한다) 변경 요청이 없으며 GitHub 이 `mergeable_state: clean` 이고 그 head 의 check run 이 모두 success·neutral·skipped 일 때만 머지를 요청한다(`land_requested{reason: approved}`). 아니면 `land_requested{reason: merge_on_approval}`.
- **GitHub 쓰기 한 곳.** `core/gh` 의 클라이언트는 읽기만 한다. 머지 요청 `gh pr merge <N> --repo <r> --auto --squash --match-head-commit <head>` 는 `core/land/ports.ts` 의 `ghMerge` 한 곳이고 land 는 그것을 주입받는다. `--match-head-commit` 이라 판정한 뒤 head 가 움직이면 GitHub 이 거부한다. 머지 방식은 squash 로 고정했다(이 저장소의 방식).
- **설정.** `~/.config/sangsoe/config.json` 의 `protected_paths`(결정 81 조건 ④와 V3 의 공용 키), `owners`, `verify_tier.{docs_globs, test_globs, ui_globs, v3_globs}`. 파일을 못 읽으면 `protected_paths` 는 거짓 조건, 등급은 V3 이다.
- **증거와 PR 의 연결.** `evidence` 페이로드에는 PR 칸이 없어서, 행의 `subject` 에 PR(`owner/repo#N`, 소문자)을 적는다. land 는 그 행만 읽는다.

미확인: 병합 대기열이 없는 저장소에서 이미 머지 가능한 PR 에 `--auto` 를 걸면 gh 가 바로 머지하는지 "clean status" 로 실패하는지. 실패하면 `merge_refused` 로 보이고(덮지 않는다) 다음 단위가 실측한다.

미룬 것: 재리뷰 항목을 `blocks` 로 만드는 일(`retarget_approval` 의 항목 쪽, item 생성 함수가 생기면), tree 변경 뒤 다른 계열 모델의 재판정, 리뷰어·담당자 지정 점검, 병합 대기열에서 빠진 사유의 분류, `repo` 기본값을 현재 디렉터리의 원격에서 읽는 일.
