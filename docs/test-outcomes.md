# 첫 빌드 시험 결과 (T1–T6 · P5–P13)

행 하나가 시험 하나다. 각 단위는 자기 행만 채운다. 대체를 적용하면 결정 파일 하나를 더하고 마지막 칸에 번호를 적는다. 판정은 통과 · 실패 · 미실행(이유) 셋이다. 환경: Orca 1.4.250, macOS, plugin 키 `local.sangsoe`(개발 폴더).

| 시험 | 주인 | 날짜 | 명령 | 출력 발췌 | 판정 | 적용한 대체 |
|---|---|---|---|---|---|---|
| T0 매니페스트 | U3 | 2026-11-10 | `orca plugin validate orca-plugin --json` · `orca plugin inspect orca-plugin --json` | `"valid": true`, `pluginKey: local.sangsoe`, `execution: trusted-worker`, 능력 `workspace:read`·`agent:read`; `git archive` 사본과 작업 트리의 `contentHash` 가 같음 | 통과 | 없음 |
| T1 | U3 | 대기 | 대기 | 대기 | 대기 | 대기 |
| T2 | U3(1차) · U15 | 대기 | 대기 | 대기 | 대기 | 대기 |
| T3 | U3(1차) · U19 | 대기 | 대기 | 대기 | 대기 | 대기 |
| T4 | U3 | 대기 | 대기 | 대기 | 대기 | 대기 |
| T5 | U10 | | | | | |
| T6 | U4(1차) · U24 | | | | | |
| P5 | U22 | | | | | |
| P6 | U18 | | | | | |
| P7 | U20 | | | | | |
| P8 | U15 | | | | | |
| P9 | U13 | | | | | |
| P10 | U15 | | | | | |
| P11 | U15 | | | | | |
| P12 | U13 | | | | | |
| P13 | U13 | | | | | |
