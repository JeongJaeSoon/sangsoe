# 전환 조건 46

설계 §6 이 갈래별 개수(기반 4 · 코어 13 · 랜드 6 · 정리 8 · 감지기 5 · 패널 4 · 설치 3 · 이관 3 = 46)만 주고 목록은 구현 리드가 만든다(결정 71). 아래가 그 목록이다. 각 행의 주인 유닛이 "증거" 칸만 채운다: 시험 파일과 그 시험이 센 숫자. 비어 있는 증거 칸은 아직 충족되지 않은 조건이다. 결정 59 가 넣으라고 한 `worker_start_dispatched` 와 `one_session_two_terminals` 는 C9·D2 에 있다.

| id | 갈래 | 검증(센 숫자로 끝난다) | 주인 | 증거 |
|---|---|---|---|---|
| B1 | 기반 | CI `typecheck`·`lint`·`unit` 녹색, 시간 상한·병렬, 건너뛴 시험과 재실행 flake 수를 숨기지 않음(R-11) | U0·U5 | |
| B2 | 기반 | 시작 점검이 필요한 Orca 기능이 없으면 거부, 호환 경로 없음(R-17) | U2 | |
| B3 | 기반 | SQLite 하한 미달·네트워크 위 DB 거부 | U1 | `core/store/checks.test.ts`(통과 8 · 거부 9 버전, 네트워크 12종·모름·탐침 실패 거부), `core/store/store.test.ts` "refuses a database on a network filesystem" |
| B4 | 기반 | 공개 위생 검사가 실제로 실패할 수 있음 · 등록된 hook 경로 존재 · 실행 비트(R-01) | U5(+U12) | |
| C1 | 코어 | 상태 전환표 허용 19/19 · 거부 30/30 | U1 | `core/contract/contract.test.ts` "transition table"(49쌍 중 허용 19 · 거부 30), `core/store/store.test.ts` "append validates"(거부 쌍은 쓰이지 않음) |
| C2 | 코어 | append-only 트리거·`dedupe_key` UNIQUE·`owner_text` 지우기만 허용 | U1 | `core/store/store.test.ts`: UPDATE·DELETE 거부, 같은 키 두 번째 쓰기 → 첫 줄, `owner_text` 의 비우기 외 UPDATE·DELETE·고아 INSERT 거부 |
| C3 | 코어 | 의존 실패 회귀 12/12 | U7(+U11·U16) | |
| C4 | 코어 | 순환 거부·GRAPH 아닌 간선 쓰기 거부·한 간선 한 곳 | U7 | |
| C5 | 코어 | 결정 루프 회귀 11/11 | U8·U14(+U10·U13·U16·U17) | |
| C6 | 코어 | `notify` 받는 순서 위반 거부·정확히 한 번·`term_` 주소 거부(R-08) | U8 | |
| C7 | 코어 | 골든 (1)–(8) | U9 | |
| C8 | 코어 | 같은 시험이 MCP 와 CLI 로 같은 결과·모르는 인자 무변경(R-16) | U5 | |
| C9 | 코어 | 시작 절차: `worker_start_dispatched`·`unit_lineage_complete`·T5 | U10 | |
| C10 | 코어 | 막는 hook: 합치기 표 시험 deny>ask>allow·`raw_start_refused`·오탐/미탐 실제 명령 모음(R-09·R-10) | U12 | |
| C11 | 코어 | 역할·모델이 `session_started` 에 남고 역할 줄 없는 sangsoe 세션은 🚨(R-19) | U13 | |
| C12 | 코어 | 오너 입력만으로 상태가 바뀌는 길 0(전이표 11행) | U14 | |
| C13 | 코어 | 비로컬 행 입력 0(필터 시험) | U2 | |
| L1 | 랜드 | `verify_tier` 등급표 + fail closed 경우 전부 | U11 | `core/verify/verify-tier.test.ts`(17: 등급표 11 경로 · 두 목록 · 미분류 V2 · diff·설정·라벨 못 읽음 V3 · 주석만 V2(파서 범위 없음) · `refactor` 위반 V2 · 올리기·내리기(`owners`) · `protected_paths` V3 고정) |
| L2 | 랜드 | 증거는 head 마다, `evidence_missing` 거부, 작성자가 자기 통과를 못 씀(R-04) | U11 | `core/verify/evidence.test.ts`(5), `core/land/land.test.ts` "evidence is checked before the conditions" · "older head" · "author's own passing evidence" |
| L3 | 랜드 | 조건 넷(못 읽으면 거짓) → 예약 / `merge_on_approval` | U11 | `core/land/land.test.ts` "four conditions hold" · "a condition false" · "decision 81's re-call" · "only the author approved" · "unreadable config" |
| L4 | 랜드 | `main_red` 동결·`main_fix` 예외·`repo_level_main`(R-05) | U11(+U16) | `core/land/land.test.ts` "main_red freezes" · "scenario repo_level_main (land side)" |
| L5 | 랜드 | `stack_bottom`·`retarget_approval` | U11 | `core/land/land.test.ts` "scenario stack_bottom" · "scenario retarget_approval" 두 경우(patch-id 다름 거부 · 같음 승계) |
| L6 | 랜드 | 어느 입구로 불러도 같은 결과·거부 문구 하나(R-03) | U11 | `test/land/entrances.test.ts`(함수·MCP·CLI 셋이 dry run · 거부 · 실제 land 에서 같은 결과, `verify-tier` CLI = 함수), `core/land/land.test.ts` "--dry-run runs the same judgment" |
| R1 | 정리 | 루트 읽기 실패 → 정리 0 | U18 | |
| R2 | 정리 | 두 라운드 연속 + 유예 + 끝남 긍정일 때만 대상, 잠잠함은 기준 아님 | U18 | |
| R3 | 정리 | 기록 없는 카드 편입(`resource_adopted`), 편입 ≠ 삭제 | U18 | |
| R4 | 정리 | 삭제 전 검사(미커밋·추적 안 된 파일·원격에 없는 커밋·다른 패치) | U18 | |
| R5 | 정리 | `rm --run-hooks --delete-branch`(`--force` 없음), 훅 실패 → `archive_hook_failed`(P6) | U18 | |
| R6 | 정리 | Docker 기록 id 만·순서·`prune`/`down -v`/라벨 선택 없음 | U18 | |
| R7 | 정리 | `remote_host` 카드당 한 번·`isMainWorktree` 건너뜀·터미널 안 닫음 | U18 | |
| R8 | 정리 | `reap_round` 필드·`timer_stalled`(간격 3배·`roots_ok=false` 3회) | U17 | `test/detect/queue.test.ts` "timer_stalled"(행 없음 0 · 3배 안 0 · 3배 넘음 1 · 힌트 라운드가 가리지 못함 · 실패 2회 0 · 3회 1 · 4회 같은 키 1) · "stallCheck"(쓰기 1 · 다시 0 · 오케스트레이터 알림 1 · Run 없으면 0) · `test/orca-plugin.test.ts` "the stall check runs on Orca events"(타이머 10분 0 · 이벤트 둘 1 · 패널 1). `reap_round` 를 쓰는 쪽은 U18 |
| D1 | 감지기 | orca-monitor 멈춤 판정 = 시각 필드, 못 보면 행동 0(R-07, P10) | U15 | |
| D2 | 감지기 | `one_session_two_terminals` | U15 | |
| D3 | 감지기 | 부하 판정 함수 하나(압박 게이트·resource-monitor·capacity, R-13) | U15(+U10) | |
| D4 | 감지기 | 머지 확인 뒤에만 PR 항목 `completed`·`main_green/red` | U16 | `core/detect/pr/round.test.ts`: `merge_suggests_close`(머지 확인 → `pr_merged` 다음 같은 라운드에 Task `completed`, 다른 열린 Task 는 `close_suggested`) · 머지 커밋이 main 에 없으면 `pr_merged`·Task 쓰기 0 · dry run 은 Orca 쓰기 0 · `repo_level_main`(main_* 쪽). `judge.test.ts`: 재실행 1회로 flake 구분 · 취소는 빨강 아님 · 0-job 은 모름(결정 142·143). 실제 Orca 의 `task-update` 는 미실행(VERIFY 가 Task 쓰기를 금함) |
| D5 | 감지기 | queue-monitor 는 항목을 닫지 않음·`escalation_stale`·`job_drift` | U17 | `test/detect/queue.test.ts` 13건: 닫는 Orca 호출 0(`task-update`·`gate-resolve`·`worker-release`, probe 참·moot·재전달 라운드), `escalation_stale` 세 갈래(`waiting_unreleased` 1 · `verify_unconfirmed` 1 · 전달 안 된 답 1, 각 한 번), `job_drift`(어긋남 1 · 같은 어긋남 0 · 못 읽음 0) |
| PN1 | 패널 | 승인된 plugin 의 worker 가 돈다(T1·T2·T4) | U3 | |
| PN2 | 패널 | 패널 행 ID = `BriefModel` 행 ID | U19 | |
| PN3 | 패널 | `sangsoe todo` = 패널 띠 = 상태 표시줄 숫자 | U19(+U9) | |
| PN4 | 패널 | 버튼 → `owner_action` → 같은 코어 함수 | U19 | |
| I1 | 설치 | `brew install` → `install` → `plugin approve` → `doctor` 녹색 | U4·U24 | |
| I2 | 설치 | `brew upgrade && sangsoe install` 뒤 네 칸 같은 버전, 어긋나면 한 줄 경고(R-23) | U4 | |
| I3 | 설치 | `uninstall` → 재설치 녹색, sqlite 보존 | U4·U24 | |
| M1 | 이관 | R-01–R-23 23/23 이 CI 시험에 대응 | U21 | 미달: 시험이 있는 요구 19/23, 그중 전부 지키는 것 8/23. `docs/requirements-coverage.md`(🟢 8 · 🟡 11 · 🔴 3 R-06·R-20·R-21 · 단위 1 R-12 U18). `test/migrate/coverage.test.ts` 가 행과 시험 파일과 집계를 센다 |
| M2 | 이관 | 다시 만드는 13가지 D-1–D-13 의 위치 13/13(D-1 은 결정 95 대로 plugin 안) | U21(+U6·U20) | 행 13/13: 자리가 main 에 있는 것 9(D-1 은 `claude-plugin/skills/general/`, D-7 은 pr-monitor 만 U16, D-9 는 REAPER 라운드만 U18, D-10·D-11 은 `orca-plugin/panel/`), 단위가 가져올 것 1(D-8 U17), sangsoe 밖 3(D-2–D-4). `docs/port-map.md` 가 옛 항목 166/166 을 한 행씩(`test/migrate/port-map.test.ts`) |
| M3 | 이관 | 열린 항목·결정 읽기 전용 가져오기 + smoke 종단 한 번 | U21·U23 | 가져오기: `test/migrate/migrate.test.ts`(열린 것만 · 옛 DB 바이트 그대로 · 두 번째 실행 0건 · 제목은 event 에 없음). 이 Mac 의 실제 옛 저장소 dry run: 열린 항목 23(todo 9 · doing 1 · held 13) · 열린 결정 0 · 간선 0 · 닫힌 항목 120 · 닫힌 결정 76 · 가져오지 않는 리드·카드 행 14 · 리드 1. 쓰는 가져오기와 smoke 종단은 전환 때(U23·U24) |

합계: 기반 4 · 코어 13 · 랜드 6 · 정리 8 · 감지기 5 · 패널 4 · 설치 3 · 이관 3 = 46.
