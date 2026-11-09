# 145. REAPER 가 Orca 에서 더 읽는 칸, 라운드의 `trigger`, P6 결과

**카드를 이름 짓는 칸.** `worktree list` 행의 `id` 는 `<repoId>::<경로>` 라 경로를 품는다. 계약은 worktree 의 `ref` 에 경로를 받지 않으므로(`refOrcaIdForWorktree`) sqlite 에는 행의 `instanceId`(경로 없는 uuid)를 쓴다. 지울 때는 그 라운드에 다시 읽은 행의 `id` 로 `--worktree id:<id>` 를 부른다. `instanceId` 가 없는 행은 "모름"이다. `WorktreeRow` 에 Orca 가 이미 보내는 `instanceId`·`projectId`(`github:<owner>/<repo>`, 끝남 판정이 물을 저장소)·`head`(카드의 HEAD)를 적었다. 저장하는 것은 `instanceId` 하나이고 나머지는 라운드마다 읽는다(결정 74).

**비로컬 행의 이름.** 어댑터의 호스트 필터는 비로컬 행을 개수와 호스트 이름만 남기고 버렸다. 결정 88 ① 은 카드마다 한 번 `reap_blocked{remote_host}` 를 키 = 그 카드로 쓰라고 하므로, `keepLocal` 이 읽는 쪽이 원할 때만 비로컬 행의 id 를 `nonLocal.ids` 로 넘긴다(`worktree list` 만, `instanceId`). 행 자체는 여전히 어댑터를 나오지 않는다. id 가 없는 비로컬 행은 `unknown` 에만 센다.

**라운드의 `trigger`.** `startRounds` 가 `run(at, signal, trigger)` 로 그 라운드가 타이머인지 힌트인지 넘긴다. `reap_round.trigger` 가 이 값이고, 멈춤 판정은 `trigger = timer` 인 마지막 라운드만 보므로(결정 83) 힌트 라운드가 타이머 멈춤을 가리지 못한다. 셸에서 손으로 돌린 라운드(`sangsoe reap run`)는 `hint` 다. 기존 monitor 라운드는 셋째 인자를 쓰지 않는다.

**P6 결과(이 Mac, Orca 1.4.250).** 버리는 worktree 를 `orca worktree create --setup skip --parent-worktree current` 로 만들어 두 번 지웠다.

- 추적 안 된 파일 하나가 있을 때 `rm --run-hooks --delete-branch`(`--force` 없음): `ok: false`, `code: runtime_error`, 메시지에 `git status` 의 `?? <파일>` 줄. Orca 는 더러운 worktree 를 지우지 않는다. 다만 오류 코드가 따로 없어 REAPER 는 이것을 사유로 읽지 않고, 자기 검사(`uncommitted`)가 먼저 막는다.
- 깨끗하고 푸시 안 한 커밋 하나가 있을 때 같은 명령: `ok: true`, `removed: true`, `preservedBranch: {branchName, head}`. **Orca 는 미푸시 커밋이 있어도 worktree 를 지운다**(브랜치는 병합을 증명 못 해 남긴다). 그래서 결정 82 R4 의 `unpushed` 검사는 REAPER 가 반드시 앞에서 해야 하고, 결정 86 ① 은 취소하지 않는다(훅을 거는 길은 그대로 쓴다). 브랜치 삭제 증거는 결과의 `preservedBranch` 로 읽힌다: 있으면 지우지 않은 것이다.
- 미실행: archive hook 이 도는 디렉터리·시간 제한·`orca.yaml` 키 이름·`worktree_archive_hook_failed` 의 실제 출력. 이 저장소에 `orca.yaml` 이 없고, 키 이름을 모르는 채 훅을 만들어 넣는 것은 측정이 아니다. 훅 실패 경로는 도움말의 오류 코드로 가짜 Orca 시험(`reap_archive_hook_failed`)만 했다.
