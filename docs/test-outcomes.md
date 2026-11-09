# 첫 빌드 시험 결과

행 하나 = 시험 하나. 각 단위는 자기 행만 채운다.

| 시험 | 주인 | 결과 | 적용한 대체 | 근거 |
|---|---|---|---|---|
| T6 | U4(1차) · U24(최종) | 경로 마켓플레이스: `claude plugin marketplace add <트리> --scope user` → `claude plugin install sangsoe@sangsoe --scope user` 성공(Claude Code 2.1.319). `claude plugin list --json` 에 `version`·`readFromFolder`·`folderVersion` 칸이 있다. 등록은 `CLAUDE_CONFIG_DIR` 마다 따로다. `brew upgrade` 뒤 갱신: 미확인(두 번째 rc 가 있어야 한다, U24). hook PATH 의 `sangsoe`: 미확인(hook 이 아직 없다). dev load 한 Orca plugin 의 재시작 뒤 유지·키: 미확인(이 빌드에 Orca plugin 이 없다, `sangsoe install` 이 건너뛴다). | 없음(결정 108) | `sangsoe install`·`doctor`·`uninstall` 실행 출력, 결정 108 |
