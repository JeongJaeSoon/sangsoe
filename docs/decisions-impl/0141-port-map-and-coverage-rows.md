# 141. 이관 표(`port-map.md`)와 요구 집계(`requirements-coverage.md`)의 행 꼴과 시험

split §10 의 표를 `docs/port-map.md` 로, port-plan 3.5 의 R-01–R-23 과 1절 D-1–D-13 을 `docs/requirements-coverage.md` 로 옮기며 정한 것이다.

- **이관 표의 행.** `| 옛 항목 | sangsoe 위치 | 남긴 것 / 버린 것 · 근거 |`. 옛 항목 칸은 agent-skills 저장소 뿌리에서 본 경로를 백틱으로 적는다(`` `skills/brief` ``, `` `hooks/guard.py` ``). 한 행에 여러 항목을 적어도 된다(시험 파일은 그 대상의 행에). 위치 칸은 셋 중 하나다: 저장소 안에 있는 경로(백틱), 아직 머지되지 않은 단위의 `PR #N`, 또는 `DROP` 과 그 이유.
- **완전성 시험.** 옛 저장소의 `skills/`·`hooks/`·`agents/`·`scripts/`·`bin/` 아래 최상위 항목과 저장소 뿌리 항목 목록을 `test/fixtures/migrate/agent-skills-entries.txt` 로 저장소에 둔다(CI 는 옛 저장소를 읽지 못한다). `test/migrate/port-map.test.ts` 가 목록의 모든 줄이 표에 백틱으로 있는지, 위치 칸의 경로가 이 저장소에 있는지, `DROP` 행에 이유가 있는지 본다. 옛 저장소가 항목을 더하면 목록을 다시 뽑는다(만드는 명령은 목록 머리에 적었다).
- **요구 집계의 행.** `| R-NN | 요구 | 시험 파일 | 상태 |`. 상태는 🟢(그 시험이 main 에 있다)·🔴(없다)·`PR #N`(올라온 단위가 가져온다). 같은 시험이 🟢 행의 파일이 실제로 있는지와 R 23행·D 13행이 다 있는지 센다. 🔴 를 숨기지 않는다: 개수는 문서 머리에 적고 시험이 그 수를 다시 센다.
- **D-1 의 위치.** port-plan 1절은 일반 스킬 14개를 별도 저장소로 보냈지만 결정 95 가 plugin 안 `claude-plugin/skills/general/` 로 바꿨다. 표는 결정 95 를 따른다(전환 조건 M2 가 같은 것을 요구한다).
