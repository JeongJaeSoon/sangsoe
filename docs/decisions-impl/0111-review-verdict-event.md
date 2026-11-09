# 111. 리뷰 판정은 `review_verdict` event 하나이고, 쓰는 곳은 `sangsoe review record` 하나다

`sangsoe plugin approve` 의 조건 (1)(결정 77 다)은 "main 으로 머지된 PR 의 머지된 head 를 작성자 아닌 리뷰어가 Act-on 0 으로 봤다"는 증거를 읽는다. 결정 104 까지 그 증거를 담는 event 가 없어서, `core/approve/ports.ts` 는 증거를 늘 없음으로 돌려 (1) 이 닫힌 채 실패했고 `plugin_approved` 는 표준 출력으로만 나갔다.

정한 것:

- **event.** `review_verdict{pr, head_sha, act_on, reviewer, author}`. `pr` 은 `owner/repo#N`(소문자), `head_sha` 는 40자, `act_on` 은 0 이상의 수. `reviewer` 가 `author` 와 같으면(대소문자 무시) 누가 쓰든 계약이 거부한다. `dedupe_key` 는 `review_verdict:<pr>:<head_sha>:<reviewer>` 로 닫혀 있어서, 한 리뷰어가 한 head 에 내린 첫 판정이 남는다. 다시 보려면 새 head 를 리뷰한다.
- **저장소 하나.** 판정은 sangsoe 의 sqlite 에만 있다. 다른 곳의 판정 기록(프로그램 도구의 verdict 표 등)을 읽지 않는다.
- **쓰는 곳 하나.** 코어 함수 `recordReviewVerdict` 이고, 셸에서는 `sangsoe review record --pr N --head SHA --act-on N --reviewer X [--repo owner/name]` 가 부른다. 토큰을 쓰지 않는 코드다. 계약도 `sources: ["review record"]` 라 다른 쓰는 쪽을 거부한다. `--repo` 의 기본은 approve 의 신뢰 기준 저장소다.
  - PR 작성자와 현재 head 는 호출자가 주지 않고 `gh api repos/<repo>/pulls/<N>` 로 한 번에 읽는다. 작성자가 리뷰어와 같으면 거부하고, `--head` 가 그 PR 의 현재 head 가 아니면 거부한다(낡은 head 도, 아직 push 되지 않은 head 를 미리 적는 것도 막힌다).
  - 리뷰어와 작성자는 영문·숫자·`_`·`.`·`-` 만 받고 소문자로 맞춰 비교·저장·키에 쓴다. 공백을 붙이거나 대소문자를 바꿔 작성자 검사를 피하거나 같은 리뷰어의 두 번째 판정을 만들 수 없다.
- **부르는 쪽.** 판단 층(리드·워커 프롬프트)이 독립 리뷰를 마친 뒤 부른다. 에이전트는 CLI 대신 같은 코어 함수를 MCP 로 부르고(결정 75 나), 그 프롬프트와 MCP 도구는 그것을 만드는 뒤 유닛의 일이다. 이 프로그램에서는 그 경로가 생기면 리드가 부른다.
- **믿는 경계.** 이 명령은 오너의 기계에서 도는 로컬 명령이라 `--reviewer` 이름은 호출자를 믿는다(같은 기계에서 store 를 직접 쓸 수 있는 사람은 어차피 무엇이든 쓸 수 있다). 리뷰어 이름을 실제 리뷰 세션에 묶는 일은 위 판단 층이 맡는다. 이 명령이 막는 것은 GitHub 이 아는 사실(작성자·head)을 호출자가 꾸미는 것이다.
- **읽는 쪽.** approve 는 리뷰 증거를 이 event 로만 읽는다. 그 head 에 Act-on 이 남은 판정이 하나라도 있으면 그 판정이 이긴다(깨끗한 판정이 있어도 통과하지 않는다). store 를 열지 못하면 증거가 없는 것으로 보고 (1) 은 닫힌 채 실패한다.
- **`plugin_approved`.** 결정 104 의 모양 그대로(`{key, version, fingerprint, commit, at}`, `at` 은 epoch 밀리초) `core/contract/events/plugin_approved.ts` 로 옮기고, 기록 포트는 store 에 쓴다. `core/approve/plugin-approved.ts` 는 지운다.

버린 꼴: 판정을 `evidence{kind: "review"}` 에 싣는 안. `evidence` 는 검증 결과(명령·종료 코드·관찰값)를 담는 칸이라 `reviewer`·`author`·`act_on` 이 없고, 칸을 더하면 모든 evidence 쓰기가 그 칸을 신경 써야 한다. 작성자를 `--author` 로 받는 안도 버렸다: 호출자가 작성자를 지어낼 수 있다.
