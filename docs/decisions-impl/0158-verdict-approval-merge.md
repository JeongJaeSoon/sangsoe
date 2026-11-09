# 158. 계정이 하나인 저장소에서는 기록된 독립 리뷰 판정이 결정 72·81 이 기다리는 승인이다(설정으로 켤 때만)

**문제.** 에이전트가 오너 계정으로 push 하는 저장소(계정이 하나)에서는 `sangsoe land` 가 머지하지 못한다. 결정 81 의 조건 ①(필수 리뷰와 필수 CI)은 `required_approving_review_count > 0` 이 있어야 참인데, 그런 규칙을 걸면 작성자 말고는 GitHub 의 `APPROVED` 리뷰를 줄 계정이 없다. 걸지 않으면 조건 ① 이 거짓이라 land 는 늘 `merge_on_approval` 이고, 결정 72·81 의 "승인되면 리드가 같은 land 를 다시 불러 머지한다"의 승인은 영영 오지 않는다.

**규칙.** 설정 키 `verdict_merge_repos`(`~/.config/sangsoe/config.json`, `owner/name` 의 배열)에 든 저장소에서만, land 는 조건 넷이 거짓이고 GitHub 승인도 없을 때 아래를 모두 읽고, 모두 참이면 예약 없이 바로 머지한다(`gh pr merge <N> --repo <r> --<method> --match-head-commit <head>`, `--auto` 없음). `land_requested` 의 사유는 `verdict_approved` 이다. 키가 없거나 읽을 수 없거나 배열이 아니면 꺼진 것이고, 그때 land 는 오늘과 같다(결정 81 의 기본 동작과 조건 넷의 이름·뜻은 바뀌지 않는다).

| 입력 | 읽는 곳 | 머지하지 않는 경우 |
|---|---|---|
| 리뷰 판정 | 저장소의 `review_verdict` 행(결정 111) | 현재 head 에 정확히 맞는 행이 없다(patch-id 상속은 이 길에서 세지 않는다) → `land_failed{verdict_not_at_head}` · 셀 수 있는 행이 없다 → `verdict_unaccepted` |
| 판정의 출처 | 같은 행의 `source`·`actor`·`payload.reviewer`·`payload.author`·`act_on` | `source` 가 `review record` 가 아니다 · `actor` ≠ `reviewer` · `author` ≠ GitHub 이 지금 말하는 작성자 · `reviewer` = 작성자 · `act_on` ≠ 0 |
| 등급 | 결정 85 의 `verify_tier` | V3 → `merge_on_approval`(오너 몫, 오늘과 같다) |
| 보호 경로 | 조건 ④ `no_protected_paths` | 거짓 → `merge_on_approval` |
| 증거 | 결정 85 의 증거 점검(조건 넷 앞, 그대로) | `evidence_missing` |
| 머지 가능 상태 | REST `pulls/<N>` 의 `mergeable_state` | `clean`·`has_hooks` 가 아니다(계산 중인 `unknown` 포함) → `not_mergeable:<state>` |
| head·리뷰 스레드·검사 | GraphQL 한 번: `headRefOid`, `reviewThreads`, 마지막 커밋의 `statusCheckRollup.contexts` 와 각 `isRequired` | 읽지 못함·다음 쪽이 있음·모르는 종류 → `gate_unreadable` · head 가 다르다 → `head_moved` · 풀리지 않은 스레드 → `threads_unresolved:<n>` · 검사가 없다 → `checks_missing` · 빨강 → `checks_red:<name>` · 진행 중 → `checks_pending:<name>` |
| 머지 방식 | REST `repos/<r>` 의 `allow_squash_merge`·`allow_merge_commit`·`allow_rebase_merge` | 읽지 못함·허용된 것이 없다 → `merge_method_unreadable`. squash, merge, rebase 순으로 처음 허용된 것 |

**어느 출처가 승인으로 세는가.** `review_verdict` 에는 출처 칸이 없다. 그래서 행이 이미 가진 칸으로 정한다: 계약이 허용하는 유일한 작성자 `sangsoe review record`(`source`)가 썼고, 기록자(`actor`)가 판정의 리뷰어와 같고, 판정이 지금의 작성자에 대한 것이며, 리뷰어가 작성자가 아니다. 이 중 하나라도 읽지 못하거나 맞지 않으면 세지 않는다.

**필수 검사와 403.** 이 저장소의 `GH_TOKEN` 으로 `branches/<b>/protection` 은 403(Administration 권한 없음)이다. 결정 81 이 정한 대로 읽지 못한 설정은 조건 거짓으로 남긴다. 이 길은 저장소 설정 대신 GraphQL 의 `isRequired(pullRequestNumber:)` 를 읽는다. 관리 권한 없이 읽히고, 룰셋과 고전 보호를 모두 반영한다. GitHub 이 필수 검사를 하나라도 말하면 그 전부가 초록이어야 하고, 하나도 말하지 않으면(룰셋 `[]` 인 저장소) head 의 모든 검사를 필수로 읽는다: 하나 이상 있어야 하고 모두 끝나서 `SUCCESS`·`NEUTRAL`·`SKIPPED` 여야 한다. 필수가 없다는 것을 "아무것도 안 봐도 된다"로 읽지 않는다.

**왜 `--auto` 가 아니라 바로 머지인가.** 이 길이 열리는 저장소는 바로 필수 리뷰·필수 CI 가 없는 저장소다. 그런 곳에서 `--auto` 는 GitHub 이 기다릴 필수 조건이 없어 검사를 기다려 주지 않고, PR 이 이미 `clean` 이면 "clean status" 로 거부된다. 판단은 land 가 이미 위 표로 끝냈으므로, 머지는 그 판단을 한 head 에 고정한 즉시 머지(`--match-head-commit`)여야 한다. 사이에 push 가 오면 GitHub 이 거부하고 `merge_refused` 가 된다. 머지 방식 플래그는 빠뜨릴 수 없다: 없으면 `gh pr merge` 가 터미널에서 묻고 아닐 때는 실패한다.

**실패가 `land_failed` 인 것과 `merge_on_approval` 인 것.** V3 와 보호 경로는 결정 81·85 가 오너에게 둔 것이라 오늘의 길(`merge_on_approval`, 승인되면 리드가 머지)로 돌려보낸다. 나머지(판정·검사·스레드·head·읽기 실패)는 고치거나 기다리면 풀리는 것이라 사유가 붙은 `land_failed` 로 돌려준다. 부르는 쪽이 사유를 보고 다시 부른다.

**믿는 경계.** 이 키를 켜면 로컬에서 `sangsoe review record` 를 부를 수 있는 쪽은, CI 가 초록인 PR 을 머지시킬 수 있다. 리뷰어 이름은 부르는 쪽이 적는 값이고 sangsoe 는 그 이름 뒤의 세션을 확인하지 못한다. 이는 오케스트레이터의 판정 장부가 머지를 여는 경계와 같다. 그래서 기본값은 꺼짐이고, 저장소마다 켠다. 리뷰어 이름 허용 목록은 같은 경계를 옮길 뿐(이름은 여전히 부르는 쪽이 적는다)이라 두지 않았다.

**대체하는 것.** 없다. 결정 81 의 조건 넷과 그 기본 동작, 결정 85 의 증거 점검, 결정 111 의 기록 규칙은 그대로다. 이 결정은 결정 81 의 "승인" 자리에, 켠 저장소에 한해 기록된 판정을 하나 더 둔다. 159 는 비워 둔다.
