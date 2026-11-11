# 공통 요구 R-01–R-23 과 "다시 만드는 13가지" 의 자리

port-plan 3.5 의 공통 요구 23개가 어느 시험 파일로 지켜지는지, 1절 D-1–D-13 이 어디에 다시 만들어졌는지 적는다. 행 꼴은 구현 결정 141 이고 `test/migrate/coverage.test.ts` 가 행 수·시험 파일의 존재·아래 집계를 센다.

상태: 🟢 그 시험이 요구 전체를 main 에서 지킨다 · 🟡 일부만 지킨다(빠진 것을 적었다) · 🔴 지키는 시험이 없다 · `PR #N`/`U<번호>` 그 단위가 가져온다.

집계: R 23행 · 🟢 9 · 🟡 11 · 🔴 3 · 단위 0

## R-01–R-23

| 요구 | 지켜야 할 것 | 시험 파일 | 상태 |
|---|---|---|---|
| R-01 | hook 등록 경로의 존재·실행 비트·공개 위생 검사가 실제로 실패할 수 있음 | `test/hooks-registered.test.ts`, `test/layout.test.ts` | 🟡 공개 위생(금지어) 검사가 CI 에 없다 |
| R-02 | 간선이 일급이고 읽지 못한 선행은 "모름" | `test/graph/edges.test.ts`, `test/graph/regressions.test.ts` | 🟢 |
| R-03 | 머지 사전 확인·실행·거부 문구가 한 함수, 입구가 달라도 같은 결과 | `test/land/entrances.test.ts`, `core/land/land.test.ts` | 🟢 |
| R-04 | 리뷰 근거 네 칸, 작성자가 자기 통과를 못 씀, 리뷰 못 한 실행은 통과 아님 | `core/land/land.test.ts`, `core/verify/evidence.test.ts`, `core/approve/review-verdict.test.ts` | 🟢 |
| R-05 | 머지·main 기록은 저장소 단위 하나, 재실행으로 가려진 실패를 따로 센다 | `core/land/land.test.ts` | 🟡 `main_red` 동결과 `repo_level_main` 은 있고 재실행으로 가려진 실패 세기는 pr-monitor(U16) 몫 |
| R-06 | 독점 구간을 거부·보류 PR 이 쥐지 않고 보유에 stale 상한 | — | 🔴 sangsoe 의 land 는 머지 예약(`gh pr merge --auto`)이라 독점 구간이 없다. 그 판단을 고정하는 시험이 없다 |
| R-07 | 상태는 구조 신호가 정본, 판별 못 하면 행동 0, 시작 실패와 일부러 쉼을 구분 | `core/detect/orca/judge.test.ts` | 🟢 |
| R-08 | 보낸 쪽이 잘림·수신자 없음 실패를 받음, 받는 쪽 하나에 소비자 하나, 재개 시 대기를 다시 붙임 | `test/decision/notify.test.ts`, `test/orca-boundary.test.ts`, `test/session/hooks.test.ts` | 🟡 수신자 없음(`send_failed`)·소비자 하나·재개는 시험한다. 보낸 글이 잘린 것을 보낸 쪽이 받는 시험은 없다 |
| R-09 | hook 은 이벤트당 프로세스 하나, 합치기 표 시험, 실제 명령 모음으로 오탐·미탐 | `test/hooks-registered.test.ts`, `core/gates/merge.test.ts`, `core/gates/gates.test.ts`, `cli/commands/hook.test.ts` | 🟢 |
| R-10 | 권한 결정은 한 곳, 거부는 event, 거부된 행동을 다른 경로로 재시도하지 않음 | `cli/commands/hook.test.ts`, `core/gates/gates.test.ts` | 🟡 한 곳 결정과 거부 event(`gate_denied`)는 시험한다. 거부된 행동을 다른 경로로 재시도하지 않는 것은 규칙 문장뿐이고 지키는 시험이 없다 |
| R-11 | 호스트 상태·시계 주입, CI 시간 상한·병렬, 제외 시험과 재실행 flake 를 숨기지 않음 | `core/install/install.test.ts`, `core/contract/contract.test.ts` | 🟡 주입은 있다. CI job 에 시간 상한이 없고 건너뛴 시험 수를 따로 보이지 않는다 |
| R-12 | 만든 자원은 기록하고 그 기록으로만 치움, 목록이 비면 지우지 않음 | `test/reaper/entrances.test.ts`, `test/reaper/scenarios.test.ts` | 🟢 `resource_record` 가 자원을 기록하고, REAPER 는 기록한 id 만 치우며(`reap_docker_order`), 루트 목록 하나라도 못 읽으면 후보도 치움도 없다(`reap_roots_fail_no_sweep`) |
| R-13 | 부하 판정은 한 기준, 무거운 작업 슬롯은 CPU 에 맞춤 | `core/capacity/capacity.test.ts`, `core/gates/gates.test.ts` | 🟡 부하 판정은 한 함수이고 CPU 수에 비춰 본다. 슬롯 상한(`limit`)은 설정값이라 CPU 수에 맞추지 않는다 |
| R-14 | 항목은 담당·원문·끝나는 조건을 함께 가짐, 닫는 길 없는 파생 항목 없음 | `core/start/item.test.ts`, `cli/commands/item-new.test.ts`, `test/migrate/migrate.test.ts` | 🟢 |
| R-15 | 오너 항목은 에이전트가 못 하는 행동에만, 이유 한 줄 | `test/owner/scenarios.test.ts`, `test/owner/owner-todo.test.ts` | 🟡 오너 항목이 관찰한 사실·기록된 답으로만 닫히는 것은 시험한다. "에이전트가 못 하는 행동에만"과 이유 한 줄(`why_owner`)을 올리기 전에 거르는 시험은 없다 |
| R-16 | 모든 CLI 는 `--help`·모르는 인자에서 무변경, 모르는 명령은 맞는 형태를 보임 | `cli/main.test.ts`, `test/boundaries/adapters.test.ts` | 🟢 |
| R-17 | Orca 가 하는 일은 Orca 로, 기대 동작은 버전 변경 시 시험, 호환 경로 없음 | `core/checks/checks.test.ts`, `test/orca-boundary.test.ts`, `test/lineage/real-orca.test.ts` | 🟢 |
| R-18 | 감시는 할 일이 생기는 전이에만 깨움, 자동화마다 목적·사용 증거·비용·끄는 명령 | `core/detect/run.test.ts`, `core/detect/orca/judge.test.ts` | 🟡 전이마다 한 번(에피소드·멈춤 키)은 시험한다. monitor 마다 목적·사용 증거·비용·끄는 명령을 한 목록에 두고 세는 시험이 없다 |
| R-19 | 역할·모델이 시작 기록에 남고 역할 줄 없는 시작은 오류, 감독 비용 측정 | `test/session/hooks.test.ts`, `test/judgment-layer.test.ts` | 🟡 역할·모델과 역할 줄 없는 세션(`worker_stuck{no_role_line}`)은 시험한다. 머지된 PR 한 건당 컨텍스트 측정(reflect)은 시험이 없다 |
| R-20 | 남의 스택·서비스 대상 단위는 보내기 전 읽기 전용 사전 확인, LAND 줄에 필수 체크 | — | 🔴 write-brief skill 의 문장을 고정하는 시험이 없다 |
| R-21 | 노트는 영구 삭제하지 않고 옮김 | — | 🔴 노트 저장소는 sangsoe 밖이다(D-2). sangsoe 에는 지킬 코드가 없다 |
| R-22 | 문서 숫자·번역 기준을 손으로 유지하지 않음 | `test/migrate/port-map.test.ts`, `test/migrate/coverage.test.ts` | 🟡 이관 표·이 문서의 집계는 시험이 센다. 다른 문서의 숫자는 아직 손으로 쓴다 |
| R-23 | 설치 갱신은 오너가 지운 규칙을 되살리지 않음, reload 방송은 받을 수 있는 세션만 | `core/install/install.test.ts` | 🟡 설치는 사람의 설정을 쓰지 않아 되살릴 규칙이 없고 두 번째 설치는 갱신만 한다(결정 90). reload 방송은 없다 |

## D-1–D-13

| # | 옛 것 | sangsoe 의 자리 | 상태 |
|---|---|---|---|
| D-1 | 일반 스킬 14개 | `claude-plugin/skills/general/` | 🟢 결정 95: 별도 저장소가 아니라 plugin 안 |
| D-2 | 노트·티켓 도구 | — | sangsoe 밖에서 다시 만든다. 본체는 이 저장소에 아무것도 두지 않는다(결정 93) |
| D-3 | 권한 규칙·비밀 입력 도구 | — | sangsoe 밖 |
| D-4 | 공유·프리뷰 도구 | — | sangsoe 밖 |
| D-5 | 역할·위임 게이트·`dispatch-card`·`end-session`·`reboot` | `claude-plugin/agents/`, `core/start/`, `core/gates/delegate.ts`, `claude-plugin/skills/start/SKILL.md`, `claude-plugin/skills/end-session/SKILL.md`, `core/recover/`, `core/session/` | 🟢 |
| D-6 | 머지·배포 절차와 머지 판정 | `core/land/`, `core/verify/`, `cli/commands/land.ts`, `claude-plugin/skills/deliver-ticket/SKILL.md` | 🟢 |
| D-7 | 워커·PR·멘션 감시 자동화 | `orca-plugin/monitors/orca.ts`, `orca-plugin/monitors/pr.ts`, `orca-plugin/monitors/chat.ts`, `core/detect/` | 🟢 orca·pr·chat monitor 가 plugin worker 의 타이머 라운드로 돈다 |
| D-8 | 순회 자동화 | `orca-plugin/monitors/queue.ts`, `orca-plugin/timer.ts`, `core/detect/queue/` | 🟢 queue-monitor 가 같은 타이머 라운드로 돌며 순회가 하던 점검을 `item_ready`·`escalation_stale`·`todo_due` 판정으로 한다 |
| D-9 | 정리·압박 자동화, `reap-resources`, 압박 게이트 | `orca-plugin/reaper/`, `core/reaper/`, `core/capacity/`, `core/gates/pressure.ts`, `claude-plugin/skills/reap-resources/SKILL.md` | 🟢 판정·게이트·skill 과 REAPER 라운드(`orca-plugin/reaper/round.ts`)가 있다 |
| D-10 | 대시보드 서버와 12페이지 | `orca-plugin/panel/`, `core/brief/panel.ts` | 🟢 서버·포트·12페이지 없이 패널 하나의 세 단계(결정 11·75, 구현 결정 136) |
| D-11 | 브리프 패널·밴드 UI mod | `orca-plugin/panel/`, `core/brief/panel.ts` | 🟢 패널과 상태 표시줄 B(구현 결정 136) |
| D-12 | `brief` 스킬 | `core/brief/`, `cli/commands/brief.ts`, `claude-plugin/skills/brief/SKILL.md` | 🟢 |
| D-13 | 과거 기록과 설치·점검·reflect | `core/migrate/`, `cli/commands/migrate.ts`, `core/install/`, `claude-plugin/skills/reflect/SKILL.md` | 🟢 열린 항목·결정만 가져온다(구현 결정 140) |
