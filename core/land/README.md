<!-- layout: slot=④ layer=실행 tokens=free -->
# core/land — land 판정 함수 · 실행

sangsoe 가 PR 을 머지하는 유일한 길이다(결정 72·81·85, 부록 `#role-cards`). 사전 확인(`--dry-run`)·실행·거부 문구가 같은 함수 하나이고(R-03), 셸에서는 `sangsoe land`, 에이전트는 MCP tool `land` 로 부른다.

- `land.ts` — `land(input, deps)`. 순서: 입력 → PR 읽기(열림·draft 아님·`--head` 와 같음) → main 동결(그 저장소의 마지막 `main_red`/`main_green`, `--main-fix` 만 통과) → 스택 순서(`stacked_on` 선행이 `pr_merged`) → 리뷰 판정(`review_verdict`, 다른 head 는 patch-id 가 같을 때만 승계) → 등급의 증거(`core/verify`) → 조건 넷(`core/gh` 의 `readMergeConditions`) → `gh pr merge --auto` 또는 GitHub 승인 뒤 머지, 아니면 `land_requested{merge_on_approval}`. 설정 `verdict_merge_repos` 에 든 저장소는 그 둘이 모두 안 될 때 `merge_on_approval` 대신 정확한 head 의 기록된 판정·초록 검사·풀린 스레드를 읽고 바로 머지한다(`--match-head-commit`, `land_requested{verdict_approved}`, 결정 158). PR 을 읽은 뒤의 거부는 모두 `land_failed{reason}` 한 줄이다(dry run 은 쓰지 않는다).
- `github.ts` — land 와 verify-tier 가 쓰는 GitHub 읽기(`core/gh` 클라이언트로, 결정 158 의 head·스레드·필수 검사 GraphQL 한 번만 `gh api graphql`), patch-id, `mergeConfirm`(GitHub 의 머지 표시 + 머지 커밋이 기본 브랜치에 포함, 둘 다 참일 때만 참; 부르는 쪽은 pr-monitor).
- `ports.ts` — 실제 의존: store, gh 클라이언트, 설정(`~/.config/sangsoe/config.json`), 그리고 GitHub 에 쓰는 두 호출: 머지 예약 `ghMerge`(결정 0124)와 바로 머지 `ghMergeNow`(결정 158).
- `tier.ts` — `sangsoe verify-tier` 의 읽기 전용 함수.

거부 사유와 설정 키는 `docs/decisions.md` 결정 124, 등급과 증거는 결정 125, 계정 하나인 저장소의 바로 머지는 결정 158.
