<!-- layout: slot=④ layer=실행 tokens=free -->
# core/reaper — REAPER 라운드

끝난 일이 남긴 카드와 기록된 Docker id 만 치우는 라운드 하나(결정 82·83·86·88, 구현 결정 144·145). plugin worker 의 타이머 라운드(`orca-plugin/reaper/`)와 `sangsoe reap run` 이 같은 `reapRound` 를 부른다.

- `round.ts` — 편입 → 루트 읽기(열린 Task 포함, 결정 194) → 표시 → `reap_candidate` → 대상 → 삭제 전 검사 → `worktree rm --run-hooks --delete-branch` → Docker → `reap_round`. 루트 하나라도 못 읽으면 후보 기록도 정리도 없다. 설정에 `reaper` 칸이 없어도 후보 기록과 정리가 없지만, 그 라운드는 루트 실패가 아니라 `mark_only` 로 남는다(결정 174). `append` 가 없으면(dry run) 지우지 않는다.
- `finished.ts` — 끝남 판정(d119): PR 상태와 HEAD 포함을 GitHub 에 묻고, PR 이 없으면 Dispatch 가 끝났는지 본다. 조용함은 보지 않는다.
- `checks.ts` — 삭제 전 검사(결정 194): 열린 Task·살아 있는 세션(`worker-show` → `task-list --run`, 루트도 같은 함수), worktree 안에 남은 증거 파일, 추적 안 된 파일까지 미커밋, GitHub 에 없는 HEAD.
- `live.ts` — 삭제 전 검사 중 살아 있는 것: Orca `ports` 가 그 worktree 에 묶은 listener, 그 worktree 의 설정 파일로 도는 compose stack(`docker compose ls`). 걸리면 `reap_blocked` 만 쓰고 죽이거나 `down` 하지 않는다. `docker` 명령이 없을 때(spawn ENOENT)만 compose 검사를 건너뛰고, 설치된 Docker 가 답하지 않으면(데몬 없음·context 오류·시간 초과) `docker_unreachable` 로 막는다(결정 201).
- `docker.ts` — `docker version` 한 번으로 Docker 상태(`up`·`absent`·`unanswered`)를 읽는다. 기록된 id 를 정지한 컨테이너 → 볼륨 → 네트워크 → 이미지 순으로 하나씩. `-f`·`prune`·라벨 선택 없음.
- `record.ts` — `resource_record`(MCP)·`sangsoe resource record`(CLI)의 몸체: 만든 쪽이 Docker id 를 소유자와 함께 남긴다. compose 프로젝트는 그 이름으로 Compose 에 물어 id 를 모은다.
- `config.ts` — `~/.config/sangsoe/config.json` 의 `reaper`(`protect` · `grace_minutes` · `min_gap_minutes`). 칸이 없거나 읽을 수 없으면 라운드는 표시만 하고 `mark_only` 로 남는다(루트 실패가 아니다, 결정 174).
- `open.ts` — 실제 의존(Orca 어댑터 · `gh` · store)을 묶은 실행기.

터미널은 닫지 않는다: 이 폴더에는 `worker-release`·`terminal` 을 부르는 코드가 없다. 새 worktree 에서 연 세션은 Orca 가 자동으로 해제하지 않으므로 시작한 쪽이 `worker-release` 로 푼다: 워커는 시작한 리드·오케스트레이터가, `--keep-open` 으로 띄운 리드는 그 리드의 `worker_done` 뒤 오케스트레이터가(결정 193 ⑥, 197).
