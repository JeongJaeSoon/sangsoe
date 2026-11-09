# agent-skills → sangsoe 이관 표

agent-skills(공개 저장소, `2a065706` 기준)의 skill·hook·agent·script·bin 과 저장소 뿌리 항목이 sangsoe 의 어디로 갔는지, 또는 왜 버렸는지를 한 행씩 적는다. 출발점은 구현 계획의 항목 → 단위 표이고, 각 행을 main 의 코드와 대조했다. 행 꼴과 시험은 구현 결정 141 이다.

- **위치 칸**: 이 저장소에 있는 경로(백틱) · 아직 머지되지 않은 단위의 `PR #N` · PR 이 아직 없는 단위 `U<번호>` · `DROP`(셋째 칸이 이유) · `GAP`(설계가 자리를 정했으나 main 에도 열린 PR 에도 없다. 셋째 칸이 무엇이 빠졌는지).
- **옛 시험 파일**(`test_*.py`·`*.test.tsx`)은 그 대상의 행에 함께 적는다. 옛 코드는 옮기지 않았고 시험은 다시 쓸 명세로만 읽었다(port-plan 1절).
- `test/migrate/port-map.test.ts` 가 `test/fixtures/migrate/agent-skills-entries.txt` 의 모든 항목이 이 표에 있는지, 경로가 있는지, DROP·GAP 에 이유가 있는지 센다.

집계: 행 87 · 경로 50 · PR 0 · 단위 9 · DROP 25 · GAP 9 (한 행이 경로와 PR 을 함께 가지면 둘 다 센다).

## skills

| 옛 항목 | sangsoe 위치 | 남긴 것 / 버린 것 · 근거 |
|---|---|---|
| `skills/orchestrate` | `claude-plugin/skills/orchestrate/SKILL.md` | 남김: 깨움 처리·나누기·결정은 `decision_open`·리뷰와 land 경로. 버림: inbox 대기·카드 감시·대시보드 갱신(깨움은 Orca 메시지, 현황은 resource, 결정 120) |
| `skills/dispatch-card` | `claude-plugin/skills/start/SKILL.md`, `core/start/` | 남김: `start_unit` 한 번과 started·waiting·stopped·거부 읽기. 버림: 다른 모든 시작 경로(결정 94) |
| `skills/end-session` | `claude-plugin/skills/end-session/SKILL.md` | 남김: 정리·`resource_record`·`handoff_save`·`worker_done` 한 번. 버림: 터미널 닫기·카드 아카이브(Orca 자동 해제, REAPER) |
| `skills/deliver-ticket` | `claude-plugin/skills/deliver-ticket/SKILL.md`, `core/land/`, `core/verify/` | 남김: 계획·시험·독립 리뷰·V0–V3 증거·land·`merge_ready`. 버림: 직접 머지와 티켓 도구 단계(결정 93) |
| `skills/reflect` | `claude-plugin/skills/reflect/SKILL.md`, `core/store/views/item_timeline.ts` | 남김: 세 리뷰어 교훈과 `item_timeline` 측정. 버림: 교훈 원장 파일(재료는 event 와 리뷰 원문) |
| `skills/reap-resources` | `claude-plugin/skills/reap-resources/SKILL.md`, U18 | 남김: 당사자 몫과 REAPER 보고 처리. 버림: 목록·판정·정리 절차(토큰 X 인 REAPER 라운드, U18 이 짓는다) |
| `skills/skills-config` | `claude-plugin/skills/setup/SKILL.md`, `core/install/` | 남김: `sangsoe install`·`doctor`·`plugin approve`·`uninstall` 을 가리키기. 버림: 설정 파일 쓰기 |
| `skills/setup-pc` | `claude-plugin/skills/setup/SKILL.md`, `cli/commands/install.ts`, `cli/commands/doctor.ts` | 남김: 설치·점검. 버림: dry-run 스크립트와 `agent-skills.json` 키(결정 90) |
| `skills/brief` | `claude-plugin/skills/brief/SKILL.md`, `claude-plugin/skills/todo/SKILL.md`, `core/brief/`, `cli/commands/brief.ts`, `cli/commands/todo.ts` | 남김: 렌더러 출력을 그대로 보내기, 78칸 표. 바꿈: 세 단계와 `todo`(결정 89, 128) |
| `skills/watch-prs` | U16 | pr-monitor(머지 확인·main 감시). 아직 PR 없음 |
| `skills/watch-mentions` | `orca-plugin/monitors/chat.ts`, `core/detect/chat/` | chat-monitor(U15). 받는 쪽 공급자는 아직 비어 있다(null provider) |
| `skills/reboot` | `core/recover/`, `cli/commands/recover.ts`, `core/session/session-start.ts` | 남김: 복구 표와 SessionStart 재부착(U13). 버림: skill 코드(세션 시작 hook 이 한다) |
| `skills/architect`, `skills/challenge`, `skills/explain-code`, `skills/fan-out`, `skills/figure-it-out`, `skills/principles`, `skills/prune-comments`, `skills/recall`, `skills/show-me-your-work`, `skills/tdd`, `skills/ui-review`, `skills/verification-skill`, `skills/write-plainly`, `skills/write-skill` | `claude-plugin/skills/general/` | 일반 작업 skill 14개. 결정 95 로 별도 저장소가 아니라 plugin 안에 다시 썼다(D-1) |
| `skills/use-notes` | DROP | 오너의 개인 노트 저장소 설정에 묶여 있다(D-2, 결정 79). sangsoe 밖에서 다시 만든다 |
| `skills/use-tracker` | DROP | 외부 티켓은 Orca 참조로만 둔다(결정 93) |
| `skills/write-ticket` | DROP | 결정 93. 후속 일은 항목(`item_create`)이다 |
| `skills/secure-fill` | DROP | 개인 도구(결정 79, D-3). 공개 본체 밖 |
| `skills/tune-automode` | DROP | 개인 권한 설정(D-3). 사람이 고치는 설정을 sangsoe 가 쓰지 않는다 |

## 새로 생긴 판단 skill (옛 항목 없음)

| 옛 항목 | sangsoe 위치 | 남긴 것 / 버린 것 · 근거 |
|---|---|---|
| (없음) | `claude-plugin/skills/intake/SKILL.md`, `claude-plugin/skills/write-brief/SKILL.md` | 오너 말 여섯 분류와 `owner_class`, 브리프 쓰기(결정 120) |

## agents

| 옛 항목 | sangsoe 위치 | 남긴 것 / 버린 것 · 근거 |
|---|---|---|
| `agents/orchestrator.md` | `claude-plugin/agents/orchestrator.md` | 남김: Orca 메시지로만 깨움, 직접 일하지 않음. 버림: MODE 줄, 옛 이름 |
| `agents/lead.md` | `claude-plugin/agents/lead.md`, `claude-plugin/agents/worker.md` | 남김: 시작 전 완료 조건. 워커 정의는 새로 썼다(결정 120). 버림: MODE·DELEGATE·PREDICATE |
| `agents/notes-writer.md` | DROP | D-2: 노트 저장소는 sangsoe 밖 |
| `agents/task-tracker.md` | DROP | 결정 93 |

## hooks

| 옛 항목 | sangsoe 위치 | 남긴 것 / 버린 것 · 근거 |
|---|---|---|
| `hooks/hooks.json`, `hooks/dispatch.py`, `hooks/test_dispatch.py` | `claude-plugin/hooks/hooks.json`, `claude-plugin/hooks/pre-tool-use.sh`, `core/gates/merge.ts`, `core/gates/merge.test.ts` | 이벤트당 프로세스 하나, deny > ask > allow 합치기 표 시험. allow 는 쓰지 않는다(결정 119) |
| `hooks/delegate_gate.py`, `hooks/test_delegate_gate.py` | `core/gates/delegate.ts`, `core/gates/gates.test.ts` | `[gate:delegate]` |
| `hooks/pressure_gate.py`, `hooks/test_pressure_gate.py` | `core/gates/pressure.ts`, `core/capacity/` | 판정 함수 하나(결정 83, 115). 버림: 대기열(결정 119 "아직 없는 것") |
| `hooks/self_land_gate.py`, `hooks/land_route_gate.py`, `hooks/test_self_land_gate.py`, `hooks/test_land_route_gate.py` | `core/gates/self-land.ts` | 두 게이트를 자기 머지 게이트 하나로 합쳤다(부록 `#gates`) |
| `hooks/guard.py`, `hooks/test_guard.py`, `hooks/test_coordination.py`, `hooks/test_danger.py`, `hooks/test_discipline.py`, `hooks/test_refusal_retry.py` | `core/gates/start.ts`, `core/gates/sleep-loop.ts`, `core/gates/report-address.ts`, `core/gates/shell.ts`, GAP | 남김: 시작 가드·sleep-loop·모양 검사·셸 파서. GAP: 위험 명령(`lib/danger`)·워커 규율(`lib/discipline`)·역할 세션의 사람 직접 질문 금지(`lib/coordination`)는 결정 119 가 미뤘고 아직 없다 |
| `hooks/lib` | `core/gates/shell.ts`, `core/session/shell.ts`, GAP | `lib/shell` → 두 파서(막는 hook·`!` 입력 읽기). GAP: `lib/danger`·`lib/discipline`·`lib/coordination`(위 행), `lib/skillload`(아래 행). `lib/config` 는 설정 파일 읽기라 각 모듈이 `~/.config/sangsoe/` 를 직접 읽는다. `lib/artifact_links` → DROP(아래 artifact 행) |
| `hooks/stack_gate.py`, `hooks/test_stack_gate.py` | GAP | 다른 열린 PR 에 기대는 PR 을 스택으로 돌리는 게이트. 결정 119 가 미뤘다 |
| `hooks/claim_check.py`, `hooks/test_claim_check.py`, `hooks/turn_check.py`, `hooks/test_turn_check.py`, `hooks/owner_check.py`, `hooks/test_owner_check.py` | GAP | 경고만 하는 턴 끝 점검 셋. 막는 hook 단위(U12)에도 기록 hook 단위(U13)에도 들지 않았다 |
| `hooks/decision_relay.py`, `hooks/test_decision_relay.py` | GAP | 오너 말을 중계했는데 결정 기록이 없을 때의 경고. 닫기 자체는 `core/decision/` 의 `decision_answer` 가 한다 |
| `hooks/decision.py`, `hooks/test_decision.py` | `core/decision/`, `cli/commands/decision.ts`, `core/session/record.ts` | 답은 UserPromptSubmit 이 `owner_action` 으로 쌓고 `dNNN` 하나면 `decision_answer` 가 닫는다. 회귀 시나리오는 `test/decision/decision-loop.test.ts`·`test/session/hooks.test.ts` |
| `hooks/reorient.py`, `hooks/test_reorient.py`, `hooks/roles.py`, `hooks/test_roles.py` | `core/session/session-start.ts`, `claude-plugin/hooks/record.sh` | SessionStart 가 역할·Run·인계·늦은 답을 다시 싣고 `session_started` 를 쓴다. 버림: `roles/*.json` 파일 |
| `hooks/permission.py`, `hooks/test_permission.py` | `core/session/record.ts`, U19 | 권한 대기 `waiting_human`·`waiting_released`(U13)와 패널 버튼(U19) |
| `hooks/subagent_log.py`, `hooks/test_subagent_log.py`, `hooks/lifecycle.py`, `hooks/test_lifecycle.py`, `hooks/record_check.py`, `hooks/test_record_check.py`, `hooks/onboard.py`, `hooks/test_onboard.py`, `hooks/test_skillload.py` | GAP | 기록 hook 단위(U13)가 넣지 않았다: 서브에이전트 시작·끝 기록, 종료 순서·서브에이전트에 거부 문단 주입, 기록 줄 없는 PR·`worker_done` 경고, 설치 점검 권유, 배포 skill 로드 전 수정 경고 |
| `hooks/prose_check.py`, `hooks/test_prose_check.py` | `claude-plugin/skills/general/write-plainly`, GAP | 규칙과 패턴은 write-plainly 의 references 에 있다. hook 은 결정 95 가 CLI 라우터 뒤로 미뤘고 아직 없다 |
| `hooks/tracker_gate.py`, `hooks/test_tracker_gate.py` | DROP | 결정 93: 티켓 도구는 sangsoe 밖 |
| `hooks/artifact_archive.py`, `hooks/artifact_links_stop.py`, `hooks/artifact_send_check.py`, `hooks/test_artifact_links.py` | DROP | 결정 74: 공유물은 Orca 참조가 대신한다(D-4, sangsoe 밖) |
| `hooks/install_hint.py` | DROP | 은퇴한 no-op. `sangsoe doctor` 가 대신한다 |
| `hooks/orchestrator_guard.py` | DROP | 은퇴한 no-op. 깊이 검사는 `core/start/` 에 있다 |
| `hooks/refusals.py`, `hooks/request_log.py`, `hooks/test_request_log.py`, `hooks/test_retired.py` | DROP | 은퇴한 no-op 과 그 시험. 거부는 `gate_denied` event 로 쌓인다 |
| `hooks/brief_pane.tsx`, `hooks/brief_pane.test.tsx`, `hooks/clear_band.tsx`, `hooks/clear_band.test.tsx`, `hooks/mods.tsx` | U19 | 코드는 버리고 기능은 Orca plugin 패널·상태 표시줄 B 가 한다(D-11) |

## scripts

| 옛 항목 | sangsoe 위치 | 남긴 것 / 버린 것 · 근거 |
|---|---|---|
| `scripts/card.py`, `scripts/test_card.py` | `core/start/`, `test/lineage/start.test.ts` | `worker-start` 로만 시작, 대체 시작 없음(결정 94). 버림: 카드 행·nudge |
| `scripts/end_check.py`, `scripts/test_end_check.py` | `claude-plugin/skills/end-session/SKILL.md` | 끝나도 되는지 실제 출력으로 판정하는 규칙만 skill 에 남았다 |
| `scripts/sync.py`, `scripts/test_sync.py` | `cli/commands/install.ts`, `core/install/` | 설치 갱신과 버전 일치(R-23). reload 방송은 `sangsoe install` 뒤 Orca·Claude Code 의 다시 읽기에 맡긴다 |
| `scripts/setup.py`, `scripts/test_setup.py`, `scripts/bootstrap.py`, `scripts/recommended-settings.json` | `core/install/`, `cli/commands/install.ts`, `cli/commands/doctor.ts`, `cli/commands/uninstall.ts` | `brew install` + `sangsoe install` 두 명령(결정 90). 버림: 권장 설정 쓰기(사람의 설정은 sangsoe 가 쓰지 않는다) |
| `scripts/catalog`, `scripts/test_catalog_coverage.py`, `scripts/test_catalog_stale.py` | DROP | 번역 카탈로그를 두지 않는다(R-22). skill 목록은 plugin 매니페스트가 정본이다 |
| `scripts/ci_forbidden_terms.py`, `scripts/ci_tests.py`, `scripts/test_ci.py`, `scripts/test_public_shapes.py`, `scripts/test_script_modes.py`, `scripts/test_intent.py` | `.github/workflows/ci.yml`, `test/layout.test.ts`, `test/hooks-registered.test.ts` | CI 세 job(결정 100). 실행 비트·hook 경로는 `hooks-registered`, plist 금지는 `layout`. GAP 은 요구 집계(R-01·R-11)에 적었다 |
| `scripts/skill_tokens.py`, `scripts/skill_budget.json`, `scripts/test_skill_tokens.py` | GAP | 스킬 토큰 예산은 개념만 넘어왔고(port-plan 2.4) 측정과 상한 시험이 아직 없다 |
| `scripts/test_allowed_tools.py`, `scripts/test_mcp_prefixes.py` | `test/judgment-layer.test.ts` | 판단 층이 sangsoe 를 MCP 로만 부르는지 본다 |
| `scripts/automations.py`, `scripts/test_automations.py`, `scripts/orca_job.py`, `scripts/test_orca_job.py` | `orca-plugin/timer.ts`, `orca-plugin/monitors/spec.ts`, `core/detect/run.ts` | 자동화 등록 대신 plugin worker 타이머(결정 75, 84②) |
| `scripts/reap_hard.py`, `scripts/test_reap_hard.py` | U18 | REAPER 가 받는다 |
| `scripts/migrate.py`, `scripts/artifact_hooks_cutover.py`, `scripts/test_artifact_cutover.py` | DROP | 일회용 이행 스크립트. sangsoe 의 한 번 가져오기는 `core/migrate/` 가 새로 한다 |
| `scripts/share_server.py`, `scripts/test_share_server.py`, `scripts/share-caddy`, `scripts/preview_watch.py`, `scripts/test_preview_watch.py` | DROP | 상주 서버·포트(D-4). sangsoe 밖 |
| `scripts/pstack-sync.py`, `scripts/pstack-sync-test.sh` | DROP | 결정 74: 스택은 Orca·gh 가 한다 |

## orchestrate 의 스크립트 (`skills/orchestrate/scripts/`)

`skills/orchestrate` 행에 들어 있는 것을 펼친 표다. 완전성 시험은 최상위 항목만 세므로 이 표는 그 아래를 보이기 위한 것이다.

| 옛 항목 | sangsoe 위치 | 남긴 것 / 버린 것 · 근거 |
|---|---|---|
| store, registry | `core/store/`, `core/contract/` | 정본은 `event` 하나와 뷰(port-plan 4절) |
| prog | `cli/main.ts`, `cli/contract.ts` | `--help`·모르는 인자 무변경(R-16) |
| handoff | `core/session/handoff.ts`, `claude-plugin/mcp/tools/handoff_save.ts` | 인계 본문은 Orca 메시지(결정 80 N1) |
| inbox_stream | `core/notify/` | 받는 순서와 `notified`. 받은 편지함은 Orca |
| land_exec, landjudge, land_scope, ci_wait, stacks | `core/land/`, `core/verify/`, `core/gh/` | land 판정 함수 하나(결정 124, 125) |
| orca_settings | `core/checks/` | 시작 점검(결정 63) |
| card_watch | `core/detect/orca/`, `orca-plugin/monitors/orca.ts` | orca-monitor: 시각 필드로 판정, 못 보면 행동 0(결정 87) |
| model_drift | GAP | 역할 모델과 실제 모델의 어긋남 알림. `session_started` 에 모델은 남지만 비교하는 감지기가 없다 |
| pr_watch | U16 | pr-monitor |
| jobs | U17 | queue-monitor |
| stages, stage_auto, fleet, dash, units | `core/brief/`, U19 | 뷰와 패널 |
| board, holds, order, order_close, tidy, autowake, autoqueue, patrol, selfcheck, acks, sent, ask, rowstate, cutover, orca_migrate, dash_demo, agent_signal, compactions, turn_cost, token_usage, flow, overlap_table, pr_stats, mailbox_guard, skill_usage | DROP | port-plan 2.2 가 하나씩 이유를 적었다 |

## bin

| 옛 항목 | sangsoe 위치 | 남긴 것 / 버린 것 · 근거 |
|---|---|---|
| `bin/orch` | `cli/main.ts` | `sangsoe` CLI. `orch` 라는 이름이나 별칭은 만들지 않는다(port-plan 5절 2) |
| `bin/skills-sync` | `cli/commands/install.ts` | `sangsoe install` |
| `bin/reap-hard` | U18 | REAPER |
| `bin/orch-dash` | DROP | D-10: 패널이 대신하고 서버·포트가 없다 |
| `bin/pr-watch` | DROP | pr-monitor(U16)가 대신한다 |
| `bin/secure-fill`, `bin/share-server`, `bin/preview-watch`, `bin/preview-links` | DROP | 개인 도구·상주 서버(D-3, D-4) |

## 저장소 뿌리

| 옛 항목 | sangsoe 위치 | 남긴 것 / 버린 것 · 근거 |
|---|---|---|
| `.claude-plugin` | `.claude-plugin/marketplace.json`, `claude-plugin/.claude-plugin/plugin.json` | 마켓플레이스는 트리 안에서, 별도 저장소 없음 |
| `.github` | `.github/workflows/ci.yml`, `.github/workflows/release.yml` | CI 세 job 과 릴리스 |
| `.gitignore` | `.gitignore` | 새로 썼다 |
| `README.md`, `INSTALL.md` | `README.md` | 설치 절은 README 하나(U24) |
| `README.ja.md`, `README.ko.md` | DROP | 번역본을 두지 않는다(R-22) |
| `AGENTS.md`, `CLAUDE.md`, `intent.md` | `docs/architecture.md` | 개념만: 내장 먼저, 층·토큰 나눔(port-plan 2.4) |
| `CONTRIBUTING.md`, `SECURITY.md` | DROP | 개인 저장소의 기여 안내. 필요해지면 새로 쓴다 |
| `LICENSE` | DROP | 오너가 정할 일이다. 지금 저장소에 없다 |
| `docs` | `docs/` | 옛 문서는 옮기지 않았고 sangsoe 설계 사본이 정본이다(`docs/port-plan.md`) |
| `evals` | `claude-plugin/skills/brief/evals`, `claude-plugin/skills/general` | skill 마다 자기 폴더의 `evals/` 로 갔다 |
| `tsconfig.json` | `tsconfig.json` | 한 패키지(결정 97, 98) |
| `types` | DROP | 옛 TSX mod 의 타입. mod 가 없다 |
| `vendor` | DROP | 결정 74: 스택 도구 사본을 두지 않는다 |
