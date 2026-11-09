# 153. REAPER 가 표시만 하는 상태는 doctor 의 `notice` 행으로 알린다: `sangsoe install` 은 `reaper` 칸을 쓰지 않는다

결정 144 는 `~/.config/sangsoe/config.json` 에 `reaper` 칸이 없으면 보호 목록 루트를 못 읽은 것으로 쳐서 REAPER 가 표시만 하게 했다(닫힌 쪽). README 대로 설치한 오너는 그 사실을 볼 곳이 없어, REAPER 가 조용히 정리하지 않는다.

- **고른 것.** `DOCTOR_CHECKS` 끝에 `reaper-config` 행(`core/checks/reaper-config.ts`)을 둔다. 칸이 없거나 읽을 수 없으면 `notice` — 요약은 "표시만 하고 정리하지 않는다", 고칠 것은 `"reaper": {"protect": []}` 를 그 파일에 더하라는 한 줄이다. 칸이 있으면 `ok` 와 보호 개수·유예. `notice` 라 종료 코드는 0 이다. 읽기는 REAPER 와 같은 `readReaperConfig` 라 두 곳이 다르게 판정하지 않는다. 시작 점검(`START_CHECKS`)에는 넣지 않는다: 설정하지 않기로 한 오너에게 세션마다 같은 줄이 뜬다. README Install 에 REAPER 단락(무엇을 지우는지, 더할 JSON, 그 뒤의 doctor 줄)을 둔다.
- **버린 것.** `sangsoe install` 이 칸이 없을 때 결정 144 의 기본값(`protect: []`, 유예 30 분, 최소 간격 10 분)을 쓰는 안. 결정 144 가 버린 "없으면 빈 목록"과 결과가 같다: 설치 직후의 라운드부터 끝난 카드의 worktree 와 브랜치를 지운다. 지우는 일을 켜는 것은 오너의 동의여야 하는데, 설치가 그 동의를 대신하게 된다. doctor 행은 닫힌 쪽을 그대로 두고 보이게만 한다.
- **시험.** `core/checks/reaper-config.test.ts`: 파일 없음·`{}`·`reaper: {}`·깨진 JSON 은 모두 `notice` 이고 고칠 것에 JSON 과 경로가 있다. 칸이 있으면 `ok`. 이 행은 `DOCTOR_CHECKS` 에만 있다.

다시 볼 조건: REAPER 의 정리를 켜는 CLI 입구(`sangsoe reap enable` 같은 것)가 생기면 고칠 것을 그 명령으로 바꾼다.
