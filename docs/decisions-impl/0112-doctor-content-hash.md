# 112. doctor 는 설치된 Orca plugin 내용을 빌드 커밋과 리뷰된 head 의 트리와 비교한다

결정 105 의 남는 틈(승인이 경로에 묶여 내용·버전이 바뀌어도 Orca 가 다시 묻지 않는다, T4)을 doctor 가 되풀이 비교로 드러낸다.

- **"승인된 내용"이 무엇인가.** `sangsoe plugin approve` 가 켜기 전에 확인하는 바이트와 같다: 설치된 `orca-plugin/` 의 `contentHash` 가 (1) 빌드 커밋 트리와 (2) 그 커밋을 main 으로 머지한 PR 하나의 리뷰된 head 트리, 둘 다의 `orca-plugin/` `contentHash` 와 같아야 한다. 트리는 `gh api …/tarball/<commit>` 으로 받아 같은 `orca plugin inspect` 로 잰다. 승인 시점의 해시를 sangsoe 쪽에 따로 저장하지 않는다: U1 의 저장소가 아직 없고, 커밋에서 다시 잴 수 있는 값을 한 번 더 두는 것은 이중 저장이다.
- **빌드 커밋.** 트리 뿌리가 `orca-plugin/orca-plugin.json` 을 추적하는 git checkout 이면 더러워도 HEAD 다(`approve` 의 `resolveCommit` 은 더러우면 커밋이 없다고 하지만, doctor 에게는 그 편집이 바로 보고할 차이다). 뿌리에서 읽으므로 폴더를 통째로 지워도 커밋이 나온다. 아니면 옆의 `build-info.json`. 리뷰된 head 는 `approve` 처럼 그 커밋이 main 위에 있을 때만 찾는다(`compare/<커밋>...main` 이 `ahead`·`identical`).
- **심각도.** 어느 쪽과든 다르면 `fail` + `sangsoe plugin approve`. 설치 폴더를 inspect 할 수 없는데 빌드 트리에는 plugin 이 있으면 `fail` + `brew reinstall sangsoe`. 잴 수 없으면(커밋을 모름, 머지한 PR 이 하나가 아님, 내려받기·inspect 실패) `warn` — 통과로도 실패로도 치지 않는다. doctor 는 `orca plugin enable` 을 부르지 않는다(결정 77).
- **언제 도는가.** `sangsoe doctor`·`install` 에서는 늘 돈다. 이 doctor 를 싣는 릴리스는 늘 `orca-plugin/` 을 싣기 때문에, 매니페스트나 폴더가 없는 것은 "plugin 이 없다"가 아니라 차이다.
- **왜 포트인가.** 트리는 내려받기다. `CheckContext.pluginBuild`(`buildCommit`·`reviewedHead`·`fetchTree`)로 들여와 시험은 가짜를, `sangsoe doctor` 는 git·`gh api` 를 쓴다. 점검이 순서를 쥐어, 빌드 커밋과 다르면 PR 을 찾기 전에 `fail` 이다. 내려받기는 `approve` 와 같은 tarball·신뢰 기준이지만 120초 제한을 두어, 멈춘 `gh` 가 doctor 를 붙잡지 않는다(`approve` 의 포트는 이 단위의 범위 밖이라 고치지 않았다).
- **왜 doctor 만인가.** 시작마다 tarball 을 받으면 SessionStart 가 느려지고 오프라인에서 깨진다. 그래서 `START_CHECKS` 에는 넣지 않고 `DOCTOR_CHECKS = [...START_CHECKS, orcaPluginContent]` 로 doctor·install 만 돌린다. 다시 볼 때: U1 의 `plugin_approved` 가 승인한 `contentHash` 를 싣게 되면 시작 점검이 로컬 `inspect` 하나로 같은 비교를 할 수 있다.

같은 단위에서 정한 것: doctor 의 Claude Code plugin 행은 시작 점검 `claude-plugin-version` 하나로 합쳤다(설치 doctor 의 `claude plugin` 행을 지움). 그 결과 "마켓플레이스는 있는데 plugin 이 없다"는 doctor 에서 `FAIL` 이 아니라 `warn` 이다. 마켓플레이스가 없으면 그 행이 여전히 `FAIL` 이고, `sangsoe install` 은 자기 `claude plugin install` 단계가 실패하면 그 자리에서 종료 코드 1 이다.
