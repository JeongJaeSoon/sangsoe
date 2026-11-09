# 첫 빌드 시험 결과 (T1–T6 · P5–P13)

행 하나가 시험 하나다. 각 단위는 자기 행만 채운다. 대체를 적용하면 결정 파일 하나를 더하고 마지막 칸에 번호를 적는다. 판정은 통과 · 실패 · 미실행(이유) 셋이다. 환경: Orca 1.4.250, macOS, plugin 키 `local.sangsoe`(개발 폴더).

| 시험 | 주인 | 날짜 | 명령 | 출력 발췌 | 판정 | 적용한 대체 |
|---|---|---|---|---|---|---|
| T0 매니페스트 | U3 | 2026-11-10 | `orca plugin validate orca-plugin --json` · `orca plugin inspect orca-plugin --json` | `"valid": true`, `pluginKey: local.sangsoe`, `execution: trusted-worker`, 능력 `workspace:read`·`agent:read`; `git archive` 사본과 작업 트리의 `contentHash` 가 같음 | 통과 | 없음 |
| T1 | U3 | 2026-11-10 | 승인 뒤 `orca plugin dev request local.sangsoe probe.t1 --data '{"dbPath":"<scratch>/t1.db"}' --json` 두 번, 셸 Node 로 같은 파일 읽기 | worker: `"node": "v24.22.1"`, `"sqlite": "3.53.4"`, `"meetsFloor": true`, `"rows": 1` → 두 번째 `"rows": 2`, 셸에서 `count(*) = 2`. `"core": {"ok": true, "version": "0.0.0"}`(HEAD 114d356 의 개발 폴더에서 `../core/index.ts` 동적 import 성공. 승인·내용 해시가 폴더만 덮으므로 리뷰 뒤 이 폴더 밖 import 프로브는 지웠다). 셸 Node(mise) `v26.13.0` · SQLite `3.54.0` | 통과. Homebrew Node 는 이 Mac 에 없어 미실행(U4 의 T6 이 brew 설치 뒤 잰다). 설치본(Orca 가 폴더를 복사하는 경우)에서 `..` 밖 import 가 되는지는 미확인 → U4 는 worker 를 코어와 묶어 번들한다 | 없음 |
| T2 | U3(1차) · U15 | 2026-11-10 | `orca plugin dev request local.sangsoe probe.report --json` · `probe.exec` · `orca plugin dev emit local.sangsoe workspace.created\|workspace.removed --data '<payload>'` | 15 000 ms 라운드 23회 `gapsMs` 15000–15002, 오류 0. `gh --version` 0(79 ms), `gh api rate_limit` 0(인증된 호출, 405 ms), `orca --version` `1.4.250`(88 ms). 이벤트: `agent.status.changed` 388·`workspace.changed` 2(실제 Orca), `workspace.created` 1·`workspace.removed` 1(dev emit). worker `PATH` 에 사용자 셸 경로와 `/opt/homebrew/bin` 이 있다 | 통과(created·removed 는 dev emit 으로만 받음) | 없음 |
| T3 | U3(1차) · U19 | 2026-11-10 | `orca plugin shot local.sangsoe --panel probe --width 360` · `--status-bar` 두 번 · `orca plugin dev request local.sangsoe probe.open --json` · `orca plugin open local.sangsoe --panel probe --json` | 패널 PNG 에 인라인 SVG DAG(U0→U1·U2·U3→U15)와 `plugin.request` 로 받은 worker 보고가 그려짐, `errors: []`. 상태 표시줄 `sangsoe · 26`(neutral, 회색) → worker 재시작 뒤 `sangsoe · 1`(accent, 파랑). 명령 본문(worker 가 `orca plugin list` → `orca plugin open <key> --panel probe`)이 `"sangsoe: panel opened"`. 첫 시도는 2000자에서 자른 목록을 파싱하다 실패해 고쳤다 | 통과. 사람의 실제 클릭은 미실행: `orca computer` 가 Accessibility 권한을 요구(HUMAN ONLY). 클릭 → 명령 실행은 Orca 문서 확인 | 없음(결정 92⑤ 의 알림 대체 불필요) |
| T4 | U3 | 2026-11-10 | 승인(오케스트레이터, `orca plugin enable local.sangsoe --approve ap1-0592cf4c42d5394b9fff7e2c0fdb5f07`, HEAD 114d356, contentHash `0115129a…`) 뒤 T1·T2 요청 · `main.ts`·`probe.ts` 수정 · 매니페스트에 능력 하나 더했다 되돌림 · `version` 0.0.0→0.0.1→0.0.0, 매번 `orca plugin list --json` | 승인 뒤 sqlite·`orca`·`gh` 모두 재승인 요청 없음. 코드 수정: `running`, `needsReconsent=false`, worker 만 재시작. 능력 추가: `pending`, `needsReconsent=true`, 지문 바뀜(= `approval_stale`). 되돌리면 다시 승인 없이 `running`. `version` 올림: `running`, `needsReconsent=false` | 통과. 재승인은 능력·명령·실행 단계가 바뀔 때만이고 내용·버전 변경은 묻지 않는다 → 승인 안내는 릴리스당이 아니라 접근이 바뀔 때만(결정 105 의 남는 틈) | 없음 |
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
