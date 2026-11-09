<!-- layout: slot=② layer=실행 tokens=free -->
# orca-plugin/reaper — 실행

REAPER 라운드를 U15 의 `startRounds` 에 `Round` 하나로 싣는다(`round.ts`: 10 분 주기, 상한 5 분). 타이머를 따로 두지 않는다. monitor 라운드가 `pr_merged`·`pr_closed`·`worker_done`·`worker_dead`·`pressure_high` 를 쓰면 힌트로 한 번 앞당길 뿐이고, 판정과 지우기는 모두 코어의 `reapRound`(`core/reaper/`, 결정 144)다. 코어는 `core-link.ts` 의 `loadRunners` 로만 닿는다.
