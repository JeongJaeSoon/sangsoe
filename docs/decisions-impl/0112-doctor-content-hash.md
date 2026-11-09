# 112. doctor 는 설치된 Orca plugin 내용을 빌드 커밋 트리와 비교한다

결정 105 의 남는 틈(승인이 경로에 묶여 내용·버전이 바뀌어도 Orca 가 다시 묻지 않는다, T4)을 doctor 가 되풀이 비교로 드러낸다.

- **"승인된 내용"이 무엇인가.** 설치된 `orca-plugin/` 의 빌드 커밋(`resolveCommit`: 깨끗한 git checkout 의 HEAD, 아니면 옆의 `build-info.json`) 트리를 `gh api …/tarball/<commit>` 으로 받아 같은 `orca plugin inspect` 로 잰 `contentHash` 다. `sangsoe plugin approve` 가 켜기 전에 비교하는 바로 그 바이트다. 승인 시점의 해시를 sangsoe 쪽에 따로 저장하지 않는다: U1 의 저장소가 아직 없고, 커밋에서 다시 잴 수 있는 값을 한 번 더 두는 것은 이중 저장이다.
- **심각도.** 다르면 `fail` + `sangsoe plugin approve`(리뷰 안 된 바이트가 돌고 있다). 잴 수 없으면(커밋을 모름, 내려받기·inspect 실패) `warn` — 통과로도 실패로도 치지 않는다. doctor 는 `orca plugin enable` 을 부르지 않는다(결정 77).
- **왜 포트인가.** 빌드 트리는 내려받기다. `CheckContext.pluginBuild` 로 들여와 시험은 가짜를, `sangsoe doctor` 는 `core/approve/ports.ts` 의 `resolveCommit`·`fetchPluginTree` 를 쓴다.
- **왜 doctor 만인가.** 시작마다 네트워크로 tarball 을 받으면 SessionStart 가 느려지고 오프라인에서 깨진다. 그래서 `START_CHECKS` 에는 넣지 않고 `DOCTOR_CHECKS = [...START_CHECKS, orcaPluginContent]` 로 doctor·install 만 돌린다. 다시 볼 때: U1 의 `plugin_approved` 가 승인한 `contentHash` 를 싣게 되면 시작 점검이 로컬 `inspect` 하나로 같은 비교를 할 수 있다.

같은 단위에서 정한 것: doctor 의 Claude Code plugin 행은 시작 점검 `claude-plugin-version` 하나로 합쳤다(설치 doctor 의 `claude plugin` 행을 지움). 그 결과 "마켓플레이스는 있는데 plugin 이 없다"는 doctor 에서 `FAIL` 이 아니라 `warn` 이다. 마켓플레이스가 없으면 그 행이 여전히 `FAIL` 이고, `sangsoe install` 은 자기 `claude plugin install` 단계가 실패하면 그 자리에서 종료 코드 1 이다.
