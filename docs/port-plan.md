# sangsoe 이관 계획 (agent-skills → sangsoe)

이 문서의 #N 은 JeongJaeSoon/agent-skills#N 이다(sangsoe 저장소에 올리기 전에 형식을 바꾼다).

기준: agent-skills `origin/main` = `2a065706`(#610 머지). 저장소는 읽기 전용으로 보관(archive)되어 있고 열린 PR 0건·열린 이슈 16건이다. 설계는 `design.html`(핵심)과 `design-appendix.html`(부록)이 정본이고, 이 문서는 "agent-skills에서 sangsoe가 무엇을 참조하고 무엇을 두고 오는가"만 다룬다. 어떤 순서로 짓는가는 `design.html` 6절이 정한다.

경로 약어: `H/`=`hooks/`, `S/`=`scripts/`, `O/`=`skills/orchestrate/scripts/`, `R/`=`skills/reap-resources/scripts/`, `D/`=`skills/deliver-ticket/scripts/`. 표에 적은 시험 파일은 모두 `origin/main`에 있다. "모듈"은 `design.html` 6절의 모듈 이름이다(코어는 스키마·알림·GRAPH·결정 루프·(역할·세션)·(현황·MCP) 여섯 부분의 합이고, 별도는 sangsoe 본체 밖으로 가는 항목이다). `-`는 가져가지 않는 항목이다. 용어 예외 하나(용어집 첫 문단의 문장 그대로): agent-skills 의 옛 이름은 (a) port-plan.md 의 "두고 오는 것" 칸과 2.1·2.2·2.3·4절 표에서 옛 모듈·표·스킬 이름을 적는 칸, port-plan 2.4 표의 원본 칸과 5절, 1절 "다시 만드는 13가지" 표의 "옛 것" 칸, (b) decisions.md 에서 택하지 않은 대안을 설명하는 글에만 코드체로 쓴다. 그 밖에는 모두 이 표의 말로 고쳐 쓴다("AI" 도 에이전트·LLM 으로 쓴다).

## 1. 요약

- 원칙은 하나다. agent-skills의 코드는 한 줄도 옮기지 않는다. sangsoe는 자기 설계(`design.html`·`design-appendix.html`)에 맞춰 새로 쓰고, 옛 코드에서는 동작·사고로 생긴 규칙·시험 사례·함정만 참조한다. 시험 파일은 "복사할 것"이 아니라 "다시 쓸 명세"로 이름만 적는다.
- 분류는 넷이다(2.0에서 한 번 정의): **참조해서 새로 씀 84 · 참조 안 함 39 · 별도 plugin 28 · 개념만 9** (합계 160: 인벤토리의 모든 이름과 `origin/main`에서 보충한 25개).
- 요구사항은 이슈 69건·머지 없이 닫힌 PR 27건·중단 작업 인계 문서 4건, 모두 100행을 한 번씩 판정했다(3절): **반영 72 · 나중 2 · 불필요 26**. 반영 72행은 설계 위치와 모듈이 있고, 공통 요구 23개(R-01–R-23)로 모여 전환 조건의 시험이 된다.
- 옛 저장소의 상태·등록 파일이 외부 데이터(GitHub·Orca·Claude Code·티켓 도구)를 복사해 두던 표와 파일은 "원본은 하나" 규칙으로 다시 판정했다(4절). 캐시는 `pr_ref`·`gh_budget`·`gh_seen`과 보존 사본 `owner_text`뿐이고, 뷰 결과를 저장하는 캐시 표는 없으며 새 캐시는 만들지 않는다.
- 짓는 순서·전환 조건·전환·롤백은 이 문서에 없고 `design.html` 6절에 있다. 이 문서의 "모듈" 칸은 그 항목이 6절의 어느 모듈에서 만들어지는지다.
- Orca가 기능을 제공하는 것은 sangsoe가 만들지 않는다(결정 74). 옛 받은 편지함·claim·세대·lease·배정 역할은 Orca 메시지·Task·Dispatch·게이트가 맡고, 옛 웹 화면 서버는 Orca plugin 패널이 맡는다(웹 대시보드는 없다). 아래 표의 "두고 오는 것" 칸은 이 대응을 적는다.

### 다시 만드는 13가지

옛 것은 참고만 하고 13가지 모두 sangsoe 설계에 맞춰 다시 만든다(결정 74, 76). 별도로 두거나 버리는 분류는 없다. 목록에서 빠진 것은 없다.

| # | 옛 것 | 새 것 | 이유 · 상태 |
|---|---|---|---|
| D-1 | 일반 스킬 14개(`principles`·`write-plainly`·`tdd`·`architect` 등, 2.3) | general-skills 별도 저장소의 스킬 | sangsoe의 역할·상태에 의존하지 않아 본체 밖에 새로 쓴다(`evals`도 스킬과 함께 다시 쓴다). 다시 만듦 |
| D-2 | 노트·티켓 도구(`use-notes`·`notes-writer`·`use-tracker`·`write-ticket`·`task-tracker`·`tracker_gate` 등 hook) | 노트 저장소 라우팅 스킬, 티켓 도구 스킬과 hook | 오너의 개인 설정에 묶여 본체 밖에 새로 쓴다. 식별자 형식을 가정하지 않는 hook 시험은 실제 값 모음으로 다시 쓴다. 다시 만듦 |
| D-3 | 권한 규칙·비밀 입력 도구(`tune-automode`·`secure-fill`) | 권한 규칙 스크립트와 비밀 입력 스킬 | 거부 순환의 판정·드리프트 검사를 그 도구에서 키운다. 다시 만듦 |
| D-4 | 공유·프리뷰 도구(`artifact_*`·`share_server`·`preview_watch`·`pstack-sync`·`S/share-caddy`) | 공유·프리뷰 도구 | 본체와 무관해 본체 밖에 새로 쓴다. LaunchAgent·자체 상주 프로세스는 두지 않고(결정 176), 프리뷰 회수 지연 상한(#417)은 그 도구에서 고친다. 다시 만듦 |
| D-5 | 오케스트레이터·리드·워커 역할, 위임 게이트, `dispatch-card`·`end-session`·`reboot` | 코어의 역할·세션 | 배정·닫기·전파 역할은 만들지 않는다: 리드가 `ready` 뷰에서 직접 시작하고(`capacity`) 막기·풀기는 Orca 게이트가 하며 깨움은 Orca 메시지가 한다. 다시 만듦 |
| D-6 | 머지·배포 절차(`deliver-ticket`)와 머지 판정 | 랜드(land 판정 함수와 `sangsoe land`) | 머지 판정은 검토한 head sha와 남은 결함 수가 적힌 원문만 근거로 새로 쓴다. 다시 만듦 |
| D-7 | 워커 감시·PR 감시·멘션 감시 자동화(자체 받은 편지함 감시 포함) | monitor(orca-monitor·pr-monitor·chat-monitor, plugin worker 타이머) | 자동화 등록 대신 worker 타이머가 돌고 받은 편지함 감시는 Orca 메시지 조회가 대신한다. 다시 만듦 |
| D-8 | 순회(patrol) 자동화 | queue-monitor(plugin worker 타이머) | 순회가 하던 항목·결정 점검을 `ready` 뷰·`escalation_stale` 점검으로 새로 쓴다. 다시 만듦 |
| D-9 | 정리·압박 자동화와 `reap-resources`, 압박 게이트 | REAPER + resource-monitor | REAPER는 끝난 일이 남긴 자원(삭제 전 안전 검사를 거친 worktree·기록된 Docker 자원·고아)을 치운다. 끝났는지는 PR 상태·항목 완료·취소·대체·`worker_done` 으로만 판정하고 잠잠함은 기준이 아니다(결정 82). 라운드는 표시 → 정리 두 단계이고 이벤트는 힌트다(결정 83). 다시 만듦 |
| D-10 | 대시보드 서버와 12페이지(`O/dash.py`) | Orca plugin 패널 셋 | 패널이 같은 읽기 뷰를 그리고 서버·포트가 사라진다. 웹 대시보드는 없다. 다시 만듦 |
| D-11 | Claude Code 화면의 브리프 패널·밴드(UI mod, `brief_pane.tsx`) | Orca plugin 패널(hallmark 시안, 결정 92)과 상태 표시줄 항목(건수 줄의 짧은 꼴) | 같은 현황을 패널이 보인다. 다시 만듦 |
| D-12 | `brief` 스킬 | `sangsoe brief` 세 단계 | 쭉 나열하던 형식 대신 1단계는 표 네 절(결정 89), 이어서 묶음 상세 → 항목 상세로 새로 쓴다. 다시 만듦 |
| D-13 | 과거 기록과 설치·점검·reflect | 설치·점검·reflect를 새로 쓰고, 열린 항목·열린 결정만 읽기 전용으로 이관 | 닫힌 기록은 가져오지 않는다. 다시 만듦 |

## 2. 이관 분류표

### 2.0 분류 정의 (여기서 한 번만 정의한다)

| 분류 | 뜻 | 표에 적는 것 |
|---|---|---|
| 참조해서 새로 씀 | sangsoe에도 같은 일을 하는 부품이 필요하다. 옛 코드는 옮기지 않고 새로 쓰되, 사고로 생긴 규칙·함정·시험 사례는 명세로 가져온다 | 참조하는 것 · 두고 오는 것(옛 개념에 묶인 구조)과 이유 · 다시 쓸 시험 명세 · 모듈 |
| 참조 안 함 | sangsoe 구조(항목·결정·뷰)가 같은 일을 하거나, 일회성 이행 코드이거나, 죽은 코드다. 코드도 시험도 가져가지 않는다 | 이유 · 남기는 규칙(있을 때만) |
| 별도 plugin | sangsoe 본체의 일이 아니다. 본체는 이 항목의 내용을 참조하지 않고, 가는 곳과 가져가는 것만 정한다. 가져오는 방식은 그 저장소의 일이다 | 가는 곳 · 가져가는 것 · 시험·평가 |
| 개념만 | 코드와 시험 없이 규칙 한 문장만 sangsoe 설계·브리프·시험의 문장으로 들어간다 | sangsoe에서의 자리 |

판정은 옛 분류를 이름만 바꿔 옮긴 것이 아니라 항목마다 설계에 비춰 다시 한 것이다. 인벤토리가 가져가라고 했어도 sangsoe 구조에서 필요가 없으면 "참조 안 함"이고, 한 줄 이유를 적었다.

### 2.1 참조해서 새로 씀 (84)

#### 저장·등록·CLI 본체

| 항목 | 참조하는 것 | 두고 오는 것 · 이유 | 다시 쓸 시험 명세 | 모듈 |
|---|---|---|---|---|
| `store.py` | 표마다 사고가 걸린 불변식: 번호를 다시 쓰지 않는 `counter`, 닫힘이 세 군데서 따로 기록되던 문제(→ 닫힘은 Orca Task 의 `completed` 한 곳이고 이력은 `item_transition`), 이행 때 백업+해시 | 3.3k줄 단일 모듈, 항목·결정을 가변 표로 고치는 구조, 외부 데이터를 복사한 표 전부(4절). sangsoe 쪽 정본은 `event` 하나이고 나머지는 뷰다 | `O/test_store.py`, `O/test_store_board.py`, `O/test_state.py`를 뷰 질의 시험으로 다시 쓴다 | 코어 |
| `registry.py` | "모든 데이터는 위치와 쓰는 쪽이 한 장에 있고 CI가 코드와 대조한다"는 규칙, `check`가 exit 0이어야 한다는 시험 | 파일·표 저장소 항목 전부(대부분 sangsoe에 없다). sangsoe는 부록 `#files`의 짧은 목록과 `#data-ownership-detail`의 원본 표가 대신한다 | `O/test_registry.py`(check exit 0 규칙) | 코어 |
| `O/prog.py` | 모든 명령이 `--help`와 모르는 인자에서 무부작용이어야 한다(#629), 알 수 없는 명령은 틀린 점과 맞는 형태를 첫 줄에 보인다(#596) | 프로그램 원장 파일(`ledger.jsonl`·`program.json`). 프로그램은 리드 항목과 `event`다 | `O/test_prog.py`, `O/test_orch_commands.py`, `O/test_set_run.py` | 코어 |
| `O/handoff.py` | 재시작 인계에서 `--key` 없이 오케스트레이터 키를 덮어쓰지 못한다(#501, #618) | 옛 인계 파일 형식 | `O/test_handoff.py` | 코어 |
| `O/orca_settings.py` | Orca 설정·버전을 읽고 어긋나면 알린다. 기대하는 Orca 동작(응답 모양·`worker-list` 키 이름·`check --wait` 재연결)을 버전이 바뀔 때 시험한다(#631, PR #299) | 옛 호환 경로(#422). 하한 미만이면 시작을 거부한다 | `O/test_orca_settings.py`, 응답 모양 고정은 `O/testdata/worker-list-concise.json`·`worker-list-full.json`의 두 모양을 명세로 | 기반 |

#### hook·게이트

| 항목 | 참조하는 것 | 두고 오는 것 · 이유 | 다시 쓸 시험 명세 | 모듈 |
|---|---|---|---|---|
| `H/dispatch.py` | 이벤트당 프로세스 하나로 모듈을 돌리고, 모듈 하나가 죽어도 그 출력만 잃는 구조(#413). 결과는 deny > ask > allow, 차단 사유는 전부 보존 | 옛 hook별 개별 프로세스 시절의 설정 | `H/test_dispatch.py`를 합치기 규칙 표 시험으로 | 코어 |
| `H/guard.py` | 남의 메시지 읽기(소비하는 `check`) 거부, 위험 명령, 작업 규율. 사고 사례: `$`가 든 heredoc 구분자(읽지 않음), 큰따옴표 안 산술식, 변수 확장과 `cd` 뒤 실행(#478), verdict 허용 되돌리기(#556) | 브리프의 옛 닫기·유지·판정식 규칙(→ `worker_done`과 완료 조건). 이유를 밝힌 거부 메시지가 고쳐 쓸 명령을 함께 준다(#620) | `H/test_guard.py`, `H/test_coordination.py` | 코어 |
| `H/lib/danger.py` | 데이터 유실·비밀 노출·설정 완화 명령 검사. 오탐 수정 사례가 시험에 쌓여 있다(#557 작업 폴더 아래 임시 대상 검증 실행). 하한선 거부(기본 브랜치 강제 푸시·보호 규칙 쓰기·범위 밖 삭제·휴지통 비우기)는 항목별 시험(#466) | 규칙 목록의 옛 설정 키 | `H/test_danger.py`(오탐 모음의 시작점, #620) | 코어 |
| `H/lib/coordination.py` | 역할 세션이 사람에게 직접 묻는 도구를 쓰지 못한다·기다릴 때의 규칙 | 옛 역할 이름 | `H/test_coordination.py` | 코어 |
| `H/lib/shell.py` | Bash를 bash처럼 읽는 파서. 오탐 수정이 많이 걸린 곳이다 | 파서 구조를 그대로 두지 않고 시험 사례로만 이어받는다 | `H/test_guard.py`(파서 사례 포함) | 코어 |
| `H/delegate_gate.py` | 오케스트레이터가 조율 밖 도구를 못 쓴다. 긴 메시지 본문을 파일로 써서 보내는 정상 경로는 막지 않는다(PR #135) | 옛 카드 이름 | `H/test_delegate_gate.py` | 코어 |
| `H/claim_check.py` | 마지막 수정 뒤 실행 없이 한 "고쳤다·통과" 주장을 한 번 막는다 | — | `H/test_claim_check.py` | 코어 |
| `H/lib/discipline.py` | 워커 규율 6개 검사(Bash로 파일 쓰기 금지 등). 부분 문자열 오탐(`'/tmp'`, `print('pytest')`)은 신규 사례로 고정(#620) | 카드 단위 어휘 → 워커 | `H/test_discipline.py` | 코어 |
| `H/turn_check.py` | 턴 종료 점검(전부 경고) | 카드 → 워커 | `H/test_turn_check.py` | 코어 |
| `H/owner_check.py` | 최종 답이 오너만 할 일을 말했는데 기록이 없으면 경고, "왜 오너만 가능한지"를 요구(#630) | — | `H/test_owner_check.py` | 코어 |
| `H/decision.py` | 터미널에서 한 답이 열린 결정을 닫는다. 답은 `owner_action`으로 쌓이고 압축·재시작 뒤에도 다시 쓴다(#621) | 옛 결정 파일 형식 | `H/test_decision.py`(결정 루프 회귀 시나리오 열하나의 명세: 결정 루프 넷 + 결정 91 의 `decision_moot_closed`·`late_answer_reaches_next_worker`·`owner_act_unlinked_expires`·`owner_item_probe_closes`. `waiting_human_released` 는 `H/test_permission.py`, 나머지 둘은 `H/test_owner_input.py`) | 코어 |
| `H/decision_relay.py` | 오너 말을 중계했는데 결정 기록이 없으면 경고 | 오케스트레이터 기억에 의존하던 닫기(→ `decision_answer` 함수와 Orca 게이트) | `H/test_decision_relay.py` | 코어 |
| `H/subagent_log.py` | 서브에이전트 시작·종료를 기록 | 파일 로그 → `event` | `H/test_subagent_log.py` | 코어 |
| `H/reorient.py` | 세션 시작 재부착. `/clear` 뒤에도 같은 Orca 메시지 경로로 대기를 다시 붙이고(#485), 압축 뒤 오너 답을 다시 싣는다 | 파일 기반 역할 기록(`roles/*.json`) → `session_started` | `H/test_reorient.py`(stream이 있으면 조용·없으면 안내·역할 없는 세션엔 아무것도 없음) | 코어 |
| `H/roles.py` | 역할 판정 한 곳. `ROLE: none` 한 줄이 모든 역할을 끄는 계약은 전환 전에 agent-skills가 켜진 PC에서 sangsoe 세션을 시험할 때의 방벽이다 | 옛 `MATRIX`의 카드 규칙 | `H/test_roles.py` 4번 사례(`--agent`·리드 브리프·Dispatch 머리말) | 코어 |
| `H/lifecycle.py` | 종료 순서(`worker_done` 전 `worktree rm` 금지), 서브에이전트에게 거부 문단을 통째로 주입 | Dispatch 없는 세션용 `--type question` 절(삭제) | `H/test_lifecycle.py`, `H/test_refusal_retry.py` | 코어 |
| `H/record_check.py` | PR 열기·머지·`worker_done`에 기록 줄이 없으면 경고 | 기록 대상이 파일 → `event` | `H/test_record_check.py` | 랜드 |
| `H/lib/skillload.py` | 배포 절차 스킬을 로드하기 전 수정하면 경고 | 카드 → 워커 | `H/test_skillload.py` | 랜드 |
| `H/self_land_gate.py` | 자기가 연 PR이 열려 있는데 land 요청(`land_requested`: 예약 또는 `merge_on_approval`) 없이 끝나지 못하게 한다. 머지를 예약했거나 "승인되면 머지"를 남겼으면 끝낼 수 있다 | 옛 `orch land` 이름 | `H/test_self_land_gate.py` | 랜드 |
| `H/land_route_gate.py` | `gh pr merge` 직접 호출을 `sangsoe land` 하나로 돌린다 | 부록 `#gates`가 이 게이트를 자기 머지 게이트 칸에 합쳤으므로 hook은 하나로 쓴다 | `H/test_land_route_gate.py` | 랜드 |
| `H/stack_gate.py` | 다른 열린 PR에 의존하는 PR 생성을 스택으로 돌린다 | 스택 자체를 만드는 일은 스택 도구에 맡긴다(결정 31). sangsoe는 `stacked_on` 간선과 검사만 가진다 | `H/test_stack_gate.py` | 랜드 |
| `H/pressure_gate.py` | 부하 경고·위험일 때 무거운 시작을 거부하고 기다릴 순서를 알린다. 사고 사례: 호출 세션 자신의 턴을 세던 문제(#379), 셀 수 없는 턴 수를 통과로 읽던 문제(#367), hook·check·round가 따로 판정하던 문제(#233) | 판정이 따로이던 구조. 게이트와 queue-monitor가 같은 함수를 부르게 한다(#625) | `H/test_pressure_gate.py` | 정리 |
| `H/permission.py` | 권한 프롬프트 한 건 = `waiting_human` 한 줄. 풀림은 버튼·같은 도구의 실행·턴 종료·`agentWait` 해제 중 먼저 보인 신호(오너의 말만으로는 풀지 않고 표지만 단다)가 `waiting_released`(by: owner·button·unknown) 한 줄로 남기고, 세션이 끝나면 `moot`, `waiting.lead_minutes` 안에 안 풀리면 queue-monitor 가 `escalation_stale` 로 올린다(결정 91 ①) | 승인·거부는 패널 버튼이 같은 함수를 부른다 | `H/test_permission.py`(`waiting_human_released`) | 패널 |
| `H/owner_input.py` | 오너의 `!` 입력을 `transcript_path` 로 읽어 열린 오너 항목의 `cmd_hint` 에 잇고(`owner_act:seen`) 표지 `입력 확인됨 · 검증 중` 만 단다. 어느 항목에도 안 맞는 감시 명령은 `owner_act_unlinked` 로 쓰고 실패한 명령은 `owner_act:failed` 를 붙인다(결정 92: 읽고 쓰는 쪽은 pr-monitor 가 아니라 이 hook). 입력만으로 상태를 바꾸지 않고, 형식이 문서에 없어 못 읽으면 행동 0 이다(P13, 결정 91 ⑥) | 없음(옛 설계는 오너 입력을 채팅 `UserPromptSubmit` 만 읽었고 채팅 한 줄이 항목을 닫을 수 있었다) | `H/test_owner_input.py`(`owner_ran_command_marks_verifying`, `owner_input_probe_fails_no_change`) | 코어 |

#### 역할·세션·알림

| 항목 | 참조하는 것 | 두고 오는 것 · 이유 | 다시 쓸 시험 명세 | 모듈 |
|---|---|---|---|---|
| `orchestrate` 스킬 | 판단 절차(분류·배치·위임)만 남기고, 기계가 강제할 수 있는 규칙은 스킬 문장에서 뺀다(#616). 사고 사례: 거부 문단 복사본이 어긋나던 문제 | 용어 정의(→ `glossary.md` 한 파일), 상태 설명 문단 | `O/test_refs.py`, `O/test_wait_rule.py`, `O/test_refusal_copies.py`, `evals/`의 orchestrate 사례 | 코어 |
| `agents/orchestrator.md` | Orca 메시지로만 깨운다, `/goal`을 걸지 않는다, 직접 일하지 않는다 | `agent-skills:orchestrator` 이름·옛 MODE 줄 | `H/test_roles.py`, `H/test_reorient.py` | 코어 |
| `agents/lead.md` | 리드의 완료 조건을 시작 전에 적는다, `/goal`과 프로필 | MODE·DELEGATE·PREDICATE | `H/test_roles.py`, `H/test_lifecycle.py` | 코어 |
| `dispatch-card` | 워커 시작 절차: 모든 워커에 Dispatch가 있다 | `card`라는 이름과 표시 이름·nudge | `evals/`의 dispatch-card 사례 | 코어 |
| `S/card.py` | `worker-start --model --effort`로 시작, `/goal`은 첫 턴 뒤에 따로 입력(#371), 붙여넣기로 접힌 `/goal`을 다시 침(#409), 역할 줄 없는 리드 모양 브리프 거부(#541), 터미널 surface로 시작(#577). `worker-start`에는 surface 옵션이 없으므로 sangsoe는 시작 전에 중첩 워커 깊이 설정을 읽는다(결정 59). 대체 시작은 없다: `worker-start`가 Dispatch 있는 세션을 열지 못하면 시작을 거부해 `signal`(`start_refused`)을 남기고 부모에게 올리며, `agent launch`는 쓰지 않는다(결정 94로 갱신) | 카드 행 | `S/test_card.py`, `O/test_card_rows.py`를 워커 이름으로 다시 쓴다. 시험이 `card.py goal-after-idle` 고아 프로세스를 남기지 않게 실제 분리 프로세스 띄우기는 대체하고 시험 뒤 프로세스 잔재 0을 가드로 단언한다(중단 작업) | 코어 |
| `S/sync.py` | 체크아웃 갱신과 실행 중 세션 reload 방송. 종료 코드의 뜻을 문서·시험으로 고정(#415), 받을 수 있는 세션만 골라 보내고 재시도에 backoff(#415·#602) | 카드 nudge, 입력창 draft 판정(#605 계열: 자동완성 추천을 입력 초안으로 오인) | `S/test_sync.py` | 코어 |
| `end-session` | 기록·정리 확인 | 카드 닫기·유지 지시(→ `worker_done`) | `evals/`의 end-session 사례 | 코어 |
| `S/end_check.py` | 끝나도 되는지 실제 출력으로 판정 | — | `S/test_end_check.py` | 코어 |
| `O/inbox_stream.py` | 받는 순서(워커 → 소유 리드 → 오케스트레이터)를 Orca 주소로 표현하는 `notify`, 한 받는 쪽에 소비자 하나, 다른 세션의 대기를 끝내거나 갈아 끼우지 못함, 잘림·수신자 없음은 보낸 쪽 실패(#618) | 자체 받은 편지함 뷰(`sangsoe inbox --stream`)와 파일 기반 소비자 잠금(`inbox-stream/*.lock`): 메시지는 Orca가 나른다 | `O/test_inbox_stream.py`, `O/test_inbox_sources.py` | 코어 |

#### 랜드·전달 (land 판정 함수와 land 요청, deliver-ticket)

| 항목 | 참조하는 것 | 두고 오는 것 · 이유 | 다시 쓸 시험 명세 | 모듈 |
|---|---|---|---|---|
| `O/land_exec.py` | 모델 없이 머지. 사고 사례: 거부할 증거 댓글 부재를 사전 확인도 보류로 낸다(#590), 안내 문구가 약속하지 않은 판정 승계(#589), 거부·보류 PR이 독점 구간을 바로 놓는다(#566) | 상주 실행기로 쓰지 않는다(결정 72). 입구는 `sangsoe land <pr>`(land 요청) 하나이고 PR을 만든 워커·리드가 부른다. 저장소 설정이 자동 머지 조건 넷을 만족할 때만 머지를 예약(`gh pr merge --auto`)하고, 아니면 승인되면 리드가 머지한다(결정 81). 프로그램 단위 원장 대신 저장소 단위 `land_*` event로 | `O/test_land_exec.py` | 랜드 |
| `O/landjudge.py` | 한 PR의 판정 순수 함수. 규칙: Act-on이 남은 pass는 fail, tree가 바뀌면 다른 계열 판정(PR #615), 리뷰 근거는 head sha와 남은 결함 수가 있는 원문뿐(#622), 작성자·리뷰어·증거·기록자 네 칸(#469, #544, #567), 리뷰하지 못한 실행은 pass가 아님(PR #21). 다섯째 점검으로 검증 등급(V0~V3)의 증거를 읽는다: 등급이 요구하는 `kind`가 그 head의 `evidence`에 모두 있고 `exit_code`가 0이며 `not_verified`가 채워져 있어야 하고, 아니면 `land_failed`(`evidence_missing`)이다. 등급 계산 `verify_tier`는 같은 모듈의 순수 함수이고 CLI `sangsoe verify-tier <pr>`로 읽는다 | 판정을 읽는 곳이 여럿이던 구조. 모든 호출자가 같은 함수를 부른다(#622, #552, #568). 코멘트가 아니라 `evidence`를 읽는다 | `O/test_landjudge.py`, `O/test_land.py`, 새 시험 `O/test_verify_tier.py`(경로 패턴 표 시험 · 애매하면 상위 등급 · 라벨 올리기·내리기(`owners`) · `protected_paths`는 V3 아래로 내리지 못함 · 증거 점검 `evidence_missing`) | 랜드 |
| `O/land_scope.py` | land 요청이 덮는 저장소 범위 | 손으로 맞추던 저장소 목록. GitHub의 현재 이름으로 판정(#532) | `O/test_land_scope.py` | 랜드 |
| `O/ci_wait.py` | 같은 CI·PR을 여러 세션이 따로 보지 않는다(#414), 취소·대체된 run과 재실행으로 초록이 된 run을 따로 센다(#623) | 파일 상태(`ci-wait/*.json`). 이미 본 응답은 `gh_seen`, 실패는 `ci_failed`(4절) | `O/test_ci_wait.py` | 랜드 |
| `O/stacks.py` | 스택 상태와 순서. 맨 아래 PR이 어떤 경로로도 못 들어가던 문제(#498) | 스택을 쌓는 일은 스택 도구가 한다. sangsoe는 `stacked_on` 간선을 읽는다 | `O/test_stacks.py`, `O/test_stack_chain.py` | 랜드 |
| `deliver-ticket` | 첫 수정부터 PR·리뷰·머지·검증까지의 절차 | `orch` 호출 → `sangsoe` 명령, 티켓·카드 어휘 | `evals/`의 deliver-ticket 사례 | 랜드 |
| `D/review_pick.py` | 독립 리뷰어 선택(변경 파일만 받고 작성자 결론은 받지 않는다) | — | `D/test_review_pick.py` | 랜드 |
| `D/shots.py` | 스크린샷 캡처·업로드. 새 댓글 UI에 맞춘 upload와 비공개 저장소 403을 판정 불가로 보는 사고 사례(#608). V3(화면 변경)의 화면 증거(GIF·스크린샷)를 만든다 | 증거 폴더 장부 행 → 항목에 붙은 `evidence` event(#561). 업로드를 확인할 수 없으면 통과가 아니라 판정 불가 | `D/test_shots.py` | 랜드 |
| `D/sticky-comment.sh` | 시험 결과를 PR 댓글 하나로 갱신 | — | `D/test_sticky_comment.py` | 랜드 |

#### REAPER·부하

| 항목 | 참조하는 것 | 두고 오는 것 · 이유 | 다시 쓸 시험 명세 | 모듈 |
|---|---|---|---|---|
| `R/pressure.py` | 부하 표본·수준·대기 순서. 사고 사례: 컨테이너 상한을 pod 단위로 세고 상시 서비스를 뺀다(#162), 턴 수를 셀 수 없으면 통과가 아니다(#367), 상한이 보존 기간 안의 기록을 지웠다(PR #607) | 파일 기반 대기 순서 파일. 압박 기록은 8일·4MB 보조 로그이고 수준 변화는 `pressure_high`·`capacity_free`로 | `R/test_pressure.py`에 "상한을 넘겨도 보존 기간 안은 지우지 않는다" 사례를 더한다 | 정리 |
| `R/reap.py` | 정리 대상 목록화·판정·정리. 사고 사례: 거부된 `worktree rm`은 다시 지우지 않고 사람에게 넘김(#380), Orca가 스스로 해제할 워커는 제외(#433), `/proc` 같은 호스트 상태 주입(PR #614, #624) | 카드 장부, 정리 대상 인벤토리 파일. 새 REAPER 단위(결정 83)는 표시와 정리를 두 함수로 나누고 이벤트로 구동되는 정리 경로를 두지 않는다 | `R/test_reap.py`(옛 CI는 이 시험을 제외했다. sangsoe CI는 포함)에 새로 쓰는 시험을 더한다: 표시·정리 분리(표시만으로 지우지 않는다) · 두 라운드 재확인(첫 라운드에는 지우지 않는다) · 루트 읽기가 하나라도 실패하면 그 라운드는 정리하지 않는다(`roots_ok` 거짓) · 모름은 보고만 · 끝남이 확정되지 않은 후보는 지우지 않는다 · 단일 실행 잠금(동시 라운드 금지, 힌트 디바운스) · 힌트가 정리하지 않는다 · 압박은 후보를 넓히지 않고 유예만 하한까지 줄인다 · `timer_stalled` 는 `trigger` = `timer` 인 라운드만 보고, `roots_ok` 거짓인 라운드가 연속 3회일 때도 쓴다 · `worktree rm` 은 `--run-hooks --delete-branch` 로 `--force` 와 `--allow-failed-archive-hook` 없이 부르고(결정 86), 훅 실패(`worktree_archive_hook_failed`)는 `reap_blocked`(`archive_hook_failed`)로 남기며, `rm` 이 성공한 뒤에만 남은 기록 id 에 Docker 규칙을 적용한다 · 메인 체크아웃은 행의 `isMainWorktree` 로 건너뛴다 · 행의 `hostId` 가 `local` 이 아니거나 비었거나 오지 않으면 후보·대상·편입이 아니고 `reap_blocked`(`remote_host`)를 카드마다 한 번만 남기며 모름으로 센다(결정 88, R4·`ports` 가 원격 행에 닿지 않는 픽스처 포함). 유예·최소 간격 값, `task-list` 의 Run 범위, `gh` 한도, archive hook 의 동작(시험 P6)은 구현 때 실측한다 | 정리 |
| `R/guard.py` | 지우기 직전 잠금·가드. REAPER가 지우기 전에 반드시 지난다 | — | `R/test_guard.py` | 정리 |
| `R/cards.py` | 끝난 워커 정리 판정 `judge`. scan과 apply가 같은 판정을 쓴다(#372). 판정표에서 가져오는 것: 변경(추적 안 된 파일 포함)은 남김, 원격에 없는 커밋은 남기되 메시지만 같고 패치가 다르면 사람에게(`unpushed`·`unpushed_other_patch`), 머지·닫힘 PR이 HEAD를 실었으면 삭제, 낡은 `origin/HEAD`는 GitHub에 다시 물음, 방금 만든 카드는 커밋이 생기기 전까지 남김, `rm` 거부는 다시 지우지 않고 사람에게 | `card`·`parked` 이름. 터미널 idle·화면 문구로 닫는 규칙(터미널 정리는 Orca의 몫이라 가져오지 않는다)과 시간 기준(`idle_minutes`·`stale_hours`)은 끝남 판정이 아니라서 두고 온다 | `R/test_cards.py`(PR이 HEAD를 실은 경우·낡은 `origin/HEAD`·패치 불일치 사례) | 정리 |
| `R/cardguard.py` | 닫기 직전 잠금 | — | `R/test_cardguard.py`(사용량 읽기 EACCES를 이유로 지우지 않고 원인을 확인한다 사례를 더함, #627) | 정리 |
| `reap-resources` 스킬 | REAPER·resource-monitor 호출 절차만. Docker 자원은 기록한 id 로만 치운다는 규칙의 근거 | 정리 규칙 문장(기계가 강제), 라벨·패턴으로 고르는 정리 | `R/test_cards.py`, `R/test_cardguard.py` | 정리 |
| `S/reap_hard.py` | 모델 없이 고정 규칙으로 닫는 일을 REAPER가 받는다. REAPER는 자원만 닫고 항목은 닫지 않는다 | dry-run 계획 파일(`reap-hard.jsonl`), 후보 인벤토리 | `S/test_reap_hard.py` | 정리 |
| `R/rm_refused.py` | `rm` 거부를 한 줄로 남긴다 | 파일 로그 → `reap_blocked` event | 신규(거부 → `reap_blocked`, archive hook 실패 포함: 결정 86) | 정리 |

#### 감지기

queue-monitor 최소 라운드(`escalation_stale`·`close_suggested`·`item_ready`와 `sangsoe graph sync` 호출)는 코어 모듈에 들어가고, 이 표의 나머지 감지는 감지기 모듈이다(결정 69).

| 항목 | 참조하는 것 | 두고 오는 것 · 이유 | 다시 쓸 시험 명세 | 모듈 |
|---|---|---|---|---|
| `O/card_watch.py` | 화면 글자가 아니라 구조 신호로 판정, 판정 못 하면 행동 0이다(⚠️도 `worker_stuck`도 쓰지 않는다. ⚠️는 `trigger_unclear` 하나, `worker_stuck`은 멈춘 워커 하나, 결정 39). 사고 사례: 오래된 setup 로그·구조화 세션 핸들·대기 중 리드의 STUCK 오탐(#601), "a full disk" 화면 문구만으로 판정(#591·#592), goal을 채우고 쉬는 리드를 'goal lost'로 오탐(#539), 구조화 세션 시작 실패(#571, `worker_dead`의 reason `start_failed`), 화면 읽기는 줄 수·횟수 제한(#424) | 화면 읽기가 주 신호이던 구조, 표시 이름 붙은 워커를 늘 busy로 보던 제목 판정(#536). 워커 생존은 세션 id로 판정하고 터미널은 참조로만 둔다. 멈춤의 "마지막 활동"은 sangsoe 가 재지 않고 `worktree ps --json` 의 시각 필드(`lastOutputAt`·`lastActivityAt`, 에이전트 행의 `stateStartedAt`)에서 읽는다(결정 87). 그래서 라운드마다 변화를 비교해 `observed_change` 를 쓰는 옛 구조는 옮기지 않고, 시험 P10 이 필드 뜻을 틀렸다고 하면 그때만 대체 경로로 되살린다 | `O/test_card_watch.py`에 자동완성 추천·`a full disk` 오탐 사례를 더한다. 시각 필드 값만으로 `worker_stuck` 을 판정하는 사례(최근 출력이면 아님, 오래됐고 working 이면 멈춤, 필드가 비면 행동 0)를 더하고, 첫 빌드의 시험 P10 이 실제 Orca 에서 필드 뜻을 잰다 | 감지기 (생존 판정 함수는 코어) |
| `watch-prs` (`prs.py`·`notify.py`) | 알림을 공용 클라이언트로 한 번, 바뀐 PR만 코멘트 diff, 코멘트 id로 중복 제거, `If-Modified-Since`·ETag, 사람 대기 중 PR 읽기는 묶어서(#75), 손으로 적은 send-log와 5xx에 정지하지 않기(#87) | 파일 상태(`prs/*`), 폴링 기본값, `send_log`(4절) | `skills/watch-prs/scripts/test_prs.py`, `test_notify.py`, `test_review_wait.py` | 감지기 (PR 사실 감지는 코어) |
| `watch-mentions` | 새 멘션·내 스레드 답글을 처음 보는 것인가 판정 | 파일 커서(`mentions/*.json`) → `gh_seen` 계열 표. 트리아지 스킬 하나로 합친다 | `skills/watch-mentions/scripts/test_mentions.py` | 감지기 |
| `O/pr_watch.py` | PR 감시 로직. 할 일이 생기는 전이에만 출력(#497) | `D/prs.json` 스냅샷 | `O/test_pr_watch.py` | 감지기 |
| `S/automations.py` | 등록과 정의의 어긋남을 찾아 제자리에서 맞춤(#583), 등록된 job의 gate를 시험이 실제로 패치(PR #613), 자동화마다 목적·마지막 사용·비용·끄는 명령 한 목록(#626). Orca 자동화는 T2 대체 경로에만 남으므로(결정 75·84②) 그때만 의미가 있다 | `agent-skills.json` 키 기반 자동화 목록 | `S/test_automations.py`(PR #613 반영) | 감지기 |
| `O/jobs.py` | 자동 작업 목록 | 화면의 job 행 → queue-monitor 목록(plugin worker 타이머) | `O/test_jobs.py` | 감지기 |
| `O/model_drift.py` | 역할 모델과 실제 모델의 어긋남을 알린다 | 파일 기반 모델 기록 → `session_started`의 `{model, effort}` | `O/test_model_drift.py` | 감지기 |
| `S/orca_job.py` | Orca 자동화 precheck 안에서 주기 작업을 돌리고 결과를 event로 쓴다. 한 번의 precheck 안 단계로 나눠 시간 초과를 피한다(#594). sangsoe 에서는 T2 가 실패할 때의 대체 경로로만 참조한다(결정 84②) | 자체 주기 실행기(LaunchAgent·cron) | `S/test_orca_job.py` | 코어(최소 라운드)·감지기 |

#### 현황·패널

| 항목 | 참조하는 것 | 두고 오는 것 · 이유 | 다시 쓸 시험 명세 | 모듈 |
|---|---|---|---|---|
| `brief` 스킬 (결정 89) | **가져오는 것**: 보고는 사람이 쓰지 않고 렌더러 출력을 그대로 보낸다는 규칙(모델은 판단 한 문장만), 표 폭 78칸 계산(`table_width.py` 의 한글 2칸·셀 여백·링크는 라벨만), 행의 상태는 증거로 정하고 보고자가 고치지 않는다는 점, 오래된 결정 점검 | **바꾸는 것**: 불릿 줄·저장소별 작은 표·범례 인용구·"카드 없는 일"이 섞인 출력을 결정 필요 · 지금 오너가 할 일 · 진행 중 · 보류 네 절의 표(절마다 열 고정, 5열·78칸 이하, 넘는 칸은 `…` 로 자름)로 바꾼다. 리드와 그 아래 카드·PR·워커가 한 행씩이고 접지 않는다. 렌더러는 파이썬 `orch brief render` 가 아니라 코어의 `buildBrief`·`renderMarkdown` 이고 채팅(resource `brief`·skill·CLI)과 패널이 같은 `BriefModel` 을 쓴다. 결정 등록 인자(`--decision`)는 렌더 인자가 아니라 `decision_open` 이다 | `skills/brief/scripts/test_table_width.py` 는 골든 시험의 78칸 확인으로, `O/test_brief_order.py`·`O/test_brief_rows.py` 는 정렬·행 수 사례로 옮긴다. 새 시험은 `brief.golden.test.ts` | 코어(글)·패널(화면) |
| `O/stages.py` | 단계표의 머지·dev·prod 칸 | 별도 표 → `stage_recorded` event와 뷰. 생성 행의 머지 칸을 손으로 쓰지 못한다(#493) | `O/test_stages.py` | 패널 |
| `O/stage_auto.py` | 머지 증거를 원장·GitHub에서 읽는다(#208) | 자동 칸은 `pr_merged`·`land_requested` event에서 계산 | `O/test_stage_auto.py`, `O/test_stage_auto_title.py` | 패널 |
| `O/fleet.py` | 세션·PR·리뷰어·사람이 할 일 조인 | Orca·GitHub 스냅샷 파일(4절). 뷰와 패널 시안(`index.html`·`group.html`·`item.html`) | `O/test_fleet.py`, `O/test_fleet_views.py` | 패널 |
| `O/dash.py` | 읽기 전용 화면, 버튼은 CLI와 같은 함수 | 웹서버·포트·12페이지·그래프 그림. 화면은 Orca plugin 패널이 그리고 버튼은 `plugin.request`로 같은 함수를 부른다 | `O/test_dash.py`, `O/test_flow.py`의 화면 사례를 코어 뷰 질의와 패널 시험으로 | 패널 |
| `O/units.py` | 세션·PR·브리프 행 조인 | 행 조인 → 뷰(`group_items`) | `O/test_units.py` | 패널 |

#### 설치·reflect·저장소 위생

| 항목 | 참조하는 것 | 두고 오는 것 · 이유 | 다시 쓸 시험 명세 | 모듈 |
|---|---|---|---|---|
| `S/ci_forbidden_terms.py` | 금지어 검사. 목록은 저장소 밖. 공개 저장소이므로 첫날부터 켠다. 검사가 항상 통과하지 않고 실제로 실패함을 시험으로 고정(PR #378) | 목록 형식 | `S/test_ci.py` | 기반 |
| `S/ci_tests.py` | 시험 파일 단위 실행기. 처음부터 병렬·시간 상한(PR #612, #624), 제외된 시험과 재실행 flake를 숨기지 않고 세어 출력 | 단독 실행을 가정하던 시험 | `S/test_ci.py` | 기반 |
| `S/skill_tokens.py` | 플러그인이 세션에 싣는 정적 토큰 비용 측정, `skill_budget.json` 상한(#616) | — | `S/test_skill_tokens.py` | 기반 |
| `S/test_public_shapes.py` | 공개 저장소에 들어가면 안 되는 모양 검사 | 목록은 저장소 밖 | 자기 자신 | 기반 |
| `S/test_intent.py` | 내장 먼저: 옛 저장소는 LaunchAgent·자체 주기 실행기·상주 프로세스를 예외 표의 사유로 통과시켰다. sangsoe 는 예외 없이 금지하고(결정 176) 트리에 `.plist` 가 없는지만 본다(`test/layout.test.ts`) | 옛 예외 표의 항목 | 자기 자신 | 기반 |
| `S/test_script_modes.py` | 스크립트 실행 권한 구조 검사(#467) | — | 자기 자신 | 기반 |
| `S/test_allowed_tools.py` | 스킬 frontmatter의 allowed-tools 검사 | — | 자기 자신 | 설치 |
| `S/test_mcp_prefixes.py` | MCP 접두어 검사 | — | 자기 자신 | 설치 |
| `S/test_catalog_*` | 스킬 카탈로그의 범위·개수를 검사가 센다(손으로 맞추지 않음, #39). 번역본을 두지 않으면 최신 여부 시험은 필요 없다(R-22) | 번역본 기준 커밋 표시 | `S/test_catalog_coverage.py`, `S/test_catalog_stale.py`, `S/catalog/test_build.py` | 설치 |
| `setup-pc` | 다른 PC 설치·갱신(dry-run만, 적용은 사람). 설치 갱신이 오너가 지운 규칙을 되살리지 않는다(#458) | `agent-skills.json` 키 | `skills/setup-pc/scripts/test_setup_check.py` | 설치 |
| `skills-config` | 설정·권한 규칙 변경 스크립트를 만들어 주는 스킬(사람이 실행) | — | `skills/skills-config/scripts/test_config_emit.py` | 설치 |
| `H/onboard.py` | 설치만 하고 세팅 안 된 PC에서 설치 점검을 권한다 | — | `H/test_onboard.py` | 설치 |
| `S/setup.py` | 체크아웃을 live로 올리고 권장 설정·자동화를 켠다 | `agent-skills.json`·옛 자동화. 체크아웃 live 연결은 `sangsoe install`(결정 90)이 대신한다: 브루 트리를 `claude plugin marketplace add`·`install` 과 `orca plugin dev load` 로 등록하고 승인은 안내만 한다. 멱등 시험(두 번 돌려도 같은 상태)과 호스트 명령 호출 목록 시험을 새로 쓴다 | `S/test_setup.py`의 멱등 사례를 `sangsoe install` 시험으로 | 설치 |
| `S/bootstrap.py` | 한 PC 부트스트랩 | `brew install` + `sangsoe install` 두 명령으로 대체. `sangsoe doctor`(등록 위치·세 버전 일치·시작 점검)와 `sangsoe uninstall`(등록 되돌리기, sqlite 유지)을 같은 모듈에서 짓는다. 첫 빌드 시험 T6 이 경로 마켓플레이스·hook PATH·Orca 개발 폴더 유지를 닫는다 | `S/test_setup.py`(전용 시험 없음) → `doctor`·`uninstall` 시험을 새로 쓴다 | 설치 |
| `reflect` | 세 리뷰어 합성, 성과 측정은 event를 `{model, effort}`로 읽는다. 재실행으로 가려진 main 실패 집계(PR #609) | 파일 원장 | `skills/reflect/scripts/test_measure.py`, `test_reflect_round.py`, `test_lesson_ids.py`, `test_orchestrator_feedback.py` | 설치 |
| `O/skill_usage.py` | 스킬 사용 집계. 별도 plugin 결정의 증거 | 파일 원장·캐시(4절): 측정할 때 Claude Code 기록을 읽고 저장하지 않는다 | `O/test_skill_usage.py` | 설치 |

### 2.2 참조 안 함 (39)

| 항목 | 이유 | 남기는 규칙 |
|---|---|---|
| `board` | 항목(`item`) 하나로 합쳤다. 할 일·보류·진행은 상태 낱말이다 | 우선순위 사례는 항목 뷰 시험으로(`O/test_board_priority.py`가 명세) |
| `holds` | 시작의 유일성은 Orca Dispatch 가 지킨다(sangsoe 에는 잠금이 없다) | 이중 시작 거부는 시험 P3으로 |
| `order` | 오너 지시는 `owner_action` + `owner_class` + 항목이다 | — |
| `order_close` | sangsoe 는 항목을 닫지 않는다. PR 이 없는 항목은 Orca 가 받아들여진 `worker_done` 으로 닫고, PR 이 걸린 항목은 pr-monitor 가 머지 확인 뒤에 닫는다 | — |
| `tidy` | 닫기 제안만 하는 `close_suggested` 감지기로 대체(코어의 queue-monitor 최소 라운드) | — |
| `autowake` | 깨움은 Orca 메시지뿐이다 | — |
| `autoqueue` | 머지 차례는 머지 예약(`gh pr merge --auto`)과 저장소의 병합 대기열이 정한다 | — |
| `patrol` | monitor별 event가 대체한다. 화면 글자 판정 오탐의 원인이었다(#619) | — |
| `selfcheck` | 화면 자기 검증은 뷰 질의 시험이 대체 | — |
| `acks` | 받았다는 확인의 원본은 Orca 메시지의 읽음 표시다(sangsoe 에는 확인 기록이 없다) | — |
| `sent` | 보낸 메시지의 원본은 Orca 이고 sangsoe 는 `notified` 한 줄만 남긴다 | — |
| `ask` | 리뷰 의뢰는 항목과 막힘(리뷰어)이다. 일회성 가져오기는 필요 없다 | — |
| `rowstate` | 행 상태는 항목 상태 하나. 무엇을 기다리나는 🚧 막힘(누구)이다 | — |
| `reboot` | 세션 시작 hook이 재부착한다 | — |
| `measure-delivery` | reflect의 측정으로 합쳤다 | — |
| `cutover` | 일회성 이행 코드 | — |
| `orca_migrate` | 일회성 이행 코드 | — |
| `S/migrate.py` | 옛 설치 이행기 | — |
| `artifact_hooks_cutover` | 일회성 | — |
| `dash_demo` | 데모 데이터 | — |
| `agent_signal` | 보조 신호와 화면 신호의 비교용. 구조 신호가 정본이다 | — |
| `compactions` | 압축 판단은 event에서 다시 계산 | — |
| `turn_cost` | 턴 비용은 event에서 다시 계산(토큰 페이지는 없다, 필요하면 `sangsoe` 명령이 읽는다) | — |
| `token_usage` | 위와 같다 | — |
| `install_hint` | 은퇴한 no-op hook | — |
| `orchestrator_guard` | 은퇴한 no-op hook | — |
| `refusals` | 은퇴한 no-op hook. 거부 보고는 event로 쌓인다 | — |
| `request_log` | 은퇴한 no-op hook | — |
| `test_retired` | 은퇴 hook이 없으니 시험도 없다 | — |
| `brief_pane.tsx` | 세 단계 패널이 대체 | — |
| `clear_band.tsx` | 위와 같다 | — |
| `candidates.py` | 인벤토리는 가져가라 했으나 첫 단락이 "아무도 읽지 않는 후보 필드"이고 `patrol`·`sweep` 그림자 회차에 묶여 있다. REAPER는 대상을 `resource` event에서 읽는다 | 판정 규칙 이름(`card:landed`·`stack:gone`·`proc:listener`·`serve:dark`)은 `R/test_reap.py`·`S/test_reap_hard.py`의 사례로 이어진다 |
| `O/flow.py` | 데이터가 어디서 와 어디로 가는지 그리는 화면. 배선은 설계서가 정본이다 | — |
| `O/overlap_table.py` | 파일 겹침표. 겹침 판단은 리드가 `after` 간선으로 적는다 | — |
| `O/pr_stats.py` | PR 통계는 `event` 질의 | — |
| `O/mailbox_guard.py` | 옛 설치용 전환 shim | — |
| `R/sweep.py` | 그림자 회차 정리 스크립트. `candidates.py`와 같은 이유 | — |
| `R/auto_release.py` | 자동 풀기. Dispatch 가 끊기면 Orca Task 가 다시 `ready` 가 된다(부록 상태 대응표) | — |
| `H/mods.tsx` | UI mod 진입점. `brief_pane`·`clear_band`가 없으면 비어 있다 | — |

### 2.3 별도 plugin (28)

가는 곳은 둘이다. **general-skills**는 sangsoe의 역할·상태에 의존하지 않는 일반 스킬을 모아 본체와 같은 개인 계정 아래에 두는(결정 18, 74) 저장소 하나다. **sangsoe 밖**은 오너의 개인 설정(노트·티켓·권한·비밀 입력·프리뷰)에 묶여 있어 general-skills에도 넣지 않는다. 이 28행은 모두 다시 만든다(1절 표 D-1–D-4). 각 스킬은 자기 시험·`evals/`와 함께 간다.

| 항목 | 가는 곳 | 가져가는 것 | 시험·평가 |
|---|---|---|---|
| `principles` | general-skills | 이름 붙은 원칙 모음. sangsoe 설계가 이름으로 인용하는 `Work to an Exit Condition`·`Never block on the human`·`Prove it works` | `evals/`의 principles 사례 |
| `write-plainly` | general-skills | 산문 규칙과 `korean.md`·`english.md`, `prose_check` hook. sangsoe 문서도 이 규칙으로 쓴다 | `H/test_prose_check.py`, `evals/` |
| `prune-comments` | general-skills | diff 주석 정리 | `evals/` |
| `tdd` | general-skills | 실패하는 시험 먼저 | `evals/` |
| `architect` | general-skills | 설계 스케치 | `evals/` |
| `challenge` | general-skills | 파급 범위·적대적 심문 | `evals/` |
| `explain-code` | general-skills | 코드 설명 | `evals/` |
| `fan-out` | general-skills | 병렬 sweep·compete | `evals/` |
| `figure-it-out` | general-skills | 큰 이주의 플레이북 | `evals/` |
| `show-me-your-work` | general-skills | 결정 기록 TSV | `skills/show-me-your-work/scripts/test_log.py` |
| `write-skill` | general-skills | 스킬 쓰기 절차(`check.sh`·`eval_desc.sh`) | `skills/write-skill/scripts/test_write_skill_scripts.py` |
| `ui-review` | general-skills | 화면 측정 | `skills/ui-review/scripts/test_ui_measure.py` |
| `verification-skill` | general-skills | verify-* 스킬 작성·린트. 확인의 깊이는 이 스킬이 정하지 않고 sangsoe 의 검증 등급(V0~V3)이 정한다: V2 이상에서 verify-* 스킬로 실제로 돌린 출력이 증거가 된다 | `skills/verification-skill/scripts/test_verify_skill_lint.py` |
| `recall` | general-skills | 지난 세션에서 맥락 복원 | `evals/` |
| `use-notes` | sangsoe 밖 | 노트 저장소 라우팅. 지우지 않고 저장소 규칙의 아카이브로 옮기고, 위치가 없거나 이름이 겹치면 원본을 둔다(PR #611, R-21) | `evals/` |
| `use-tracker` | sangsoe 밖 | 티켓 도구 선택·스키마 | `skills/use-tracker/scripts/test_tracker.py` |
| `write-ticket` | sangsoe 밖 | 티켓 작성 규칙 | `evals/` |
| `notes-writer` | sangsoe 밖 | 노트 쓰기 위임 | `evals/` |
| `task-tracker` | sangsoe 밖 | 티켓 쓰기 위임 | `evals/` |
| `tracker_gate` | sangsoe 밖 | 티켓 도구 호출을 CLI로 돌리는 hook. 식별자 형식을 가정하지 않는다는 교훈(#578)은 hook 시험을 실제 값 모음으로 하라는 규칙으로 | `H/test_tracker_gate.py` |
| `tune-automode` | sangsoe 밖 | 거부된 행동을 허용하는 최소 규칙 스크립트. 거부 순환의 판정·적용·드리프트 검사(#441)를 여기서 키운다. sangsoe는 "모으기"만 뷰 질의로 한다 | `skills/tune-automode/scripts/test_automode_rule.py` |
| `secure-fill` | sangsoe 밖 | 키체인 비밀을 Touch ID 뒤 입력란에 넣는다 | `skills/secure-fill/scripts/test_secure_fill.py` |
| `artifact_*` | sangsoe 밖 (사용 증거를 보고 결정) | Artifact 백업·링크 hook 4개(`artifact_archive`·`artifact_links_stop`·`artifact_send_check`·`lib/artifact_links`) | `H/test_artifact_links.py` |
| `share_server` | sangsoe 밖 (사용 증거를 보고 결정) | 공유 폴더 서버. 예외 표에 올라 있던 계속 떠 있는 프로세스다 | `S/test_share_server.py` |
| `preview_watch` | sangsoe 밖 (사용 증거를 보고 결정) | 프리뷰 공개·회수. 회수 지연 상한은 그 도구에서 고친다(#417) | `S/test_preview_watch.py` |
| `pstack-sync` | sangsoe 밖 (사용 증거를 보고 결정) | `vendor/pstack` 동기화 스크립트 | `S/pstack-sync-test.sh` |
| `S/share-caddy` | sangsoe 밖 | `share_server`와 함께 간다 | `share_server` 행 |
| `evals` | 각 스킬과 함께 | 발동 평가 사례 약 70개. 스킬이 가는 곳으로 같이 간다 | 자기 자신 |

### 2.4 개념만 (9)

코드와 시험은 가져가지 않고 규칙 한 문장만 sangsoe로 넘어간다. 위치는 원본이다.

| 항목 | sangsoe에서의 자리 |
|---|---|
| 거부 문단 | 부록 `#delivery`의 거부 보고와 `#gates`의 거부 문단. 원본은 `refusals.md`·`brief.md`·`roles.md` 문단과 `lifecycle` 주입으로 여러 벌이었다. 한 벌로 줄이고 "거부 보고는 escalation이 아니다" |
| 내장 먼저 | 부록 `#gates` "내장 먼저". 원본은 옛 저장소의 의도 문서가 정한 Orca → Claude Code → 자체 스크립트 순서와 예외 표 |
| 완료 조건으로 일한다 | 리드가 프로그램 시작 전에 완료 조건과 미루는 것을 적는다. 원본은 `principles`의 `Work to an Exit Condition`과 `program.md` "완료 조건" |
| 부하 한도 | 한도 수치와 게이트 규칙. 풀어 주는 쪽과 막는 쪽이 한 기준을 쓴다(#625). 원본은 `docs/pressure.md` |
| 위임 게이트 | 오케스트레이터의 위임 규칙. 원본은 `orchestrate/references/top-level.md` |
| 오너를 막지 않는다 | `decision`이 추천을 함께 가진다. 답이 없어도 기본값을 적용하지 않고 escalation을 따라 올라가 끝에서 `owner_todo`에 남는다. 원본은 `orchestrate/references/owner-ask-gate.md` |
| 독립 리뷰 판정 | 리뷰 글은 검토한 head sha와 남은 결함 수가 적힌 원문만 근거, 다른 계열 규칙은 PR #615. 원본은 `landing.md` |
| 공개 저장소 위생 | 목록은 저장소 밖에 둔다. 원본은 `AGENTS.md`·`write-skill`의 공개 저장소 규칙 |
| 스킬 토큰 예산 | `skill_budget.json` 상한과 측정. 원본은 `S/skill_tokens.py` |

### 2.5 집계

| 분류 | 개수 | 구성 |
|---|---|---|
| 참조해서 새로 씀 | 84 | 2.1 표 행 수의 합: 저장·등록·CLI 5 · hook·게이트 23 · 역할·세션·알림 9 · 랜드·전달 9 · REAPER·부하 8 · 감지기 8 · 현황·패널 6 · 설치·reflect·위생 16 |
| 참조 안 함 | 39 | 2.2 표 행 수 |
| 별도 plugin | 28 | general-skills 14 · sangsoe 밖 14(`evals` 1 포함) |
| 개념만 | 9 | 2.4 표 행 수 |
| 합계 | 160 | 인벤토리 이름 135 + `origin/main`에서 보충한 25 |

## 3. 요구사항 표

`JeongJaeSoon/agent-skills`의 이슈 전체(69건: 열림 16·닫힘 53), 머지 없이 닫힌 PR 전체(27건), 중단 작업 인계 문서(4건)를 한 행씩 판정했다(합계 100). 열린 PR은 0건이다. 설계 위치는 `design.html`과 `design-appendix.html`의 앵커(`#signal-flow`·`#role-cards`·`#schema`·`#delivery`·`#gates`·`#profiles`·`#files`·`#dashboard-pages`·`#dependencies`·`#dependencies-detail`·`#data-ownership-detail`·`#decision-loop-detail`)로 적었다. "R-NN"은 3.5의 공통 요구 번호다. 반영 행은 설계 문장 끝의 `(#N)`·`(PR #N)` 표식으로 대응을 기계가 확인한다. 불필요 행은 한 줄 이유를, 나중 행은 다시 볼 trigger를 적었다.

### 3.1 이슈 열림 16건

| 출처 | 요지 | 판정 | 설계 위치 · trigger · 이유 | 모듈 |
|---|---|---|---|---|
| #616 | 기계가 확인할 규칙은 기계가 강제하고 스킬 문장은 짧게, 크기 상한 | 반영 | 부록 `#gates` 규칙은 기계가 강제한다 · R-01 | 기반 |
| #617 | 감독 계층 비용을 머지된 PR 한 건당 컨텍스트로 재고, 끊긴 단위가 한 말로 보이고, 워커 모델을 기록 | 반영 | 부록 `#signal-flow`·`#profiles` · R-19 | 감지기 |
| #618 | 잘림·수신자 없음은 보낸 쪽 실패, 받는 쪽 하나에 소비자 하나, 세션 격리 | 반영 | 부록 `#delivery` · R-08 | 코어 |
| #619 | 구조 신호가 정본, 판별 못 하면 행동하지 않고 보류 | 반영 | 부록 `#signal-flow`(판별 못 하면 행동 0, ⚠️ = `trigger_unclear` 하나) · R-07 | 감지기 |
| #620 | hook 오탐률·호출당 비용을 실제 명령 모음으로 재고, 거부는 고쳐 쓰는 방법과 함께 | 반영 | 부록 `#gates` hook 정확도와 비용 · R-09 | 코어 |
| #621 | 권한 결정은 한 곳, 거부 행동은 다른 경로로 재시도 금지, 오너 답은 압축 뒤에도 남음 | 반영 | 부록 `#delivery` 거부 보고 · `#schema` `owner_action` · R-10 | 코어 |
| #622 | 리뷰 근거는 head sha가 있는 원문만, 판정은 호출자와 무관하게 같음, head에서 돌린 증거 | 반영 | 부록 `#role-cards` land 판정 함수 · `#gates` · R-03·R-04 | 랜드 |
| #623 | 머지·main 기록은 저장소마다 하나, 재실행·취소 run 구분, 설정 정본 하나 | 반영 | 부록 `#schema` 저장소 단위 `land_*`·`main_*` · R-05 | 랜드 |
| #624 | 호스트 상태·시계 주입, CI 시간 상한, 제외·재실행 flake 공개, 시험의 부산물 정리 | 반영 | 부록 `#gates` CI와 시험 · R-11 | 기반 |
| #625 | 부하 판정은 한 기준, 풀어 준 작업을 같은 이유로 다시 막지 않음, 시간 상한은 일한 시간 | 반영 | 부록 `#gates` 부하 한도 · `#role-cards` 워커 · R-13 | 정리 |
| #626 | 자동화마다 목적·사용 증거·비용·끄는 명령, 할 일 없으면 모델 안 띄움, 임시 예외에 지울 조건 | 반영 | 부록 `#signal-flow` · R-18 | 감지기 |
| #627 | 만든 자원은 기록하고 그 기록으로만 치움, 자기 프로세스만 끝냄, 목록이 비면 지우지 않음 | 반영 | 부록 `#role-cards` REAPER · `#schema` `resource` · R-12 | 정리 |
| #628 | 항목은 담당·원문·끝나는 조건(명령 하나)을 함께, 한 항목에 한 문제 | 반영 | 부록 `#schema` `item` · R-14 | 코어 |
| #629 | `--help`·모르는 인자는 무변경, dry run은 빠짐없이, 노트는 영구 삭제 금지 | 반영 | 부록 `#gates` CLI 규약 · R-16 | 코어 |
| #630 | 오너 항목은 에이전트가 못 하는 행동에만, 올리기 전 재확인과 이유 한 줄 | 반영 | 부록 `#schema` `owner_todo`·`why_owner` · `#dashboard-pages` · R-15 | 코어 |
| #631 | Orca 기능을 먼저 쓰고, 기대하는 Orca 동작은 버전 변경 시 시험, 임시 기능은 임시 표시 | 반영 | 부록 `#gates` 내장 먼저 · `#delivery` Orca 연동 우회 · R-17 | 기반 |

### 3.2 이슈 닫힘 53건

| 출처 | 요지 | 판정 | 설계 위치 · trigger · 이유 | 모듈 |
|---|---|---|---|---|
| #39 | 문서의 스킬 수·별칭 안내가 실제와 어긋나지 않음 | 불필요 | 손으로 맞추는 숫자를 두지 않고 카탈로그 검사가 센다(R-22) | - |
| #413 | 이벤트별 hook 스크립트 하나로 Bash당 hook 프로세스를 줄이고 합치기는 deny > ask > allow | 반영 | 부록 `#gates` hook 구조. 합치기 규칙을 표 시험으로 고정 · R-09 | 코어 |
| #414 | 같은 CI·PR을 여러 세션이 감시하지 않고 한 곳이 보고 결과를 구독 | 반영 | 부록 `#signal-flow` pr-monitor. 감시 호출 예산 상한 · R-05 | 랜드 |
| #415 | 알림 종료 코드의 뜻을 문서·시험으로 고정, 방송 사전 필터와 backoff | 반영 | 부록 `#delivery` 방송 · R-23 | 코어 |
| #416 | 읽기 실패만으로 디렉터리를 지우지 않고 원인을 확인 | 불필요 | 부록 `#files`에 이미 있다. 시험 사례는 #627 행이 가져간다 | - |
| #417 | 공개 항목 회수의 지연 상한 유지 | 불필요 | 프리뷰 공개는 sangsoe 밖 도구가 고친다(부록 `#files` 플러그인 경계) | - |
| #422 | 호환 경로 없이 시작, 호스트의 Orca 기능 확인(버전 하한 대신 `runtime.capabilities` 대조, 결정 63) | 반영 | 부록 `#delivery` 호환 경로(확인 방법은 5절 4번) · R-17 | 기반 |
| #423 | 현황 알림 메시지는 묶어서 깨우고 질문·실패·머지 가능·막힘은 즉시 | 반영 | 부록 `#delivery` 모아 보내기. 모아 보내기 기간과 즉시 종류 목록, 종료·재시작 시 유실 없음 · R-08 | 코어 |
| #424 | 보조 화면 읽기는 범위·횟수 제한, 라운드당 목록 1회 | 반영 | 부록 `#signal-flow` orca-monitor · R-07 | 감지기 |
| #425 | 중복 검사·티켓 도구·워커 감시를 Orca 기능으로 대체 가능한지 먼저 확인 | 반영 | 부록 `#gates` 내장 먼저 · R-17 | 코어 |
| #437 | 한 PR을 land하려고 별도 프로그램을 손으로 만들지 않음 | 불필요 | 저장소 단위 `land_*`로 이미 해결(프로그램 단위 원장이 없다) | - |
| #441 | 거부를 모으고 판정하고 적용하고 어긋남을 점검 | 반영 | 부록 `#delivery` 거부 보고 수집. 판정·적용은 별도 plugin이 맡는다 · R-10 | 코어 |
| #458 | 설치 갱신이 오너가 지운 규칙을 되살리지 않음 | 반영 | 부록 `#gates` 저장소 위생과 설치 · R-23 | 설치 |
| #459 | 등록된 hook 경로가 모두 존재, 지운 스크립트는 갱신 전 세션을 위한 대체 파일 | 반영 | 부록 `#gates` 저장소 위생과 설치 · R-01 | 기반 |
| #460 | 기다림을 관리하는 정상 경로(Monitor)를 막지 않고 포그라운드 루프만 막음 | 반영 | 부록 `#gates` hook 구조. Monitor 입력 제외 시험 · R-09 | 코어 |
| #461 | 테스트 명령을 거부하는 대신 자동으로 감싸는 설계 | 불필요 | 검증 결과 쓰지 않는다: 입력을 고쳐 쓰면 다른 hook의 allow가 고친 호출의 승인으로 쓰인다. 대신 거부가 고쳐 쓸 명령을 준다(R-09) | - |
| #462 | 정리는 모델 없는 실행기로 | 불필요 | 부록 `#role-cards` REAPER가 이미 스크립트 역할이다 | - |
| #463 | 볼륨 라벨 설정을 목록으로 | 불필요 | REAPER는 라벨 스캔이 아니라 `resource` 기록으로 치워 해당 설정이 없다 | - |
| #464 | 정리 계획의 생성 주체·무수정·대상 소유를 검증하고 실패 시 아무것도 닫지 않음 | 반영 | 부록 `#role-cards` REAPER · R-12 | 정리 |
| #465 | 하위 명령별로 읽기는 허용, 상태 변경은 분류 | 반영 | 부록 `#gates` CLI 규약. `sangsoe` 하위 명령의 읽기·변경 구분 · R-16 | 코어 |
| #466 | 기본 브랜치 강제 푸시·보호 규칙 쓰기·범위 밖 삭제·휴지통 비우기를 hook이 거부 | 반영 | 부록 `#gates` hook 구조. 하한 목록을 항목별 시험으로 · R-09 | 코어 |
| #467 | 스크립트의 실행 비트를 CI가 검사 | 반영 | 부록 `#gates` 저장소 위생과 설치 · R-01 | 기반 |
| #468 | 시작 명령의 경로 인자를 절대 경로로 정규화 | 불필요 | sangsoe 시작 명령은 절대 경로 인자 계약으로 새로 쓴다(R-16에 한 줄) | - |
| #469 | 작성자가 자기 PR의 통과를 쓸 수 없음 | 반영 | 부록 `#role-cards` land 판정 함수 네 칸 분리(작성자·리뷰어·증거·기록자) · R-04 | 랜드 |
| #470 | 오너 권한 규칙 배포 | 불필요 | 오너 설정 규칙은 sangsoe 본체 밖(권한 도구)이고 오너 실행 스크립트의 일이다 | - |
| #474 | 일회용 스크립트 기본 위치를 홈 바로 아래로 두지 않음 | 불필요 | sangsoe가 만드는 파일은 모두 상태 디렉터리다(부록 `#files`) | - |
| #485 | `/clear` 뒤에도 Orca 메시지 경로로 재개, stream이 있으면 조용·없으면 안내 | 반영 | 부록 `#delivery` 재개 · R-08 | 코어 |
| #497 | 할 일이 생기는 전이에만 깨움 | 반영 | 부록 `#signal-flow` `needs` 규칙. 시험 사례를 가져감 · R-18 | 감지기 |
| #498 | 맨 아래 PR이 어떤 머지 경로로도 못 들어가는 일이 없게 순서를 안내하거나 처리 | 반영 | 부록 `#gates` 스택 · 본문 `#dependencies` `stacked_on` · R-02·R-03 | 랜드 |
| #505 | 티켓 도구 선택을 hook이 강제 | 불필요 | 티켓 도구는 sangsoe 밖. 교훈(문장을 바꿔도 장수 세션·서브에이전트는 안 따른다)은 R-01 | - |
| #508 | 위와 같음 | 불필요 | #505에 합쳐졌고 티켓 도구는 sangsoe 밖 | - |
| #510 | 스킬 문서의 한국어 지시문을 영어로 | 불필요 | sangsoe 스킬은 처음부터 새로 쓰므로 해당 없음 | - |
| #515 | 무거운 작업 슬롯은 CPU 수 기반 기본값 + 설정 키 | 반영 | 부록 `#gates` 부하 한도 · R-13 | 정리 |
| #532 | land 대상 저장소를 저장소 소유 계정 기준으로 정하고 이름이 바뀌어도 막히지 않음 | 반영 | 부록 `#schema` 저장소 단위 기록. 저장소 목록을 손으로 맞추지 않음 · R-05 | 랜드 |
| #535 | 역할 줄이 없는 시작은 일반 세션으로 조용히 도는 대신 오류로 보임 | 반영 | 부록 `#role-cards` 세션 시작 hook·`#profiles` `session_started` · R-19 | 코어 |
| #536 | 제목 글자로 busy를 판정하지 않음 | 불필요 | 부록 `#signal-flow`가 이미 구조 신호를 정본, 화면·제목은 보조로 정했다 | - |
| #539 | 목표 충족 뒤 일부러 쉬는 리드는 멈춤이 아님 | 반영 | 부록 `#signal-flow` 감지기. 시험 사례 · R-07 | 감지기 |
| #544 | 작성자 기록이 워커 수명에 묶이지 않음 | 반영 | 부록 `#schema`·`#role-cards`. 작성자를 항목에 붙은 기록으로 · R-04 | 랜드 |
| #552 | 사전 판정과 실제 land 판정이 같은 함수 | 반영 | 부록 `#role-cards` land 판정 함수 판정 한 함수. 시험 사례 · R-03 | 랜드 |
| #560 | 닫는 길이 없는 파생 행이 없음, 모든 항목에 명시적 완료 경로 | 반영 | 부록 `#schema` `item` · R-14 | 코어 |
| #561 | PR마다 증거가 따로 남음 | 불필요 | 부록 `#schema` `evidence` 뷰(항목에 붙은 줄)로 이미 성립. 시험 사례는 #627 행 | - |
| #562 | 번역 기준 표시를 손으로 올리지 않음 | 불필요 | 번역본 유지는 비용 조건이 있다(#616). 한 줄 요구는 R-22 | - |
| #565 | 독점 구간은 거부·보류로 끝난 PR이 쥐고 있지 않음 | 반영 | 부록 `#role-cards` land 판정 함수 · R-06 | 랜드 |
| #567 | 작성자를 확인할 수 없어도 기록자가 리뷰어가 아니면 pass를 받고 "작성자 미확인"을 남김 | 반영 | 부록 `#role-cards` land 판정 함수 · R-04 | 랜드 |
| #568 | 같은 PR에 두 경로가 다른 판정을 내지 않음 | 반영 | 부록 `#role-cards` land 판정 함수 판정 한 함수. 시험 사례 · R-03·R-05 | 랜드 |
| #571 | 시작 실패(핸들 낡음·입력 안 됨)가 구조 신호로 🚨에 보임 | 반영 | 부록 `#delivery` 구조화 세션 핸들. 시작 실패 신호 · R-07 | 감지기 |
| #572 | 프로세스 종료 확인 시험은 재시도 폴링 | 불필요 | 그 시험은 없앤 코드의 것. 일반 규칙은 R-11에 한 줄 | - |
| #578 | 식별자 형식을 가정하지 않음 | 불필요 | 티켓 도구 hook이라 sangsoe 밖. 교훈은 R-09(오탐·미탐을 실제 값 모음으로 시험) | - |
| #588 | 거부 문구가 약속한 동작과 판정이 같고, 실패 run은 전부 보임 | 반영 | 부록 `#role-cards` land 판정 함수. patch-id 승계 규칙 명시 · R-03 | 랜드 |
| #591 | 실측값이 있으면 화면 문구로 판정하지 않음 | 반영 | 부록 `#signal-flow` 감지기. 시험 사례 · R-07 | 감지기 |
| #595 | main 상태는 저장소 단위 | 반영 | 부록 `#schema` `main_*` · R-05 | 랜드 |
| #596 | 알 수 없는 명령은 틀린 점과 맞는 형태를 먼저 보임 | 반영 | 부록 `#gates` CLI 규약 · R-16 | 코어 |
| #602 | 사람 입력과 자동완성 추천을 구분 못 하면 보류하고 오너 항목으로 올리지 않음 | 반영 | 부록 `#signal-flow`(판별 못 하면 행동 0: ⚠️도 `worker_stuck`도 쓰지 않는다) · R-07 | 코어 |

### 3.3 머지 없이 닫힌 PR 27건

| 출처 | 요지 | 판정 | 설계 위치 · trigger · 이유 | 모듈 |
|---|---|---|---|---|
| PR #21 | 리뷰하지 못한 실행은 종료 코드와 관계없이 통과가 아님 | 반영 | 부록 `#gates` 리뷰와 머지 판정 · R-04 | 랜드 |
| PR #70 | 예약 명령이 env 접두 때문에 거부되지 않음 | 불필요 | 이 형태의 예약 자동화는 없앴다. 주기 실행은 plugin worker 타이머가 하고 Orca 자동화는 쓰지 않는다(결정 75, T2 가 실패할 때만 `--precheck` 가 대신한다) | - |
| PR #135 | 긴 본문을 보내는 정상 경로가 위임 게이트에 막히지 않음 | 반영 | 부록 `#gates` hook 구조. 정상 경로를 시험으로 고정 · R-09 | 코어 |
| PR #152 | 방치된 Orca 워크스페이스를 조건이 모두 맞을 때만 정리 | 일부 반영, 나머지 나중 | `resource` 기록이 없는 기존 카드는 REAPER 라운드의 편입(`resource_adopted`)이 받고, 끝난 일(결정 82의 끝남 판정)이면 치운다. N일 무활동 같은 시간 기준은 끝남 판정이 아니라서 가져오지 않는다. 남는 trigger: 끝나지 않았는데 오래 방치된 워크스페이스가 전환 뒤 실측으로 쌓일 때만 조건(메인·고정·다른 호스트 제외, 열린 터미널 확인 불가면 남김, 잃을 것 없음)을 다시 본다 | 정리 이후 |
| PR #157 | 공유 서버 설정 | 불필요 | 공유 서버는 sangsoe 밖 plugin의 일이다 | - |
| PR #179 | 스킬 문장에 사건 서술·중복 명세를 두지 않고 정책은 설정으로 | 반영 | 부록 `#gates` 저장소 위생과 설치 · R-01 | 기반 |
| PR #180 | 역할마다 어떤 PR을 맡고 누가 머지하는지가 한 표, 쌓은 PR의 base 변경 순서 | 반영 | 본문 `#dependencies`·`#roles` · R-02 | 코어 |
| PR #195 | 구조·흐름·사람 개입 지점을 담은 소개 페이지 | 불필요 | `design.html`과 저장소 README가 소개를 맡는다 | - |
| PR #210 | Dispatch 없는 세션도 거부를 보고할 길이 있음, 본문에 자기 주소를 박지 않음 | 반영 | 부록 `#delivery` 거부 보고 · R-10 | 코어 |
| PR #249 | 세션→PR E2E 확인용 일회 PR | 불필요 | 머지 금지 시험 PR이고 내용이 없다 | - |
| PR #259 | 독점 구간 보유자가 연속으로 밀리지 않음, 브리프는 읽는 곳이 남은 동안 지우지 않음 | 반영 | 부록 `#role-cards` land 판정 함수 · `#files` 지우지 않고 옮김 · R-06 | 랜드 |
| PR #263 | 다른 쪽이 가진 스택·서비스를 대상으로 하는 단위는 보내기 전 읽기 전용 사전 확인 | 반영 | 부록 `#role-cards` 브리프 · `#dependencies-detail` `precheck_blocks_send` · R-02·R-20 | 코어 |
| PR #299 | Orca 응답의 요약·전체 모양을 가정하지 않고 도중 실패 시 고아 작업이 남지 않음 | 반영 | 부록 `#delivery` Orca 응답 모양. 응답 모양 시험 · R-17 | 코어 |
| PR #313 | README 중국어 번역본 | 불필요 | 번역본은 유지 비용을 감당할 때만 둔다(#616). 지금은 조건이 안 찬다 | - |
| PR #319 | Monitor 허용, 깨울 작업 없이 백그라운드 완료를 기다리는 세션은 🚨 `worker_stuck` | 반영 | 부록 `#gates`·`#signal-flow`(⚠️는 `trigger_unclear` 하나, `worker_stuck`은 멈춘 워커 하나, 결정 39) · R-07·R-09 | 코어·감지기 |
| PR #348 | 화면 요소의 표시 조건을 서로 묶지 않음 | 불필요 | 방어적 분리라 화면이 안 바뀌었다. 새 화면은 뷰의 칸마다 독립 조건이다 | - |
| PR #378 | 공개 위생 검사가 실제로 실패할 수 있음 | 반영 | 부록 `#gates` 저장소 위생과 설치. 항상 통과하지 않음을 시험으로 · R-01 | 기반 |
| PR #448 | LAND 줄에 필수 체크 명령, 머지를 사람에게 남기는 정책이면 머지 가능 상태에서 멈춤, 끝나지 않는 watcher는 직접 읽음 | 반영 | 부록 `#files` 워커 브리프 · `#role-cards` · R-20 | 랜드 |
| PR #559 | 리드 한 명이 쥔 워커 수 상한 | 나중 | trigger: `capacity` 계산에서 한 리드가 슬롯을 독식해 새 항목이 굶는 사례가 나올 때(리드별 Orca 워커 수 조회를 먼저 본다) | 코어 이후 |
| PR #606 | 시간 상한은 일한 시간, 보고에 일한 시간과 전체 경과를 함께 | 반영 | 부록 `#role-cards` 워커 · R-13 | 코어 |
| PR #607 | 상한이 보존 기간 안의 기록을 지우지 않음 | 반영 | 부록 `#gates` 부하 한도 · `#files` 압박 기록. 시험 사례 · R-13 | 정리 |
| PR #609 | 신호 종류·`main_flake`·기록 공백 경고·재실행 집계 | 반영 | 부록 `#signal-flow` `signal`의 kind · R-05 | 코어·설치 |
| PR #611 | 지우지 않고 아카이브로 옮기고, 위치가 없거나 이름이 겹치면 원본을 둠 | 반영 | 부록 `#files`·`#gates` CLI 규약 · R-21(노트 쪽 구현은 별도 plugin) | 별도 |
| PR #612 | 시험 파일 단위 병렬, 단독 실행을 가정하지 않음 | 반영 | 부록 `#gates` CI와 시험 · R-11 | 기반 |
| PR #613 | 모듈만 패치해서 통과하던 시험이 없음 | 반영 | 부록 `#gates` CI와 시험. queue-monitor 시험이 등록 job의 gate를 패치 · R-11 | 감지기 |
| PR #614 | 호스트 상태를 주입할 수 있고 서브프로세스 시험에도 닿음 | 반영 | 부록 `#gates` CI와 시험 · R-11 | 정리 |
| PR #615 | Act-on이 남은 pass는 fail, tree가 바뀌면 다른 계열 판정 | 반영 | 부록 `#role-cards` land 판정 함수. 모든 호출자가 같은 함수 · R-03·R-04 | 랜드 |

### 3.4 중단 작업 인계 문서 4건

| 출처 | 요지 | 판정 | 설계 위치 · trigger · 이유 | 모듈 |
|---|---|---|---|---|
| 중단 작업 · 시험 잔재 | 실제 분리 프로세스를 띄우는 함수는 시험에서 대체하고, 시험 뒤 프로세스가 안 남는 가드 | 반영 | 부록 `#gates` CI와 시험 · R-11 | 기반 |
| 중단 작업 · 워커 감시 (triage 원문 키: card 감시) | 현재 시작 시각 이후 로그만, 구조화 세션 핸들로 생존을 판정하지 않고, "일을 다 하고 Orca 메시지를 기다림"과 "멈춤"을 구분 | 반영 | 부록 `#signal-flow` 감지기 · 판별 못 하면 행동 0 · R-07 | 감지기 |
| 중단 작업 · 리뷰 의뢰 저장 (triage 원문 키: queue) | 리뷰 의뢰·메모는 한 저장소에만, 쌓인 일을 토큰 없이 넘김 | 불필요 | 부록 `#delivery`(일이 기다리는 곳은 Orca Task 와 열린 게이트)와 Orca Task(`pending`·`ready`·`blocked`)에 이미 있다(결정 74) | - |
| 중단 작업 · 나머지 | 주인 없는 열린 PR, 살아 있는 작업 단위, Orca 밖 worktree | 불필요 | 열린 PR 0건, 살아 있는 단위 없음, 남은 worktree는 모두 머지·무변경이라 넘길 것이 없다 | - |

### 3.5 공통 요구 R-01–R-23

여러 행이 함께 요구하는 것이다. 각 요구는 전환 조건의 시험 하나 이상으로 이어지고, 이관 갈래의 종단 검증이 "23/23이 sangsoe CI에 있다"를 센다.

| 요구 | 지켜야 할 것 (증명하는 시험 한 줄) | 모듈 |
|---|---|---|
| R-01 | 기계가 확인할 규칙은 hook·시험이 강제한다: hook 등록 경로의 존재, 스크립트 실행 비트, 공개 위생 검사가 실제로 실패할 수 있음 | 기반 |
| R-02 | 항목 사이의 선행 관계(간선)가 일급이다. 읽지 못한 선행은 "없음"이 아니라 "모름"이다 | 코어 |
| R-03 | 머지 사전 확인·실행·거부 문구가 같은 한 함수다. 저장소 이름이 바뀌어도 호출 경로가 달라도 같은 결과 | 랜드 |
| R-04 | 리뷰 근거는 작성자·리뷰어·증거·기록자 네 칸이고, 작성자는 항목에 붙는다. 리뷰하지 못한 실행은 통과가 아니다 | 랜드 |
| R-05 | 머지·main 기록은 저장소 단위 하나다. 재실행으로 가려진 실패·취소된 run은 따로 센다 | 랜드 |
| R-06 | 독점 구간은 거부·보류로 끝난 PR이 쥐고 있지 않고 보유에 stale 상한이 있다 | 랜드 |
| R-07 | 상태는 구조 신호가 정본이고 판별 못 하면 행동하지 않고 보류한다. 시작 실패와 "목표를 채우고 일부러 쉼"을 구분한다 | 감지기 |
| R-08 | 보낸 쪽이 잘림·수신자 없음 실패를 받고, 받는 쪽 하나에 소비자 하나이며, 재개 시 대기를 다시 붙인다 | 코어 |
| R-09 | hook은 이벤트당 프로세스 하나, 합치기 규칙을 표 시험으로 고정. 오탐·미탐은 실제 명령 모음으로 잰다. 정상 경로는 안 막힌다 | 코어 |
| R-10 | 권한 결정은 한 곳이고 거부는 event로 쌓인다. 거부된 행동은 다른 경로로 재시도하지 않는다 | 코어 |
| R-11 | 호스트 상태·시계를 주입해 시험하고, CI에 시간 상한·병렬이 있다. 제외된 시험과 재실행 flake를 숨기지 않는다 | 기반 |
| R-12 | 만든 자원은 기록하고 그 기록으로만 치운다. 정리 계획은 검증을 통과해야 실행하고, 목록이 비면 지우지 않는다 | 정리 |
| R-13 | 부하 판정은 한 기준이고 시간 상한은 일한 시간이다. 무거운 작업 슬롯은 CPU에 맞춘다 | 정리 |
| R-14 | 항목은 담당·원문·끝나는 조건을 함께 갖고 한 항목에 한 문제다. 닫는 길 없는 파생 항목은 만들지 않는다 | 코어 |
| R-15 | 오너 항목은 에이전트가 못 하는 행동에만, 올리기 전에 재확인하고 이유 한 줄을 적는다 | 코어 |
| R-16 | 모든 CLI는 `--help`·모르는 인자에서 아무것도 바꾸지 않고, 알 수 없는 명령은 맞는 형태를 보인다 | 코어 |
| R-17 | Orca가 하는 일은 Orca를 쓰고, 기대하는 Orca 동작은 버전 변경 시 시험한다. 호환 경로는 두지 않는다 | 기반 |
| R-18 | 감시는 할 일이 생기는 전이에만 깨우고, 자동화마다 목적·사용 증거·비용·끄는 명령이 한 목록에 있다 | 감지기 |
| R-19 | 역할·모델은 시작 기록에 남고 역할 줄 없는 시작은 오류로 보인다. 감독 비용은 머지된 PR 한 건당 컨텍스트로 잰다 | 코어·감지기 |
| R-20 | 브리프 규칙: 남의 스택·서비스를 대상으로 하는 단위는 보내기 전 읽기 전용 사전 확인, LAND 줄에 필수 체크를 명령으로 | 코어·랜드 |
| R-21 | 노트는 영구 삭제하지 않고 옮긴다(별도 plugin의 일) | 별도 |
| R-22 | 문서 숫자·번역 기준을 손으로 유지하지 않는다. 번역본은 유지 비용을 감당할 때만 둔다 | 설치 |
| R-23 | 설치 갱신은 오너가 지운 규칙을 되살리지 않고, reload 방송은 받을 수 있는 세션만 골라 backoff로 재시도한다 | 코어·설치 |

### 3.6 집계

| 판정 | 이슈(69) | 머지 없이 닫힌 PR(27) | 중단 작업(4) | 합계 |
|---|---|---|---|---|
| 반영 | 51 | 19 | 2 | 72 |
| 나중 | 0 | 2 | 0 | 2 |
| 불필요 | 18 | 6 | 2 | 26 |
| 합계 | 69 | 27 | 4 | 100 |

## 4. 외부 데이터를 복사하던 옛 저장소의 재판정

규칙은 부록 `#data-ownership-detail` 그대로다. 원본은 기능이 있는 쪽이다(항목·게이트·메시지·Dispatch·Run 은 Orca Task·게이트가, 오너 말·결정 키·부가 정보는 sangsoe sqlite 가 쥔다). 외부 원본(GitHub·Orca·Claude Code·티켓 도구)의 데이터는 (가) 참조, (나) sangsoe만 아는 상태와 판단, (다) 외부 사실이 바뀐 사건 한 줄만 저장한다. 캐시는 이유·TTL·갱신 주체를 적은 것뿐이다. 판정 낱말: **참조** · **자체 상태**(sangsoe가 만든 판단) · **사건** · **캐시 예외** · **두지 않음**.

### 4.1 `store.py`의 표

| 옛 표 | 담던 데이터(원본) | 판정 | sangsoe의 자리 · 이유 |
|---|---|---|---|
| `pr_ref` | PR 상태·초안·head·base·작성자·담당·CI·리뷰 결정·머지 상태(GitHub) | 캐시 예외 | `pr_ref`로 남기되 칸은 상태·CI·리뷰·머지 시각으로 줄인다. 이유: 현황이 매번 읽는 빈도와 GitHub 호출 한도. TTL: 열린 PR 1분, 머지·닫힘 24시간. 갱신 주체: pr-monitor. 원본과 다르면 원본이 이긴다. 작성자·담당·초안은 두지 않고 필요할 때 원본을 조회한다. 머지 판정의 head sha는 판정 시점에 원본에서 읽는다 |
| `pr_reviewer` | 리뷰 요청·리뷰 상태·봇 여부(GitHub) | 두지 않음 | 요청·수정 요청·코멘트는 `pr_review_requested`·`pr_changes_requested`·`review_commented` 사건이고, 리뷰를 기다림은 항목의 🚧 막힘(리뷰어)로 계산한다. 리뷰어 목록은 필요할 때 원본을 조회 |
| `card_ref` | Orca worktree 목록과 사라진 뒤의 흔적(Orca) | 두지 않음 | 워커의 worktree id는 `session_started`·`resource` 사건의 참조로 남고 사라짐은 `reap_done`이다. PR을 찾는 일은 항목에 붙은 PR 참조(`pr:acme/app#1`)로 한다 |
| `stage_row`·`stage_cell` | 머지·dev·prod 칸의 표시와 증거(우리 판단 + GitHub 머지 사실) | 사건 | `stage_recorded` event(칸·증거 참조)와 `evidence` 뷰. 행은 항목이고 머지 칸은 `pr_merged`에서 계산 |
| `stage_env` | 환경에 배포된 버전(배포 대상) | 두지 않음 | 복사하지 않는다. 배포 확인 사건에 버전 참조 한 줄을 남기고, 현재 값은 필요할 때 원본에 묻는다 |
| `stage_next` | 손으로 쓴 다음 할 일 | 자체 상태 | 항목(🟢·📅)으로 |
| `send_log` | 보낸 리뷰 의뢰·재촉과 채팅 예약 id(채팅) | 사건 | `notified` event. 채팅 예약 id는 그 줄의 참조 칸 |
| `review_ask` | "이 사람에게 이 PR 리뷰를 부탁" 요청의 상태 | 자체 상태 | 리뷰 항목과 🚧 막힘(리뷰어). 상태는 `item_transition`과 `notified`를 읽는 뷰로 계산한다(저장하지 않는다) |
| `land_request` | 머지 예약 요청과 결과 | 사건 | 저장소 단위 `land_requested`·`land_failed`(머지됐다는 사실은 `pr_merged`) |
| `order_`·`order_link` | 오너 지시와 그 연결 | 자체 상태 | `owner_action` + `owner_class` + 항목 |
| `board_row`·`alias`·`lead`·`closure` | 항목·묶음·닫힘 기록 | 자체 상태 | `item`·`item_transition` 뷰. 닫힘은 한 곳(Orca Task 의 `completed`) |
| `ack_event` | 오너가 본 것의 확인 | 사건 | `owner_action` event(버튼·채팅) |
| `decision` | 결정 | 자체 상태 | `decision` 뷰(`decision_*` event) |
| `counter`·`migration` | 번호 발번, 이행 기록 | 자체 상태 | 그대로 `counter`·`migration` 표(정본이 아닌 관리 표) |
| `event`(옛 모양) | 옛 event 표 | 자체 상태 | 새 `event` 표(칸 이름·`schema_v`·`dedupe_key` UNIQUE가 다르다). 가져오지 않는다 |

### 4.2 `registry.py`가 적던 파일·외부 사본

| 옛 저장소 | 담던 데이터(원본) | 판정 | sangsoe의 자리 · 이유 |
|---|---|---|---|
| `D/state.json` | 세션·터미널·PR 목록 스냅샷(Orca·GitHub) | 두지 않음 | 화면은 참조와 필요할 때 원본 조회로 그린다 |
| `D/prs.json`·`S/prs/*`·`D/pr-events.jsonl` | PR 목록과 변화 기록(GitHub) | 캐시 예외 + 사건 | `pr_ref`와 `pr_*` 사건. 이미 본 응답과 한도는 `gh_budget`·`gh_seen` |
| `S/ci-wait/*.json` | CI 감시 상태(GitHub) | 사건 | 이미 본 응답은 `gh_seen`, 실패는 `ci_failed`. 통과는 머지 판정 시점에 원본을 읽는다. 별도 캐시를 만들지 않는다 |
| `S/card-watch/*.json` | 화면 읽기 커서·상태(Orca·Claude Code) | 두지 않음 | 구조 신호가 정본이고 감지기는 결과를 event로만 쓴다 |
| `S/terminals/*.json`·`S/roles/*.json`·`S/roles-resolved/*.json` | 터미널·역할 기록(Orca) | 참조 | `session_started` 한 줄(세션 id가 키, 터미널은 참조) |
| `C/sessions/*.json`·`C/plugins/installed_plugins.json`·`C/projects/*/*.jsonl` | 세션·플러그인·대화 기록(Claude Code) | 참조 | Claude Code가 가진다. 읽기만 하고 오너 원문만 `owner_text`에 보존한다 |
| `D/skills.json`·`skill-usage-cache.json`·`P/_skill-usage/ledger.jsonl` | 스킬 사용 집계(Claude Code 기록) | 두지 않음 | reflect의 측정이 읽을 때 계산하고 저장하지 않는다 |
| `D/tokens.json`·`token-usage-cache.json`·`D/pr-stats.json` | 토큰·PR 통계(Claude Code·GitHub) | 두지 않음 | 토큰 페이지가 없다. 필요하면 `sangsoe` 명령이 읽는다 |
| `S/tracker-gate-cache.json`·`S/tracker-detect.json` | 티켓 도구 판별 캐시(티켓 도구) | 두지 않음 | `tracker_gate`와 함께 별도 plugin으로 간다 |
| `H/.cache/…/git/*` | git 저장소 사본 | 두지 않음 | 머지 판정은 GitHub의 현재 값을 읽는다 |
| `P/*/ledger.jsonl`·`program.json`·`decisions.tsv` | 프로그램 원장 | 자체 상태 | 항목·결정 뷰. 프로그램 폴더에는 브리프·보고 같은 사람이 쓰는 글만 둔다(부록 `#files`) |
| `S/ledger.jsonl` | 증거 장부 | 사건 | `evidence` event(PR마다 한 줄) |
| `S/locks/*`·`P/_locks/*`·`S/inbox-stream/*` | 잠금·소비자 표시 | 자체 상태 | Orca Dispatch가 이중 시작을 막고(P3 확인), 한 받는 쪽에 소비자 하나는 Orca 메시지 규칙을 따른다. `claim`·세대·lease는 만들지 않는다 |
| `S/pressure*.json` | 부하 표본·기록(머신) | 자체 상태 | 압박 기록은 8일·4MB 보조 로그이고 수준 변화만 `pressure_high`·`capacity_free` 사건 |

### 4.3 집계

판정을 낸 행 수: 4.1은 15행(캐시 예외 1 · 두지 않음 3 · 사건 4 · 자체 상태 7), 4.2는 14행(참조 2 · 사건 2 · 캐시 예외+사건 1 · 두지 않음 6 · 자체 상태 3). 합쳐서 **새 캐시는 0개**이고 캐시 예외는 `pr_ref` 하나(그리고 `gh_budget`·`gh_seen`·`owner_text`는 부록이 정한 것)다. 부록이 정한 캐시로 풀리지 않는 요구가 구현 중 생기면 이 표에 한 줄을 먼저 더한다.

## 5. 열린 질문

이 절은 이미 결정된 것의 번호만 적는다. 오너가 답할 열린 결정은 설계 문서에 두지 않고 작업 보고에 추천과 함께 올린다.

1. **이름과 저장소.** 결정됨(결정 23, 74): sangsoe(상쇠). 저장소는 본체 `JeongJaeSoon/sangsoe`(결정 d107, 개인 계정), 일반 스킬 저장소 하나, 마켓플레이스 저장소 하나가 같은 개인 계정 아래에 있다.
2. **CLI 이름.** 결정됨(결정 23): `sangsoe`. `orch`라는 이름이나 별칭은 만들지 않는다. `orch`는 agent-skills 자신의 CLI를 말하는 줄에만 남는다.
3. **sangsoe 밖으로 가는 스킬과 사라지는 것의 처리.** 결정됨(결정 74): 2.3의 28행은 모두 1절 표대로 다시 만든다.
4. **Orca 기능 확인(버전 하한은 보조).** 필요한 기능 목록은 기반 모듈의 시작 점검이 읽고(결정 63), 없으면 시작을 거부한다(JeongJaeSoon/agent-skills#422). 같은 점검이 비로컬 행(`hostId` 가 `local` 이 아닌 행)·`omittedHostIds`·로컬이 아닌 연결된 호스트를 보면 경고 한 줄을 내되 시작은 거부하지 않는다(결정 88. 시험 P11 은 결정 203 으로 닫음).
5. **agent-skills 데이터를 얼마나 가져올지.** 열린 항목·열린 결정만 읽기 전용으로 가져온다(1절 표 D-13).
6. **`design.html`·인벤토리의 어긋남.** 인벤토리는 `token_usage`·`turn_cost`를 토큰 페이지용으로 다시 계산한다고 했지만 `design.html`은 토큰 페이지를 만들지 않으므로 참조 안 함이다. 인벤토리가 가져가라 한 `candidates.py`도 위 이유로 참조 안 함이다(2.2).
