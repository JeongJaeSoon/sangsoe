# 144. REAPER 라운드: 표시 → 정리, 관문마다 닫힌 쪽으로

결정 82·83·86·88 을 코드로 옮긴 꼴이다. 라운드 하나가 판정 전부를 한다(`core/reaper/round.ts` 의 `reapRound`). 이벤트·압박은 그 라운드를 앞당기는 힌트일 뿐이다.

**상태 기계.** 자원 하나(카드 또는 기록된 Docker id)는 이 순서로만 지나간다.

1. **편입**(`resource_adopted{kind: worktree, ref, basis: "card list"}`): 로컬이고 메인 체크아웃이 아닌 카드 가운데 `resource`·`resource_adopted` 기록이 없는 것. 편입은 지우는 것이 아니다. Docker 는 만든 쪽이 `resource_record` 로 남긴 `resource{created}` 만 대상이고, 기록 없는 Docker 는 resource-monitor 의 `resource_leak` 으로 알리기만 한다(REAPER 는 건드리지 않는다).
2. **표시**: 루트에서 닿는 카드. 닿지 않으면 **후보**다. 기록된 Docker id 는 주인 카드(`owner` 가 worktree 의 instance id 이거나, 그 카드에서 돈 Dispatch 의 Task id)를 따른다.
3. **후보 기록**(`reap_candidate`): 후보를 처음 보면 `seen`(그 라운드 번호), `seen` 이던 것이 다시 표시되면 `cleared`. `dedupe_key` 는 `reap_candidate:<kind>:<ref>:<round>` 라 같은 자원이 여러 번 `seen` 이 될 수 있다.
4. **대상**: 넷을 모두 만족할 때만. (가) 지금 후보 (나) 마지막 `seen` 이 이번보다 앞선 라운드이고 그 사이 `cleared` 도 `roots_ok=false` 라운드도 없음(두 라운드 연속) (다) `seen` 의 시각에서 유예(`grace_minutes`, 기본 30 분)가 지남. 압박(`judgeLoad` 가 `ok` 가 아님)은 유예를 라운드 최소 간격(`min_gap_minutes`, 기본 10 분)까지만 줄인다 (라) 끝남 판정이 긍정.
5. **삭제 전 검사**(결정 82 R4) → **`worktree rm --run-hooks --delete-branch`** → **Docker**.

**끝남 판정(d119).** 카드의 브랜치로 GitHub 에 PR 을 묻는다(`pulls?head=<owner>:<branch>&state=all`). PR 이 있으면 그 상태가 우선한다: 열려 있으면 끝나지 않음, 머지되었거나 닫혔으면 카드 HEAD 가 PR 의 head 와 같거나 GitHub 의 비교(`compare/<pr head>...<card HEAD>`)가 `identical`·`behind` 일 때만 끝남("PR 이 HEAD 를 실었다"). PR 이 없으면 그 카드에서 돈 Dispatch 가 하나 이상 있고 모두 끝났으며(`settled`) 마지막 것이 `succeeded`·`cancelled` 일 때 끝남. 그 밖(저장소를 모름, 브랜치 없음(detached HEAD: GitHub 은 브랜치 없는 head 필터를 버리고 저장소의 최근 PR 을 준다), GitHub 이 답하지 않음, Dispatch 없음)은 "모름"이고 대상이 아니다. 돌아온 PR 도 head 브랜치가 카드의 브랜치와 같은 것만 본다. 조용함은 보지 않는다.

**루트(읽기만, 저장하지 않음).** 하나라도 못 읽으면 `roots_ok=false` 이고 그 라운드는 후보 기록도 정리도 하지 않는다.

| 루트 | 읽는 곳 | 표시하는 것 |
|---|---|---|
| 카드 목록 | `worktree list` | 목록 자체. 잘렸으면 실패 |
| 닫히지 않은 Task · 살아 있는 워커 | `worker-list`(다음 쪽까지, 30 쪽 상한. 넘으면 실패) | 끝나지 않은 Dispatch 의 워크스페이스 |
| 살아 있는 세션 | `worktree ps` | 살아 있는 터미널이 있는 카드. 확인 못 한 터미널이 있으면 그 카드는 "모름" |
| 열린 PR | `gh api repos/<o>/<r>/pulls?state=open`(아직 표시 안 된 카드의 저장소만, 다음 쪽까지) | 브랜치가 열린 PR 의 head 인 카드 |
| 보호 목록 | `~/.config/sangsoe/config.json` 의 `reaper.protect`(instance id · 경로 · 브랜치) | 거기 적힌 카드. **파일이나 `reaper` 칸이 없으면 이 루트를 못 읽은 것**이다 |
| 메인 체크아웃 | `worktree list` 행의 `isMainWorktree`(`false` 라고 답한 행만 메인이 아니다) | 후보도 대상도 편입도 아니다 |

보호 목록이 없으면 루트 실패로 치는 것은 고른 것이다. 이 Mac 에는 설정 파일이 없으므로 REAPER 는 오너가 `reaper` 칸을 만들기 전까지 표시만 한다(정리는 설정으로 켜는 셈). 대안은 "없으면 빈 목록"이었으나, 그러면 설치 직후 첫 라운드부터 지우게 된다. 되돌리려면 `readReaperConfig` 가 빈 목록을 주게 바꾸면 된다.

**삭제 전 검사.** 대상 카드의 경로에서 (가) `git status --porcelain --untracked-files=all` 이 비어 있지 않으면 `reap_blocked{uncommitted}`(무시된 파일은 git 이 이미 뺀다). (나) 끝남이 "PR 이 HEAD 를 실었다"이면 통과(스쿼시 머지 뒤 HEAD 는 원격 기본 브랜치에 없다). 아니면 GitHub 에 HEAD 커밋을 묻는다(`commits/<HEAD>`): 있으면 통과, 404·422 이면 푸시된 적 없음 → PR 의 head 커밋과 메시지만 같으면 `reap_blocked{unpushed_other_patch}`, 아니면 `reap_blocked{unpushed}`. 낡은 로컬 기본 브랜치는 보지 않는다. git·GitHub 이 답하지 않으면 지우지 않고 "모름"으로 센다.

**지우기.** `orca worktree rm --worktree id:<행 id> --run-hooks --delete-branch`. `--force`·`--allow-failed-archive-hook` 은 어댑터에 없다. 오류 코드 `worktree_archive_hook_failed` 면 `reap_blocked{archive_hook_failed}`, 그 밖의 오류는 지우지 않은 "모름". 성공이면 `reap_done{worktree}` 하나. 브랜치를 지웠다고는 쓰지 않는다(Orca 의 결과에 브랜치 증거가 없으면 지운 것이 아니다).

**Docker(결정 82 R6).** 주인 카드의 `reap_done` 이 있는(이번 라운드든 앞 라운드든) 기록된 id 만, 정지한 컨테이너 → 볼륨 → 네트워크 → 이미지 순으로 하나씩. `docker version` 이 서버를 답하지 않으면 건너뛰고 `docker_skipped=true`. `inspect` 로 없는 id 는 REAPER 가 `resource{released}`(source `reaper`)로 기록을 닫는다. 도는 컨테이너와 `rm` 이 거부된 id(쓰는 중, 다른 이미지의 base)는 `reap_blocked{in_use}` 로 사람에게 넘기고, 그것도 기록을 닫는다. 그래서 어떤 id 도 두 번 시도하지 않는다: 같은 이름이 나중에 다른 카드의 것이 되어도 앞 주인의 기록으로 지우지 않는다. `-f`·`prune`·`down -v`·라벨이나 이름으로 고르기는 없다.

**기록의 주인.** 한 Docker 이름의 기록은 seq 순으로 접는다: `created` 가 잡고, `released`·`reap_done`·`reap_blocked{in_use}` 가 놓는다. 다른 주인이 잡고 있는 이름의 `created` 는 `resource_record` 가 `held_by_other` 로 거부한다(조용히 합치면 앞 주인의 정리가 뒤 주인의 것을 지운다). `dedupe_key` 에 놓인 횟수(`g<n>`)를 넣어, 놓인 이름을 다시 기록하면 새 행이 된다.

**터미널은 닫지 않는다.** REAPER 는 `worker-release`·`terminal` 을 부르지 않는다(Orca 의 자동 해제와 리드의 몫, 결정 74 O-12).

**비로컬 카드(결정 88 ①).** `hostId` 가 `local` 이 아닌 행은 카드마다 한 번 `reap_blocked{remote_host}`(`reap_blocked:worktree:<instance id>:remote_host`, 두 번째 라운드부터는 같은 줄)이고 `unknown` 에 센다.

**쓰기 없이는 정리 없음.** `append` 가 없는 실행(`--dry-run`)과 `--mark-only` 는 표시만 하고 쓸 줄을 보고한다. 지우는 일은 기록을 남길 수 있을 때만 한다.

**라운드 끝.** `reap_round{trigger, roots_ok, round, cards, marked, candidates, reaped, unknown, docker_skipped}`, 키 `reap_round:<round>`. 라운드 번호는 마지막 `reap_round` 의 다음이다.

**자리.** 판정과 지우기는 코어(`core/reaper/`)이고, plugin worker 는 U15 의 `startRounds` 에 REAPER `Round` 하나를 더할 뿐이다(타이머를 따로 두지 않는다. 10 분 주기, 상한 5 분). monitor 라운드가 `pr_merged`·`pr_closed`·`worker_done`·`worker_dead`·`pressure_high` 를 쓰면 REAPER 에 힌트를 준다. 셸 입구는 `sangsoe reap run [--dry-run] [--mark-only]`.
