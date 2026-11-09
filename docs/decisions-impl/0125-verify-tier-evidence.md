# 125. verify_tier 의 목록 키·판정 규칙과 등급별 증거 `kind`

결정 85 는 등급표와 fail closed 규칙을 정하고 목록의 값과 증거의 `kind` 이름은 남겼다. `core/verify/` 를 만들면서 아래로 정했다.

정한 것:

- **함수.** `verifyTier(diff, labels, config)` 는 순수 함수다. `diff` 는 `{path, previousPath?, patch}` 목록(못 읽었으면 null), `labels` 는 `{name, actor}` 목록(못 읽었으면 null), `config` 는 아래 키(못 읽었으면 null). 결과는 `verify_tier_set` 의 칸 `{computed, requested?, effective, accepted, reason}` 에 파일별 내역 `files` 를 더한 것이다.
- **파일 하나의 등급.** 걸리는 목록 중 높은 쪽: `protected_paths`·`ui_globs`·`v3_globs` → V3, `test_globs` → V1, `docs_globs` → V0. 어느 목록에도 없으면 V2. 이름이 바뀐 파일은 옛 경로와 새 경로 중 높은 쪽. PR 의 계산값은 파일 등급의 최댓값이고 바뀐 파일이 없으면 V0.
- **`v3_globs`.** 결정 85 의 V3 기준 가운데 `protected_paths`·화면이 아닌 것(외부 연동 클라이언트 · 의존성 manifest·lock · CI·배포·인프라 설정 · 인증·권한 · 마이그레이션)을 담는 목록 하나를 새로 두었다. 값은 설정에 있다.
- **주석만.** 파서 범위는 비어 있다: 어느 언어도 "주석만" 으로 V0 이 되지 않고 결정 85 의 "파서가 없는 언어" 규칙대로 V2 다. diff 의 줄만으로는 주석과 코드를 가를 수 없기 때문이다: 열린 블록 안에 더한 `/* x */`·`// */` 는 블록을 닫아 아래 코드를 살리고, 구분자 `/*`·`*/` 를 지우는 변경과 `* 2000;` 같은 이어진 식도 주석처럼 보이며, 여러 줄 템플릿 문자열·Python `'''`·셸 heredoc 안의 `//`·`#` 줄은 데이터다. 줄 단위 판정을 두 차례 리뷰가 모두 뚫었다. V0 을 되살리려면 head 의 파일 전체를 토큰화하는 파서가 필요하고, 그 전에는 V0 은 `docs_globs` 뿐이다(결정 85 실측 ② "범위 밖은 V2 로 올라 안전하지만 V0 적중률이 낮아진다").
- **fail closed.** diff 를 못 읽으면 V3, 설정을 못 읽거나 목록 하나라도 없거나 문자열 목록이 아니면 V3(`owners` 는 없으면 빈 목록), 라벨을 못 읽으면 실효 V3(올리는 라벨을 놓칠 수 있다).
- **`refactor` 라벨.** 테스트 파일도 V3 의 의존성·설정 파일(`v3_globs`·`protected_paths`)도 바뀌지 않았으면 소스 변경(V2)이 V1 이 된다. 하나라도 어기면 계산값을 V2 이상으로 올린다.
- **`verify-tier:N` 라벨.** 계산값 이상은 누가 달았든 받아들인다(여럿이면 가장 높은 것). 낮은 라벨은 `owners`(소문자 비교)에 든 사람이 단 것만 받고, 단 사람을 모르거나 owners 밖이면 `accepted: false` 로 무시한다. 올리는 라벨과 내리는 라벨이 함께 있으면 올리는 쪽. `protected_paths` 에 걸린 파일이 있으면 어떤 라벨로도 V3 아래로 내려가지 않는다. 라벨을 단 사람은 이슈 이벤트의 마지막 `labeled` 의 `actor` 로 읽는다.
- **등급별 증거 `kind`.** V0 은 없음(필수 CI 는 조건 ①과 `--auto` 로 GitHub 이 강제하고, 승인 뒤 재호출은 check run 전부 통과를 확인한다). V1 `test`. V2 `test`·`run`. V3 `test`·`run` 에 화면 파일이 있으면 `ui`, 그 밖의 V3 파일이 있거나 라벨·fail closed 로 V3 가 되었으면 `dev`.
- **증거 한 줄의 통과.** 행의 `subject` 가 그 PR, `head_sha` 가 머지할 head(7자 이상의 앞부분 일치), 쓴 이(`actor`)가 있고 PR 작성자(GitHub 로그인, 대소문자 무시)가 아니다. 그런 행 가운데 종류마다 마지막 줄이 `exit_code` 0 이고 `not_verified` 가 비지 않은 목록이어야 한다. 작성자가 쓴 줄은 세지 않으므로 작성자는 자기 PR 의 통과를 쓰지 못한다(R-04, #469).
- **`deploys_after`(수락 5).** `mergedItemMark({pr, deploysAfter, events})` 는 `deploys_after` 가 있는 항목에서 그 PR 의 `stage_recorded{stage: dev}` 와 마지막 `dev` 증거의 `exit_code` 0 이 둘 다 있을 때만 `done`, 아니면 `unverified`(🔍). 등급과 무관하다. 부르는 쪽은 머지 확인 뒤 항목을 닫는 pr-monitor 다.

미확인(결정 85 의 실측 셋 그대로): 라벨 이벤트 지연과 actor 읽기 권한, 실제 PR 분포에 대한 역시험. 주석 판정의 파서 범위는 "없음" 으로 정했다(위).
