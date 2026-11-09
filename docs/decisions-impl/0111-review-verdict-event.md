# 111. 리뷰 판정은 `review_verdict` event 하나이고, 쓰는 곳은 `sangsoe review record` 하나다

`sangsoe plugin approve` 의 조건 (1)(결정 77 다)은 "main 으로 머지된 PR 의 머지된 head 를 작성자 아닌 리뷰어가 Act-on 0 으로 봤다"는 증거를 읽는다. 결정 104 까지 그 증거를 담는 event 가 없어서, `core/approve/ports.ts` 는 증거를 늘 없음으로 돌려 (1) 이 닫힌 채 실패했고 `plugin_approved` 는 표준 출력으로만 나갔다.

정한 것:

- **event.** `review_verdict{pr, head_sha, act_on, reviewer, author}`. `pr` 은 `owner/repo#N`(소문자), `head_sha` 는 40자, `act_on` 은 0 이상의 수. `reviewer` 가 `author` 와 같으면(대소문자 무시) 누가 쓰든 계약이 거부한다. `dedupe_key` 는 `review_verdict:<pr>:<head_sha>:<reviewer>` 로 닫혀 있어서, 한 리뷰어가 한 head 에 내린 첫 판정이 남는다. 다시 보려면 새 head 를 리뷰한다.
- **저장소 하나.** 판정은 sangsoe 의 sqlite 에만 있다. 다른 곳의 판정 기록(프로그램 도구의 verdict 표 등)을 읽지 않는다.
- **쓰는 곳 하나.** `sangsoe review record --pr N --head SHA --act-on N --reviewer X [--repo owner/name]`. 토큰을 쓰지 않는 코드다. PR 작성자는 호출자가 주지 않고 `gh api repos/<repo>/pulls/<N>` 로 읽으며, 리뷰어와 같으면 거부한다. `--repo` 의 기본은 approve 의 신뢰 기준 저장소다.
- **부르는 쪽.** 판단 층(리드·워커 프롬프트)이 독립 리뷰를 마친 뒤 부른다. 이 프로그램에서는 그 경로가 생기면 리드가 부른다.
- **읽는 쪽.** approve 는 리뷰 증거를 이 event 로만 읽는다. 그 head 에 Act-on 이 남은 판정이 하나라도 있으면 그 판정이 이긴다(깨끗한 판정이 있어도 통과하지 않는다). store 를 열지 못하면 증거가 없는 것으로 보고 (1) 은 닫힌 채 실패한다.
- **`plugin_approved`.** 결정 104 의 모양 그대로(`{key, version, fingerprint, commit, at}`, `at` 은 epoch 밀리초) `core/contract/events/plugin_approved.ts` 로 옮기고, 기록 포트는 store 에 쓴다. `core/approve/plugin-approved.ts` 는 지운다.

버린 꼴: 판정을 `evidence{kind: "review"}` 에 싣는 안. `evidence` 는 검증 결과(명령·종료 코드·관찰값)를 담는 칸이라 `reviewer`·`author`·`act_on` 이 없고, 칸을 더하면 모든 evidence 쓰기가 그 칸을 신경 써야 한다. 작성자를 `--author` 로 받는 안도 버렸다: 호출자가 작성자를 지어낼 수 있다.
