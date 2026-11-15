# sangsoe 용어집 (정본)

이 파일이 sangsoe 용어의 유일한 정본이다. `design.html`, `design-appendix.html`, `decisions.md`, `dashboard/`, 앞으로 쓰는 계획 문서와 코드의 이름은 여기 적힌 말만 쓴다. 새 말이 필요하면 먼저 이 표에 한 줄을 더하고, "쓰지 않는 말" 칸의 말은 어디에도 쓰지 않는다. 예외 하나: agent-skills 의 옛 이름은 (a) port-plan.md 의 "두고 오는 것" 칸과 2.1·2.2·2.3·4절 표에서 옛 모듈·표·스킬 이름을 적는 칸, port-plan 2.4 표의 원본 칸과 5절, port-plan.md 1절 "다시 만드는 13가지" 표의 "옛 것" 칸, (b) decisions.md 에서 택하지 않은 대안을 설명하는 글에만 코드체로 쓴다. 그 밖에는 모두 이 표의 말로 고쳐 쓴다("AI" 도 에이전트·LLM 으로 쓴다).

열: **용어**(문서에 쓰는 말) · **정의**(한 줄) · **영문 식별자**(표·event·뷰·명령 이름, 코드와 SQL 에 그대로 쓴다) · **쓰지 않는 말**(같은 뜻의 다른 말).

검사: `design.html`·`design-appendix.html`·`dashboard/*.html` 의 `<code>` 안 낱말과 절 이름은 모두 이 파일에 글자 그대로 있어야 한다. 다만 아래 ② 는 HTML 에도 같게 적용한다: 명령 옵션(`--ack`·`--spec` 같은 것)·묶음 글(`gate-*`)·파일 경로·예시 안의 값은 용어가 아니어서 옵션마다 이 파일에 적지 않는다. 예시 자료(`acme/app#1`, `ABC-1`, `alice`, `bob`, `example.test`)는 자리표시자이고 용어가 아니다.

## 1. 역할

| 용어 | 정의 | 영문 식별자 | 쓰지 않는 말 |
|---|---|---|---|
| 오너 | 사람 하나. 지시·결정·승인을 하고 Orca 메시지를 직접 받지 않는다 | `owner` | 소유자, 사용자, 유저 |
| 오케스트레이터 | 최상위 LLM 세션. 오너의 말을 분류하고 워커·리드를 띄우며 완료 조건이 없다 | `orchestrator` | 조정자, 매니저, 메인 세션 |
| 리드 | 프로그램 하나를 끝까지 끄는 워커. 자기 워커를 맡는다 | `lead:<name>` | 팀장, 서브 오케스트레이터 |
| 워커 | worktree + terminal + Dispatch 를 가진 실행 단위 | `worker:<worktree>` | 에이전트(역할을 가리킬 때), 작업자 |
| 서브에이전트 | 세션 안의 Agent 호출. 워커가 아니다 | — | 하위 워커 |
| 에이전트 | 오케스트레이터·리드·워커·서브에이전트를 묶어 부르는 말. 역할 이름 대신 쓰지 않는다 | — | AI, 봇 |
| 스크립트 역할 | 모델이 없는 실행 역할 둘(GRAPH·REAPER). 준비됨 항목 고르기는 `ready` 뷰와 `capacity` 함수, 결정 닫기·전파는 `decision_open`·`decision_answer` 함수가 하고 역할이 아니다. 머지는 이 역할이 아니라 PR 을 만든 워커·리드가 land 판정 함수를 불러 한다 | — | 데몬, CLAIMER, DISPATCHER, DECISION EXECUTOR |
| GRAPH | 간선의 유일한 입구. 모듈 하나와 `sangsoe graph` 명령이고 상주 프로세스도 토큰도 없다. Orca `--deps` 에 쓰는 것(만들 때 한정)도 부가 간선에 쓰는 것도 이 모듈을 지난다 | `GRAPH` | 그래프 서비스, 그래프 DB |
| REAPER | 끝난 일이 남긴 것을 치운다. 라운드는 표시 → 정리 두 단계(GC)이고 별도 부품이 아니다. 끝났는지는 끝남 판정만으로 정하고 잠잠함(sleep·idle)은 기준이 아니다. 타이머 라운드마다 기록 없는 기존 카드를 편입하고, 후보 가운데 끝남 판정이 긍정이고 두 라운드 연속이며 유예가 지난 카드는 worktree 를 지우기 전에 안전을 검사한 뒤(열린 Task·살아 있는 세션, worktree 안에 남은 증거 파일, Orca `ports` 가 그 worktree 에 묶은 listener, 그 worktree 의 설정 파일로 도는 compose stack, 커밋 안 된 변경, 원격에 없는 커밋. 걸리면 지우지 않고 `reap_blocked` 를 남기며 아무것도 멈추지 않는다, 결정 194. 설치된 Docker 가 답하지 않으면 compose 를 읽지 못한 것이라 막는다, 결정 201. 열린 PR 은 루트가 막는다) 통과하면 `worktree rm` 을 `--force` 없이 부른다. 카드가 닫힌 뒤 기록된 Docker 자원을 id 하나씩 지운다. 고아(Dispatch 없는 워커 프로세스·워크스페이스 없는 프로세스·닫힌 Task 의 worktree·Orca 에 없는 Task id 의 부가 정보)를 거둔다. 터미널 닫기는 시작한 쪽의 `worker-release` 가 한다: 새 worktree 에서 연 세션은 Orca 가 자동 해제하지 않으므로 워커는 시작한 쪽(리드·오케스트레이터)이, `--keep-open` 으로 띄운 리드는 그 리드의 `worker_done` 뒤에 오케스트레이터가 푼다(결정 193 ⑥, 197) | `REAPER` | janitor, 청소기 |
| 끝남 판정 | 카드나 자원을 치워도 되는 근거 하나. PR 이 머지되었거나 닫히고 카드의 HEAD 가 그 PR 에 실렸다 · 항목이 완료되었거나 취소되었다 · 대체되었다 · 워커가 `worker_done`(PR 이 걸린 일은 머지 대기 보고를 담은 것)으로 끝났다(PR 이 걸린 카드는 머지 확인을 거친 PR 상태가 우선한다). Orca 의 PR 연결은 낡거나 비어 있을 수 있어 정본이 아니고, `gh` 의 PR 상태와 HEAD 포함 판정이 정본이다 | — | 유휴 판정, 방치 판정 |
| 편입 | `resource` 기록이 없는 기존 카드나 Docker 자원을 REAPER 가 기록에 올리는 일. 치우기 전에 한다 | `resource_adopted` | 인수, 등록 |
| REAPER 라운드 | REAPER 가 한 번 도는 것. 타이머가 돌리거나 힌트가 앞당긴다. 단일 실행이다. 루트를 읽어 표시하고, 정리 조건을 모두 만족한 후보만 정리하며, 끝에 `trigger`·`roots_ok`·표시/후보/정리/모름 수를 `reap_round` 로 남긴다 | `reap_round` | 청소 주기 |
| GC | REAPER 라운드를 가리키는 비유 이름. 표시 → 정리로 도는 방식을 뜻한다. 별도 컴포넌트나 monitor 가 아니고 정본 용어는 REAPER 라운드다. REAPER 라운드를 설명하는 비유로만 쓴다 | — | gc-monitor, GC 부품 |
| 루트 | 라운드가 읽는 "아직 쓰이는 것"의 출처: 열린 PR(`gh`) · 닫히지 않은 Orca Task(`worker-show` 의 Run 으로 `task-list`, 결정 194) · 살아 있는 워커·리드·오케스트레이터 세션 · 카드 목록 · 보호 목록(설정) · 메인 체크아웃(카드 목록 행의 `isMainWorktree`). 읽기만 하고 사본을 저장하지 않는다 | — | 기준점, 앵커 |
| 로컬 행 | 이 PC 의 sangsoe 가 다루는 `worktree list`·`worktree ps` 행. 행의 `hostId` 가 `local` 인 것이다(결정 88). REAPER 후보·대상·편입과 orca-monitor 판정은 로컬 행만 쓴다. 응답의 `hostScope`(`hostIds`·`omittedHostIds`)는 어느 호스트의 답을 덮었는지 알려 준다 | `hostId` | 이 머신, 내 PC 행 |
| 비로컬 행 | `hostId` 가 `local` 이 아니거나 비었거나 오지 않은 행(Orca relay 로 보이는 다른 PC 나 SSH 호스트의 워크스페이스). 행의 `path` 는 그 호스트의 경로라 이 PC 의 git·`ports` 가 닿지 않으므로 지우지도 편입하지도 멈춘 것으로 판정하지도 않는다. 카드마다 한 번 `reap_blocked`(`remote_host`)로 남기고 모름으로 센다. `unavailableReason`·`unverifiableTerminalCount` 가 있는 행도 모름이다. 비로컬 행에서 어느 필드가 채워지는지는 재지 않는다(시험 P11 은 결정 203 으로 닫았다). cross-PC 는 만들지 않으며(결정 203), 저장된 원격 환경(`--environment`)이나 SSH 워커 시작은 쓰지 않는다(대안 B, 버림) | `remote_host` | 원격 행, 외부 행 |
| 표시 | 라운드의 첫 단계. 루트에서 소유 사슬(Task → worktree → 터미널·프로세스·브랜치·dev server → compose → 컨테이너·볼륨·네트워크·이미지)로 닿는 자원을 쓰이는 것으로 칠하는 일 | — | 마킹, 스캔 |
| 후보 | 표시되지 않은 자원. 후보인 것만으로는 지우지 않는다. 끝남 판정이 긍정이고 서로 다른 두 라운드에서 연속 후보이며 유예가 지나야 정리 대상이다. 최초 관측은 `reap_candidate` 로 남긴다 | `reap_candidate` | 쓰레기, 고아(고아는 Dispatch·워크스페이스·Task 가 없는 것을 가리키는 별도 말이다) |
| 유예 | 후보가 되고 정리 대상이 되기까지 기다리는 벽시계 시간. 압박이 높아도 줄이는 것은 끝남이 확정된 후보의 유예를 하한(라운드 두 번 사이 최소 간격)까지뿐이다. 값은 설정이고 구현 때 실측한다 | — | 대기 시간, 쿨다운 |
| 힌트 | "지금 라운드를 한 번 돌려라"는 신호. pr·orca·resource monitor 의 `pr_merged`·`pr_closed`·`worker_done`·`worker_dead`·`pressure_high` 가 REAPER 에게 주며, 힌트가 직접 정리하지는 않는다. 디바운스하고 라운드는 단일 실행이다 | `trigger` = `hint` | 트리거(항목의 trigger 와 겹친다) |
| 모름 | 소유자를 알 수 없거나(기록 없음) 루트를 읽지 못한 자원의 상태. 후보도 정리 대상도 아니고 세어 보고만 한다(resource-monitor 의 `resource_leak`, 편입 대상). 루트 읽기가 하나라도 실패하면 그 라운드는 정리 단계를 건너뛴다 | — | 불명, 미분류 |
| 정리 단계 | 라운드의 둘째 단계. 정리 대상에 삭제 전 검사를 하고 `worktree rm --run-hooks` 로 지워 저장소의 archive hook 이 고유의 정리를 하게 한 뒤, 남은 기록 id 에 Docker 규칙(id 하나씩)을 적용하거나 `reap_blocked` 로 남긴다 | — | 청소 단계 |
| land 판정 함수 | 지금 이 PR 을 머지해도 되는지를 내는 순수 함수 하나(독립 리뷰 판정 · 필수 검사 · 리뷰어·담당자 지정 · 자기 머지 게이트 · 검증 등급의 증거 점검(없으면 `evidence_missing`) · 자동 머지 조건 넷). 상주하는 역할이 아니고 PR 을 만든 워커·리드가 land 요청으로 부른다. 어디서 부르든 같은 결과다 | `land_verdict` | LAND EXECUTOR, 머저, 머지 봇 |
| land 요청 | PR 을 만든 워커·리드가 land 판정 함수를 부르는 한 번의 호출. 자동 머지 조건 넷이 모두 참이면 머지를 예약(`gh pr merge --auto`)하고, 아니면 "승인되면 머지"를 남기며, 어느 쪽이든 머지 대기 보고를 담은 `worker_done` 으로 스스로 끝난다(항목은 머지 확인까지 🚧 막힘(리뷰어), 결정 175). 승인이 찬 뒤 소유 리드가 같은 요청을 다시 부르면 예약 없이 바로 머지한다. 설정에서 거짓인 조건 ①–③ 은 그때 스스로 확인하고, 하나라도 실패하거나 읽히지 않으면 머지하지 않는다(결정 204). CLI 와 MCP tool 이 같은 함수를 부른다 | `sangsoe land --pr <N>` · MCP `land` | — |
| 자동 머지 조건 넷 | land 판정 함수가 저장소 설정을 읽어 머지 예약을 걸 조건. 모두 참이어야 한다: ① 필수 리뷰와 필수 CI 강제 ② 최신 main 필수 또는 병합 대기열 ③ 새 push 에 승인 무효 ④ PR 이 prod·인프라·보안 경로(`protected_paths`)를 건드리지 않음. 설정을 읽지 못하면 그 조건은 설정에서 거짓이라 머지를 예약하지 않는다. 그때 ①–③ 은 sangsoe 가 스스로 확인한다(① head 의 모든 검사가 끝나 통과하고 그 head 에 판정이 있음, ② base 를 품음, ③ 판정이 head 에 묶임). 각 조건의 `source` 는 `protection`(설정이 참) 또는 `own`(스스로 확인)이고, ④ 는 늘 `own` 이다. 바로 머지하는 길은 own 확인이 실패하거나 읽히지 않으면 거부한다(결정 204, `core/gh/merge-conditions.ts` · `core/land/land.ts` `ownConditions`) | `protected_paths`(설정 키) · `source: protection\|own` | 항상 자동 머지, 오너 머지 전용 |
| 검증 등급 | PR 이 머지 전에 보여야 하는 동작확인의 깊이를 정하는 네 등급. 변경 파일마다 등급을 매겨 가장 높은 것이 PR 의 등급이다. 애매하면 높은 쪽(fail closed). **V0** 문서·주석 — 필수 CI 통과만 · **V1** 테스트만·리팩터 — V0 + 대상 테스트 실행 출력 · **V2** 로직 변경(미분류 경로 포함) — V1 + 변경한 동작을 실제로 돌린 출력(무엇을 확인하지 못했는지 포함) · **V3** 화면·외부 연동·배포·prod·보안(`protected_paths` 일치 포함) — V2 + 화면이면 GIF·스크린샷과 리드 판정, 배포·연동이면 dev 반영 확인, 사람 승인. 증거는 모두 머지할 head sha 기준이다. release·deploy 의 dev 확인은 등급과 무관하게 유지된다 | V0 · V1 · V2 · V3 | 동작확인 단계(등급 말고), light/full |
| verify_tier | 검증 등급을 diff 의 경로·변경 종류·라벨·설정으로만 계산하는 코어의 순수 함수(토큰 없음). land 판정 함수와 같은 모듈이라 어느 호출자가 불러도 같은 결과다. 읽기 전용 CLI 로 볼 수 있다 | `verify_tier` · `sangsoe verify-tier <pr>` | 작성자 선언 등급 |
| 등급 라벨 | 등급을 사람이 조정하는 라벨 하나. 올리기는 누가 달았든 유효하고, 내리기는 설정 키 `owners` 에 든 사람이 단 것만 유효하며, `protected_paths` 에 걸린 PR 은 V3 아래로 내리지 못한다. 라벨이 없으면 계산값이다 | `verify-tier:N` (N 은 0~3) · `refactor`(V1 로 읽히는 리팩터 표시 라벨, 테스트 파일 무수정·의존성·설정 무변경일 때만) | — |
| verify_tier_set | 등급이 정해지거나 바뀐 때 pr-monitor 가 쓰는 event({pr, head_sha, computed, requested, effective, actor, accepted, reason, owner_action_ref?}). 라벨 이벤트와 새 push 로 계산값이 바뀔 때 쓴다. 오너가 말로 바꾼 경우 `owner_action_ref` 가 그 `owner_action` 을 가리킨다. 현재 등급은 이 event 에서 읽는 뷰이고 사본 표는 없다 | `verify_tier_set` | — |
| evidence_missing | 등급이 요구하는 증거가 그 head 에 없거나, 종료 코드가 0 이 아니거나, `not_verified` 칸이 비어 있어 land 판정 함수의 증거 점검이 실패한 사유. `land_failed` 의 사유로 `evidence_missing:<kind>` 로 쓰고 머지 예약도 `merge_on_approval` 도 만들지 않는다 | `evidence_missing` | — |
| 승인되면 머지 | 조건 넷 중 하나가 거짓이라 머지를 예약하지 않고 남기는 표시. `land_requested` 의 사유 `merge_on_approval` 이고 머지 대기 보고에도 같은 말을 적어 Orca Task 에 남긴다. 승인과 필수 검사가 차면 pr-monitor 가 소유 리드를 깨우고 리드가 land 요청으로 머지한다 | `merge_on_approval` | 오너 머지 대기 |
| 판정으로 머지 | 설정 `verdict_merge_repos` 에 든 저장소에서 GitHub 승인 대신 그 head 에 기록된 독립 리뷰 판정을 세어 바로 머지한 것. `land_requested` 의 사유 `verdict_approved` 다. V3·보호 경로는 여기서도 승인되면 머지다(결정 158) | `verdict_approved` · `verdict_merge_repos` | 셀프 승인 |
| 머지 예약 | 조건 넷이 참인 PR 에 건 자동 머지. 사람 승인과 CI 가 차면 GitHub 이 머지한다. 머지됐다는 사실은 pr-monitor 가 머지 확인 뒤 `pr_merged` 로 쓴다 | `gh pr merge --auto` | — |
| 머지 대기 보고 | land 요청을 마친 PR 작성자가 보내는 `worker_done` 의 본문(결정 175). 따로 보내는 메시지가 아니다: `--type merge_ready` 는 `[gate:self-land]` 가 막는다. Orca 는 그 `worker_done` 으로 Task 를 `completed` 로 닫고, 브리프는 PR 이 머지되기 전까지 항목을 🚧 막힘(리뷰어)으로 읽는다. 보고에는 PR·head·리뷰 판정과 "머지됨"·"예약함"·"승인되면 머지" 중 하나를 적는다 | `merge_ready` | 완료 보고(PR 항목에는), 머지 대기 메시지 |
| 머지 확인 | pr-monitor 가 (가) GitHub 이 그 PR 을 머지로 표시하고 (나) 그 머지 커밋이 main 에 들어 있음을 읽은 것. 둘이 모두 참일 때만 `pr_merged` 를 쓰고, 같은 라운드에서 그 항목의 Task 를 `completed` 로 닫는다. PR 이 걸린 항목을 sangsoe 가 닫는 유일한 경우다 | `pr_merged` | 머지됨 알림(머지 확인 없이) |
| 당사자 원칙 | 리드·워커가 스스로 할 수 있는 일은 끝까지 스스로 한다. 외부 컴포넌트는 (a) 당사자가 이미 없을 때(끝난 뒤의 사건, 죽음·멈춤 감지), (b) 당사자를 믿으면 안 될 때(규칙을 강제하는 hook·게이트), (c) 세션이 못 하는 일(깨움)에만 둔다. 부록 §역할 카드의 당사자 원칙 표가 구성요소마다 사유를 적는다 | — | — |
| 감지기 | 신호를 `event` 로 쓰는 hook 과 Orca plugin worker 안의 monitor | — | 센서, 워처 |
| hook | Claude Code 세션 안에서 도는 감지기 | — | 훅 |
| monitor | Orca plugin worker 의 타이머와 Orca 이벤트로 도는 감지기 5개(chat·queue·resource·orca·pr) | `chat-monitor` · `queue-monitor` · `resource-monitor` · `orca-monitor` · `pr-monitor` | 워처, 폴러 |
| 대시보드 | Orca plugin 패널이 `event`·뷰·Orca 읽기를 그리는 화면. 열 때와 plugin worker 가 알릴 때 읽는다. 별도 서버·포트가 없고 스스로 수집·생성하지 않는다 | — | 콘솔, 웹 대시보드 |
| 묶음 | 오케스트레이터 바로 아래의 한 단위. 리드 하나가 맡은 프로그램, 또는 리드 없는 단일 워커들을 모은 "그 외" | `group` · `others` | 팀, 그룹(화면에서) |
| 프로그램 | 한 리드가 완료 조건을 정해 끌고 가는 일의 묶음. 묶음의 안쪽 말 | `programs/<slug>` | 프로젝트, 에픽 |
| 모델 선택 표 | 모델을 고르는 유일한 표. 카탈로그(tier → alias·현재 ID·가격·출처·확인 날짜)와 정책(일의 종류 → tier·effort·사다리·승격 조건)의 두 층이다. 표는 여기에 옮겨 적지 않는다(결정 164) | `core/models/table.ts` · resource `models` | 프로필, 모델 등급 |
| tier | 카탈로그의 모델 자리 이름. alias 하나가 붙고 버전은 카탈로그 행에만 있다 | `frontier` · `primary` · `everyday` · `fast` | 프로필(옛 `deep`·`standard`·`light`·`wait`) |
| 일의 종류 | 정책 행의 열쇠. 역할 셋과 워커가 맡는 일의 종류 | `kind` · `orchestrator` · `lead` · `worker` · `design` · `review` · `release-review` · `sweep` | — |

## 2. 상태 (항목은 늘 정확히 하나)

| 용어 | 정의 | 영문 식별자 | 쓰지 않는 말 |
|---|---|---|---|
| 📅 예정 | 시작 trigger(날짜·PR 머지)나 선행 간선이 아직 안 찼다 | `scheduled` | 대기, 대기열 항목, 예약됨 |
| 🟢 준비됨 | 지금 시작할 수 있고 아직 아무도 맡지 않았다 | `ready` | 큐에 있음, 가능 |
| 🔄 진행 중 | 살아 있는 워커나 리드가 Dispatch 로 쥐고 있다. 결정이 풀려 Orca 상태가 `ready` 가 됐어도 활성 Dispatch 가 있으면(워커가 아직 쥐고 있으면) 🟢 가 아니라 🔄 다 | `in_progress` | 작업 중, 실행 중 |
| 🚧 막힘 | 시작했으나 누군가 없이는 못 간다. 기다리는 쪽을 괄호에 적는다. 리뷰 대기도 막힘이다 | `blocked` | 대기, 리뷰 중, 정지 |
| ⏸️ 보류 | 일부러 지금 안 한다. 재검토 trigger 가 있다 | `parked` | 연기, 나중에 |
| ✅ 완료 | Orca Task 가 `completed` 다. (결정 175·178: PR 작성자의 `worker_done` 이 머지 전에 Task 를 닫으므로, 브리프는 그 PR 이 열려 있으면 🚧 막힘(리뷰어), 머지 없이 닫혔으면 🚧 막힘(리드, 읽기 `pr_closed`), 상태를 아직 못 읽었으면 ❔ 모름(읽기 `unknown`)으로 읽는다. 보기 전용이고 Orca 상태는 그대로다. 아래 문장의 "머지 확인 뒤에야 `completed`" 는 이것으로 바뀌었다.) PR 이 걸린 항목은 pr-monitor 의 머지 확인 뒤에야 `completed` 가 되고, PR 이 없는 항목은 받아들여진 `worker_done` 이나 리드·오케스트레이터의 닫기로, 오너 항목은 오너의 완료 버튼으로 `completed` 가 된다(그 항목에 `verify` 가 있으면 probe 통과 전까지 ⏳ 검증 대기, 결정 181). `close_suggested` 는 닫기 제안이지 완료가 아니고, REAPER 의 끝남 판정은 카드를 치워도 되는지이지 항목 상태가 아니다(결정 161). 머지 확인 말고는 sangsoe 의 감지기·스크립트·hook 이 항목을 닫지 않고, 증거 없이 `completed` 가 된 항목은 🔍 로 표시된다 | `done` | 끝남, 종료(항목에는) |
| ⏳ 검증 대기 | 오너가 완료라고 한 오너 할 일인데 그 `verify` probe 가 아직 참을 보지 못했다(결정 181: 할 일은 검증으로 닫힌다). Orca Task 를 누가 닫았든 브리프·후속의 준비됨·`start_unit` 이 이렇게 읽고, probe 가 통과하면 ✅ 가 된다. 진행 중에 센다 | `pending_verify` | 완료(🔍), 오너 완료 |
| 🗑️ 취소 | 하지 않기로 했다. 이유가 필수다. 머지 없이 닫힌 PR 의 완료 항목을 `item_retire` 로 거둔 것도 🗑️ 로 읽는다(결정 223) | `canceled` | 폐기, 삭제 |

## 3. 플래그 (상태 위에 0개 이상)

| 용어 | 정의 | 영문 식별자 | 쓰지 않는 말 |
|---|---|---|---|
| 🙋 결정 필요 | 오너를 기다리는 열린 결정이 이 항목에 있다 | `item_status.flag_decision` | 질문 있음 |
| 🚨 오류·멈춤 | 풀리지 않은 `worker_stuck`·`worker_dead`·`ci_failed`·`land_failed`·`loop_detected`·`decision_untracked` 가 있거나, 부가 정보가 Orca 에 없는 Task id 를 가리킨다(`orphan_extra`, 뷰가 읽을 때 계산한다). 그 밖의 오류 출처는 앞의 `worker_stuck`·`worker_dead`·`ci_failed`·`land_failed`·`loop_detected` 중 하나로 쓰고 `reason` 에 사유를 적는다(§9) | `item_status.flag_error` | 장애, 경고 |
| ⚠️ 확인 필요 | `trigger_unclear` 하나만 뜻한다 | `item_status.flag_unclear` | 주의, 불확실 |
| 🔍 근거 부족 | 일한 세션이 스스로 완료를 판정한 경우. 그 판정은 증거가 아니라서 완료로 닫혔는데 증거 `event` 가 없거나 모자란 항목에 오른다 | `item_status.flag_noevidence` | 미검증 |
| 플래그 | 상태 위에 덧붙는 표시. 화면에서도 "플래그"라고 부른다 | — | 표시, 배지, 태그 |

이모지는 상태·플래그 표시에만 쓰고 하나에 뜻 하나이며 꾸밈으로 쓰지 않는다. 물음표 이모지는 쓰지 않는다. 이모지 체계에 없는 그 밖의 이모지도 쓰지 않는다.

## 4. 막힘의 기다리는 쪽 (괄호 안, 다섯뿐)

| 용어 | 정의 | 영문 식별자 | 쓰지 않는 말 |
|---|---|---|---|
| 막힘(오너) | 에이전트가 항목을 쥔 뒤 오너의 답이나 행동을 기다린다. 오너만 할 수 있어 아직 아무도 쥐지 않은 항목은 who 가 오너인 🟢 준비됨이다. 한 줄 표시에서는 🚧(오너)로 줄여 쓴다(다섯 쪽 모두 같은 줄임) | `blocked:owner` | — |
| 막힘(리뷰어) | 리뷰를 기다린다. 리뷰 대기는 이것이다 | `blocked:reviewer` | 리뷰 중 |
| 막힘(인프라) | 키·권한·환경처럼 외부 조건을 기다린다 | `blocked:infra` | — |
| 막힘(리드) | 소유 리드의 판단을 기다린다 | `blocked:lead` | — |
| 막힘(워커) | 워커의 작업을 기다린다 | `blocked:worker` | — |
| 리뷰어 | 그 PR 을 리뷰하는 사람이나 독립 리뷰 세션. 괄호 안에는 사람 이름을 쓰지 않는다 | — | — |
| 인프라 | 키 발급·권한·환경처럼 에이전트 밖의 조건 | — | — |

## 5. 오너 지시 분류 (여섯 갈래)

| 용어 | 정의 | 영문 식별자 | 쓰지 않는 말 |
|---|---|---|---|
| 바로 답 | 그 턴에 오케스트레이터가 답만 한다 | `answer` | 일곱째 갈래 "규칙·정책" |
| 읽기·조사 | 서브에이전트에게 읽기 전용으로 맡긴다 | `research` | — |
| 진행 중인 일의 범위 | 그 일을 쥔 세션에 Orca 메시지로 보낸다. 새 세션을 만들지 않는다 | `scope` | — |
| 새 일 | 항목을 🟢 준비됨으로 만든다 | `new_item` | — |
| 시각·조건 대기 | 날짜·PR 머지면 📅 예정, 글 조건이면 ⏸️ 보류 항목 | `wait_trigger` | — |
| 오너 판단 | 결정을 연다 | `owner_judgment` | — |
| 분류 | `owner_action` 이 여섯 갈래 중 어느 것인지 적은 `owner_class` event 한 줄 | `owner_class` | 라벨, 태그 |

## 6. 기록과 저장 (표·뷰·열)

| 용어 | 정의 | 영문 식별자 | 쓰지 않는 말 |
|---|---|---|---|
| event | sangsoe 가 원본인 사실(오너 말·분류·결정·부가 간선·PR 사실·자원·신호·`notified`·`observed_change`(터미널이 둘 이상인 Dispatch 만 쓰는 대체 경로)·증거)을 한 줄씩 적는 append-only 표. sangsoe 쪽 원본은 이것 하나 | `event` | 로그(원본을 가리킬 때), 투영 표 |
| 뷰 | `event` 에서 읽을 때 계산하는 현재 상태. 계산 결과를 저장하는 `<뷰>_cache` 표는 없다 | `VIEW` | 투영, 테이블(상태를 가리킬 때), `<뷰>_cache` 표 |
| 항목 | 한 일 하나. Orca Task 하나와 sangsoe 부가 정보로 이루어진다. 제목·상태·`spec`·만들 때의 의존은 Orca Task 가, 번호 별칭·시작하는 쪽·소유 리드·우선순위·trigger·부가 간선은 부가 정보가 가진다 | `item` | 보드, 큐, 단계표 행, 티켓 |
| 부가 정보 | Orca Task id 를 키로 sangsoe 가 붙이는, Orca 에 칸이 없는 것: `iNNN` 별칭·`exec_by`(owner·lead·worker)·소유 리드·우선순위·`est`·trigger·`hold`·`waits_on`·흐름 틀 id·단계·`done_when`. 표가 아니라 `event` 에서 읽는 뷰이고 Orca 값의 사본을 담지 않는다 | `item_extra` | 항목 사본, 항목 캐시 |
| 상태 대응표 | sangsoe 의 상태 7개와 Orca Task `status` 6개를 잇는 표: 📅 `pending` · 🟢 `pending`·`ready` · 🔄 `dispatched` · 🚧 `blocked`(+`waits_on`) · ⏸️ `blocked`(+`hold`) · ✅ `completed` · 🗑️ `failed`(+`result=cancelled`). 플래그는 상태가 아니라 뷰다 | `item_status` | — |
| 결정 | 오너만 정할 수 있는 질문 하나. 선택지·추천을 가진다. 질문 문구와 열림·닫힘은 대기자 Task 마다 하나인 Orca 게이트가, 결정 키·`dNNN`·답 연결은 sangsoe 가 가진다. 답이 없으면 escalation 을 따라 올라가 끝에서 `owner_todo` 에 남는다 | `decision` | 질문 큐, 에스컬레이션(오너에게 간 것) |
| owner_action | 오너가 한 말 하나(시각·출처·요지·세션 id·메시지 uuid·원문 가리킴) | `owner_action` | 지시 로그 |
| owner_text | 마스킹한 오너 원문만 담는 표. `owner_action` event 는 요지·해시·가리킴만 갖고, 원문은 여기서 지울 수 있다 | `owner_text` | 원문 칼럼 |
| Orca 메시지 | 깨움의 원본. `send`·`check`·`ask`·`reply`·`inbox` 로 보내고 받고 읽는다. 메시지 type 은 Orca 값을 그대로 쓰고 sangsoe 에는 `message`·`ack`·받은 편지함 사본이 없다 | `send` · `check` · `ask` · `reply` · `inbox` | sangsoe inbox, 메일함, 큐 |
| `notify` | Orca 메시지를 보내는 sangsoe 의 얇은 호출 함수. 같은 `dedupe_key` 로 이미 보냈으면 보내지 않고, 보낸 뒤 `notified` 를 쓰고, 받는 순서(워커 → 소유 리드 → 오케스트레이터)를 어기는 호출을 거부한다 | `notify` | — |
| owner_todo | 오너가 할 일의 뷰. 숫자는 이 뷰 하나에서만 센다 | `owner_todo` | 할 일 목록 표 |
| 오너 할 일 | 네 종류: 열린 결정 + 오너가 who 인 항목 + 소유 리드가 못 푼 `waiting_human` + 전달되지 않은 답(`decision_answered` 가 있는데 열린 게이트가 남은 것). 🙋 는 열린 결정만 센다 | `owner_todo` | 소유자 할 일 |
| 오너 항목 | 오너가 who 인 항목. 오너 할 일의 한 종류이고 건수 이름으로는 "오너 할 일"과 다르다 | `item` | — |
| item_status | `item` 에 표시용 칸(기다리는 쪽·기간·플래그)을 붙인 뷰 | `item_status` | — |
| item_timeline | 한 항목의 `event` 를 시간순으로 이은 뷰 | `item_timeline` | 이력 표 |
| evidence | 항목에 붙은 증거(PR 마다 한 줄, 칸 `kind`·`head_sha`·`exit_code`·`not_verified`)를 모은 뷰. land 판정 함수가 읽는 것은 PR 코멘트가 아니라 이 뷰다 | `evidence` | 증거 폴더 |
| trigger | 항목이 시작하는 조건. 예정 항목은 날짜·PR 머지뿐이고 스크립트가 판정한다 | `trigger` | 조건(시작 조건을 가리킬 때) |
| 재검토 trigger | 보류 항목을 다시 볼 조건. 글이어도 된다. 사람이나 에이전트가 판정한다 | `review_trigger` | — |
| 끝나는 조건 | 항목을 만들 때 받는 완료 조건. 명령 하나로 참·거짓이 나오는 한 줄 | `done_when` | 수락 기준(항목에는) |
| who | 정해진 낱말로 쓰는 사람·에이전트·스크립트의 이름 | `who` | 담당자명, 작성자명 |
| 소유 리드 | 항목이 속한 묶음의 리드. 없으면 "그 외" 묶음이고 Orca 메시지는 오케스트레이터로 간다 | `lead` | 소속 리드, 담당 리드 |
| 우선순위 | 항목과 묶음의 급함. `P0`·`P1`·`P2`·`P3`, 기본 `P2` | `priority` | 중요도, 긴급도 |
| `iNNN` | 항목 번호. 다시 쓰지 않는다 | `iNNN` | b<N>, 티켓 키(항목에는) |
| `dNNN` | 결정 번호 | `dNNN` | — |
| 결정 키 | 같은 질문을 알아보는 정규화한 열쇠. 재질문 게이트가 이 키로 같은 질문을 막고 합친다. `dNNN` 없이 온 답은 오케스트레이터가 열린 결정 중 하나에 잇는다 | `decision_key` | 질문 id |
| `decision_open` | 결정을 여는 함수. 결정 키가 이미 열려 있으면 거부하고 기존 `dNNN` 을 돌려주고, 아니면 `dNNN` 을 발번해 대기자 Task 마다 Orca `gate-create` 를 부른다. 결정을 만드는 모든 길(MCP·패널·CLI)이 이 함수를 지난다 | `decision_open` | — |
| `decision_answer` | 오너의 답을 닫는 함수. 결정을 닫는 `event` 를 쓰고 호출자가 묶인 Run 의 게이트마다 `gate-resolve` 를 `dNNN` 과 마스킹한 원문 인용으로 부르고, 푼 뒤마다 막혔던 워커에게 답을 알리는 Orca 메시지를 정확히 한 번 보낸다(`gate-resolve` 만으로 깨운다고 기대하지 않는다). 다른 Run 의 게이트는 그 Run 을 쥔 세션에 Orca 메시지(`send`)로 넘기고 그 세션이 풀고 같은 메시지를 보낸다. 멱등이라 이미 푼 게이트는 건너뛰고 메시지도 다시 보내지 않는다 | `decision_answer` | — |
| 결정 운반 Task | 대기할 항목이 없는 결정(오너 수준·프로그램 수준)을 위해 오케스트레이터 Run 에 만드는 Task(`exec_by=owner`, 제목 `dNNN`). 게이트가 Task 를 요구해서 둔다 | `exec_by=owner` | — |
| 결정 루프 | 답한 결정이 닫히고 전파돼 다시 묻지 않게 하는 흐름: 기록(hook·패널 버튼) → 잇기(오케스트레이터) → `decision_answer` 함수(닫기·게이트 풀기·전파) → 재질문 게이트(`decision_open`). 게이트를 푼 뒤에는 막혔던 워커에게 Orca 메시지를 정확히 한 번 보낸다. queue-monitor 는 "답은 있는데 열린 게이트가 있다"를 찾아 그 게이트의 Run 을 쥔 세션에 Orca 메시지로 다시 알린다 | — | 결정 파이프라인, DECISION EXECUTOR |
| 재질문 게이트 | 결정을 만드는 모든 길(`sangsoe decision add`, 리드·워커의 질문)이 거치는 검사. 이미 답이 달린 `decision_key` 로 새 결정을 열거나 같은 질문을 보내는 것을 거부하고 기존 답을 돌려주며, 열린 같은 결정 키는 새로 만들지 않고 합친다. `decision_open` 안에 있고 토큰이 들지 않는다 | — | 재질문 gate |
| 원본 | 한 데이터가 정해진 값을 가지는 단 한 곳. 기능이 있는 쪽이 원본이다: 항목의 뼈대·생성 시점 의존·게이트·메시지·Dispatch·Run 은 Orca, 오너 말·결정 키·Orca 에 없는 간선·부가 정보는 sangsoe sqlite, PR·대화 기록·티켓은 각 외부. 같은 사실을 두 곳에 쓰지 않는다 | — | 마스터 |
| 참조 | 외부 객체를 가리키는 값(Orca Task id·게이트 id·메시지 id·PR 번호·dispatch id·세션 id + 메시지 uuid). 복사가 아니다 | — | 링크 |
| 캐시 예외 | 외부 데이터를 복사해 두는 예외. 이유·TTL·갱신 주체를 적고 원본과 다르면 원본이 이긴다. Orca 값은 캐시도 두지 않는다. 한 번의 읽기 라운드 동안 메모리 안 스냅샷은 되지만 sqlite 에 쓰지 않는다. 예외는 `pr_ref`·`gh_budget`·`gh_seen` 이고 보존 사본 `owner_text` 는 캐시가 아니다. Orca 가 이력을 갖지 않는 판정 입력(macOS 의 메모리 여유)은 `judgeLoad` 가 판정한 값으로 보존 기간 표에 남는다(결정 241) | `pr_ref` · `gh_budget` · `gh_seen` | 미러, 복제 |
| 보존 기간 표 | 어느 도구도 갖지 않은 sangsoe 의 측정을 정한 기간만 두는 표. 캐시가 아니고 사본(`facts.jsonl`)에 들지 않으며, 기간이 지난 행은 쓰는 쪽이 같은 트랜잭션에서 지운다. 지금은 resource-monitor 의 부하 표본 24시간 하나다(결정 241) | `load_sample` | 이력 캐시, 시계열 DB |
| PR 참조 | PR 상태를 가리키고 짧게 들고 있는 캐시 예외 | `pr_ref` | — |
| 고유 사실 사본 | sqlite 파일 옆의 append-only 파일. 호스트 reader 가 다시 쓸 수 없는 event 행(sangsoe 만 가진 사실)과 발번을 같은 쓰기 길이 COMMIT 전에 한 줄씩 붙인다. 호스트 행과 `owner_text` 는 싣지 않으므로 이중 저장이 아니다. 사본이 없던 빌드가 쓴 행은 다음 열기나 다음 쓰기가 따라 붙인다(결정 192). sqlite 파일을 잃었을 때만 통째로 읽는다(결정 183·184) | `<db>.facts.jsonl` · `OWN_TYPES` · `HOST_TYPES` | 백업 DB, sqlite 사본 |
| 다시 세움 | sqlite 파일을 잃거나 읽을 수 없을 때 다음에 여는 쪽이 고유 사실 사본을 원래 seq 로 되살리고, monitor 가 첫 라운드 전에 호스트 행을 기존 reader 로 한 번 다시 읽는 것. 그 사이 깨움 act(머지 가능 알림)만 돌리고 Task 닫기·`reference add` 는 돌리지 않는다. Orca 가 열린 동안 잃으면 plugin worker 의 monitor·REAPER 가 다음 라운드 전에 다시 열어 다시 세운 파일에 붙는다(결정 191). 되살리지 못한 것은 이름 목록으로 남고 doctor 가 보여 준다(결정 184) | `store_rebuilt` · `host_rows_reread` · `store-restore` | 복구(`sangsoe recover` 와 겹친다) |
| 따라잡기 | Orca 가 닫혀 있던 뒤 첫 REAPER 타이머 라운드가 놓친 칸 수를 한 번 적는 것. 칸마다 라운드를 다시 돌리지 않고, 멈춤 전 후보 관측과 짝을 이루지 않는다(결정 182) | `reap_round.missed` | 재실행 |
| GitHub 한도 | GitHub 호출 예산과 이미 본 응답 표 | `gh_budget` · `gh_seen` | — |
| 번호 표 | `iNNN`·`dNNN` 을 다시 쓰지 않게 세는 표 | `counter` | 시퀀스 표 |
| 스키마 이행 | `schema_v` 가 오를 때 하는 이행. 백업과 해시를 남긴다 | `migration` | 마이그레이션 |
| 출처 | `owner_action` 이 어디서 왔는지: 채팅·버튼 | `origin` | — |
| 요지 | 에이전트가 읽는 한 줄 요약. 원문이 아니다 | `summary` | 요약문 |
| 대화 기록 가리킴 | 세션 id 와 메시지 uuid 로 대화 기록을 가리키는 값 | `cc_session` · `cc_message` | — |
| 오너만 할 수 있는 이유 | 오너 항목이 오너에게 가는 이유 한 줄 | `why_owner` | — |
| 버튼 | 패널에서 `plugin.request` 로 plugin worker 를 거쳐 코어의 같은 함수를 부르는 동작. `owner_action` 의 `origin` 이 `button` 이 된다 | `button` · `plugin.request` | — |
| 열쇠 접두 | `dedupe_key` 의 종류 접두 | `notify:` · `edge:` · `decision:` · `decision:dNNN` · `item:iNNN` · `pr:acme/app#1` | — |
| 승인 줄 | 브리프의 승인 근거. 오너의 말을 인용한 `오너(dNNN, 날짜)` 줄 | `오너(dNNN, 날짜)` | — |
| 이모지 체계 | 오너가 승인한 상태 7·플래그 4 | — | — |
| 스키마 버전 | `event` 한 줄이 어느 형식인지 적는 칸. 읽는 쪽이 옛 줄을 받아들인다 | `schema_v` | — |
| 순수 뷰 | `event` 만 읽는 뷰. 시계·네트워크 호출이 없어 재생해도 같은 값이다 | — | — |

## 7. 의존 관리

| 용어 | 정의 | 영문 식별자 | 쓰지 않는 말 |
|---|---|---|---|
| 의존 | 한 항목이 다른 항목·PR·결정이 끝난 뒤에만 시작할 수 있다는 관계. 간선으로 둔다 | `edge` | 연결, 링크, 의존성 목록 |
| 간선 | 선행에서 후속으로 가는 의존 하나. 만들 때 알려진 `blocks` 는 Orca `--deps` 에 두고 그 밖의 간선은 부가 간선에 둔다. 한 간선은 한 곳에만 산다 | `edge` | 엣지, 화살표 |
| 부가 간선 | Orca `--deps` 로 표현할 수 없는 간선: `after`·`stacked_on`·`deploys_after`, 만든 뒤에 더한 `blocks`, Orca 가 다른 Run 의 Task 를 받지 않을 때의 Run 사이 간선. `edge_added`·`edge_removed` `event` 이고 `pred`·`succ` 는 Orca Task id 다 | `edge_added` · `edge_removed` | — |
| 선행 | 간선의 시작. 항목·PR·결정 | `pred` | 부모(항목 관계에서는) |
| 후속 | 간선의 끝. 항상 항목 | `succ` | 자식 |
| 간선 종류 | 간선 하나의 의미. 네 종류(`blocks`·`after`·`stacked_on`·`deploys_after`)가 모두 후속을 막고, 막지 않는 참조 종류는 두지 않는다 | `kind` | — |
| 간선 충족 | 간선 하나가 찼는지: 1 찼다 · 0 안 찼다 · 알 수 없음. 알 수 없음은 준비됨이 아니다 | `edge_ok` | — |
| `blocks` | 선행이 ✅ 완료(선행이 결정이면 닫힘)여야 후속이 준비됨이 되는 간선. 선행 Task 에 pr-monitor 가 묶은 PR 이 있으면 그 PR 이 머지돼야 하고, 머지 없이 닫혔으면 끊긴 선행이다(결정 178, 흐름 단계인 선행은 예외) | `blocks` | depends_on |
| `after` | 순서만 정하는 간선. 선행이 ✅ 완료나 🗑️ 취소면 후속이 준비됨이 된다. 선행에 묶인 PR 이 열려 있으면 머지나 닫힘을 기다린다(결정 178) | `after` | — |
| `stacked_on` | 후속 PR 이 선행 PR 위에 쌓였다는 간선. 선행 PR 이 머지돼야 후속이 준비됨이 된다 | `stacked_on` | 부모 PR |
| `deploys_after` | 선행에 `pr_merged` 가 있고 앞 단계에 `stage_recorded` 가 있으면 충족한다. 선행이 ✅ 완료일 필요는 없다(머지 확인이 `pr_merged` 와 ✅ 를 같은 라운드에 만든다) | `deploys_after` | — |
| 끊긴 선행 | 🗑️ 취소된 선행에 `blocks`·`stacked_on`·`deploys_after` 로 걸린 후속의 표시. 자동으로 풀리지 않는다 | `dangling` | — |
| ready | Orca Task 상태가 `pending`·`ready` 이고 Orca `deps` 의 선행이 모두 `completed` 이고 그 선행에 묶인 PR 이 머지됐으며(결정 178) 부가 간선·trigger 가 모두 차고 `hold` 가 아닌 항목을 내는 뷰. 리드·오케스트레이터가 시작할 일을 이 뷰(MCP)로 본다. Orca 의 `task-list --ready` 는 부가 간선과 trigger 를 몰라 더 많이 보인다. 계산 결과를 저장하지 않는다 | `ready` | 준비 목록, CLAIMER |
| `capacity` | 준비됨 항목과 여유(슬롯·압박)를 맞추는 함수(resource-monitor 모듈). 시작하는 쪽이 `worker-start` 전에 부르고 여유가 생기면 `capacity_free` 가 오케스트레이터를 깨운다 | `capacity` | 할당기 |
| 순환 거부 | 간선을 더할 때 순환이 생기면 `event` 를 쓰지 않고 거부하는 것 | `edge_no_cycle` | — |
| 흐름 틀 | 정해진 순서(예: 구현 → 리뷰 → 머지 → dev 배포 → 확인 → prod)를 선언형 데이터로 둔 것. 항목을 만들 때 하위 항목과 간선으로 펼친다 | `flow` | 템플릿(화면에서), 워크플로 |
| 단계 | 흐름 틀의 한 칸. 펼치면 하위 항목 하나가 된다 | `step` | 스텝 |
| 게이트(틀) | 단계가 채워질 때까지 막는 조건 종류: 오너·타이머·CI·PR | `gate` | 승인 단계 |
| 틀 항목 | 펼친 흐름 틀의 위 항목. 틀 이름·버전을 갖고 단계마다 하위 항목이 하나씩 달린다. 하위 항목과 범위 안 PR 이 모두 끝나야 ✅ 완료로 닫을 수 있다 | `parent` | 부모 항목 |
| 펼치기 | 흐름 틀의 단계를 위상 순서로 Orca `task-create --parent --deps` 로 만드는 것. 요청 id 를 달고 끊기면 `request-show` 로 이어서 만들며, 이미 만든 단계는 `flow_expanded` 에 id 가 있어 두 번 만들지 않는다 | `flow_expanded` | 인스턴스화, pour |
| `flow_gap` | 틀의 단계 중 펼친 항목에 없는 것을 내는 뷰 | `flow_gap` | — |
| 의존 실패 회귀 시나리오 | 의존 관리가 겪은 실패 사례를 다시 돌리는 시험 12개 | `stack_order` · `retarget_approval` · `early_done` · `prod_gate` · `review_timing` · `cross_lead` · `stack_bottom` · `overlap_order` · `unknown_is_not_ready` · `merge_suggests_close` · `precheck_blocks_send` · `repo_level_main` | — |
| `done_blockers` | 완료로 닫으려는 항목의 범위에 아직 끝나지 않은 하위 항목·PR 이 있는지 내는 뷰 | `done_blockers` | — |
| 크리티컬 패스 | 한 묶음에서 아직 끝나지 않은 항목을 잇는 가장 긴 선행 사슬. 지금 전체를 늦추는 것. `sangsoe graph critical` 이 `edge`·`item` 뷰만 읽어 계산하는 순수 함수이고 뷰가 아니다. 길이는 단계 수로 센다 | `critical_path` | 임계 경로 |
| 추정 | 크리티컬 패스의 길이 입력. 항목의 `est` 칸이 있으면 그 값, 없으면 사슬의 단계 수(사슬의 간선 위 항목 하나가 한 단계) | `est` | — |
| 의존 그래프 | 한 묶음의 항목과 간선을 그린 것 | `sangsoe graph` | 의존 트리 |
| 영향 범위 | 한 항목이 늦어지거나 취소될 때 걸린 후속 전체 | `sangsoe graph impact` | — |
| 감지 사실 동기 | PR 머지·취소 같은 `event` 를 읽어 간선 충족을 갱신하는 것. 감지기 신호가 쌓인 뒤 queue-monitor 가 부르고 GRAPH 가 간선을 쓴다 | `sangsoe graph sync` | — |
| 간선 규칙 | 간선을 쓰는 자와 순환 거부를 GRAPH 한 곳에 모으는 규칙 | `source = GRAPH` | — |
| 순환 오류 | 위상 정렬 라이브러리가 순환을 알리는 예외. 시험 기준이다 | `CycleError` | — |
| 위상 정렬 모듈 | 파이썬 표준 라이브러리. ready·순환 결과와 비교하는 시험 기준 | `graphlib` | — |

## 8. 현황 (brief)

| 용어 | 정의 | 영문 식별자 | 쓰지 않는 말 |
|---|---|---|---|
| 현황 | 상태를 묶음 → 묶음 상세 → 항목 상세 세 단계로 내려가며 보는 것. CLI 와 패널이 같은 뷰를 쓴다 | `sangsoe brief` | 보고, 진행 상황 목록 |
| 1단계(현황) | 표 네 절(결정 필요 · 지금 오너가 할 일 · 열린 항목 · 보류)이고 리드·카드·PR·워커가 한 행씩이다. 묶음 요약은 리드 행에만 쓴다 | `BriefModel` | 묶음마다 한 줄 요약, 보고 |
| 열린 항목 절 | 현황 1단계의 셋째 표. 리드 행 하나와 그 아래 🚧 🔄 🟢 📅 항목·세션·PR 행. 상태 🔄 진행 중과 다른 뜻이고 상태 칸이 구분한다 | `brief.in_flight` | — |
| 결정 필요 절 · 지금 오너가 할 일 절 | 현황의 첫째·둘째 표. 앞은 열린 결정(추천 열 있음), 뒤는 `owner_todo` 의 나머지 세 종류. 한 건은 한 곳에만 둔다 | `brief.decisions` · `brief.owner_todo` | — |
| 보류 절 | 현황의 넷째 표. ⏸️ 항목. 없으면 그리지 않는다 | `brief.held` | — |
| 현황 렌더러 | 코어의 함수 둘: `buildBrief`(뷰 → `BriefModel`)와 `renderMarkdown`(→ 78칸 이하 Markdown 표). 채팅(MCP resource `brief`·skill·CLI)과 패널이 같은 모델을 쓴다 | `buildBrief` · `renderMarkdown` | — |
| 골든 시험 | 고정 `event` 묶음에서 나온 현황 글이 저장해 둔 기대 출력과 같아야 하는 시험. 기대 출력은 `UPDATE_GOLDEN=1` 로만 바꾼다 | `brief.golden.test.ts` | — |
| 2단계(묶음 상세) | 한 묶음의 항목을 상태별로, 의존 그래프와 크리티컬 패스를 함께 | `group_items` | — |
| 3단계(항목 상세) | 한 항목·세션·PR 의 최근 `event`·요지·증거·대화 기록 위치 | `item_timeline` | — |
| 건수 줄 | 현황 1단계 헤더 바로 아래, 첫 표 위의 한 줄 `✅ 완료 N건 · 🔄 진행 중 N건 · 남은 것 N건 · 🚧 막힌 것 N건`. 센 단위는 항목 하나이고 리드 행·결정·전달되지 않은 답은 세지 않는다. 항목은 정확히 한 버킷에 든다 | `BriefModel.summary` | 요약, 합계 |
| 남은 것 | 📅 예정 + 🟢 준비됨 + ⏸️ 보류. 건수 줄의 한 버킷이고 이모지를 붙이지 않는다 | `summary.left` | 대기열(건수 칸에서) |
| 막힌 것 | 건수 줄의 한 버킷. 🚧 막힘 항목 + 지금 오너가 할 일 절의 항목 행(열린 `waiting_human` 도 그 세션 항목의 `iNNN` 행이라 든다). 상태 🚧 막힘과 달리 오너 할 일 항목이 저장된 상태와 상관없이 든다 | `summary.blocked` | — |
| 완료 접기 | ✅ 완료를 최근 N일 건수로만 보이고 펼치면 목록을 보인다. N 의 기본은 7. 건수 줄의 `완료` 가 이 건수이고, 맨 아래 줄은 `완료는 최근 7일` 로 창 길이만 말한다 | `brief.done_days` · `summary.done` | — |
| 지금 막는 것 | 한 묶음에서 가장 오래된 🚧 막힘의 기다리는 쪽과 기간 | `blocker` | — |
| 그 외 | 리드 없는 단일 워커들의 항목을 모은 묶음 | `others` | 기타, 개별 작업 |

## 9. event 종류 (`type`)

| 용어 | 정의 | 영문 식별자 | 쓰지 않는 말 |
|---|---|---|---|
| 세션 hook 신호 | 권한·입력 대기 | `waiting_human` | — |
| | `waiting_human` 이 풀렸거나(패널 버튼·같은 도구의 실행·턴 종료·`agentWait` 해제. 오너의 말만으로는 풀지 않는다) 답 없이 사라짐(세션 종료). 값: outcome(`answered`·`moot`), by(`owner`·`button`·`unknown`), evidence. 먼저 보인 신호 하나만 남는다(결정 91) | `waiting_released` | — |
| 오너 항목 검증 | 오너 항목이 가질 수 있는 기계가 읽는 끝나는 조건 `verify`. 종류 다섯: 머지(`pr_merged`) · Orca 상태 칸(`orca_field`) · plugin 승인(`plugin_approved`) · 워크플로 실행 결과(`run_ok`) · PR 존재(`pr_found`). 없는 항목은 "검증 없음" 으로 보인다. 통과하면 `evidence` 와 닫기 제안이 가고 monitor 가 닫지는 않는다 | `verify` · `cmd_hint` | — |
| 입력 확인됨 · 검증 중 | 오너의 `!` 명령·프롬프트가 열린 오너 항목의 후보로 읽혔고 probe 를 기다린다는 뷰의 표지. 상태가 아니고 입력만으로는 어떤 상태도 바뀌지 않는다. probe 가 실패하거나 시간이 지나면 "검증 안 됨" 이 된다. 규칙은 결정 181 이다: 결정은 그 결정을 가리키는 오너의 답(hook 이 잇는 `dNNN` 답·패널 버튼·오케스트레이터가 `decision_answer` 로 잇는 오너의 말)으로 닫히고, 할 일은 검증(probe 의 관측)으로 닫힌다. 오너가 패널에서 완료를 눌러도 `verify` 가 있으면 ⏳ 검증 대기다 | `owner_act:seen` | 실행됨(상태로), 동작확인 중(상태로) |
| 원인이 사라진 결정 | 게이트가 건 Task 가 모두 닫혔거나 가리키는 PR 이 닫혀 더 물을 이유가 없는 결정. 답 없이 닫고 뒤늦은 답은 기록만 한다 | `moot` | — |
| | 턴 종료 | `turn_ended` | — |
| | 일 없이 멈춘 워커: Task 를 쥔 세션의 턴이 끝났는데 Orca 가 그 Dispatch 를 아직 `dispatched` 로 답한다(Stop hook, 턴마다 한 번. 결정 196) | `worker_idle` | — |
| | 같은 Task 의 시작 실패 세 번(`core/start/start.ts`) | `loop_detected` | — |
| | 세션 시작({session, role, model}. model 은 hook 이 줄 때만, 계약의 tier·effort 칸은 아직 채우지 않는다) | `session_started` | — |
| | 게이트 거부({gate, command 파일 경로}) | `gate_denied` | — |
| | chat-monitor: 새 멘션 | `mention_new` | — |
| | queue-monitor: 새로 준비됨이 된 항목을 `notify` 로 알린 기록(`ready` 뷰가 가리킨다) | `item_ready` | item_claimed |
| | 오너 항목의 날짜 도래 | `todo_due` | — |
| | 글 조건을 스크립트가 못 읽음(항목당 한 번) | `trigger_unclear` | — |
| | 닫을 만하다는 제안 | `close_suggested` | — |
| | 기한 안에 읽히지 않았거나 처리되지 않은 escalation, 답이 기록됐는데 열린 게이트가 남은 결정(queue-monitor 가 쓰고 한 단계 위로 `notify` 한다) | `escalation_stale` | — |
| | 설치·승인된 Orca plugin(plugin worker 포함)의 버전이 브루 트리(= 코어 버전)와 다르거나, 꺼졌거나, 재승인을 기다림(결정 185. 내용 해시 비교는 `sangsoe doctor` 의 몫). Claude Code plugin 쪽 어긋남은 event 가 아니라 시작 점검·`sangsoe doctor` 가 한 줄로 알린다(결정 90) | `job_drift` | — |
| | 자원 누수 | `resource_leak` | — |
| | 여유 생김 | `capacity_free` | — |
| | 압박 높음 | `pressure_high` | — |
| | 죽은 워커 | `worker_dead` | — |
| | 멈춘 워커. 일하는 중인데 `worktree ps --json` 의 마지막 출력·활동 시각(`lastOutputAt`·`lastActivityAt`, 에이전트 행의 `stateStartedAt`)이 설정한 분보다 오래된 워커에 쓴다(결정 87, 필드 뜻은 시험 P10 전까지 미확인). monitor 가 판정할 수 없는 입력(시각 필드가 비었거나 미래)에는 쓰지 않는다(그때는 행동 0) | `worker_stuck` | — |
| 🚨 사유 | 새 event 종류를 더하지 않고 다섯 `event` 의 `reason` 칸에 사유를 적는다: 역할 줄 없는 sangsoe 세션은 `worker_stuck`(`no_role_line`), 시작 실패는 `worker_dead`(`start_failed`). 오류로 멈춘 워커의 `worker_dead`(`stop_failure`)는 orca-monitor 가 Orca 의 `errored` 멈춤 escalation 에서 쓴다. 사용 한도로 멈춘 것은 죽음이 아니라 `rate_limited`(`usage_limit`)다(결정 196) | `reason` · `no_role_line` · `start_failed` · `stop_failure` | — |
| | 멈춘 Run. 미완 워커가 모두 죽거나 멈춘 Run, 또는 Dispatch 없는 코디네이터(오케스트레이터, Task 없는 리드)가 일하지 않는 동안 그 Run 의 메일이 30분 넘게 읽히지 않은 Run(`coordinator` 칸, 결정 245). 멈춤 하나에 한 번 쓰고, 코디네이터의 멈춤은 오케스트레이터의 Run 이 분명할 때 그 Run 에 한 번 알린다 | `run_stalled` | — |
| | 답 없는 결정 질문 | `waiting_decision` | — |
| | 항목에 연결된 PR 이 열림 | `pr_opened` | — |
| | 리뷰 요청됨(pr-monitor, 요청 id 마다. 결정 195) | `pr_review_requested` | — |
| | 수정 요청됨(pr-monitor, 리뷰 id 마다. 결정 195) | `pr_changes_requested` | — |
| | 머지 가능 | `pr_ready_to_merge` | — |
| | 머지됨 | `pr_merged` | — |
| | 머지 없이 닫힘 | `pr_closed` | — |
| | 머지 없이 닫혔던 PR 이 다시 열림(pr-monitor, 닫힘마다 한 번. 결정 216). store 와 GRAPH 는 그 PR 을 다시 열린 PR 로 읽는다 | `pr_reopened` | — |
| | 쌓은 PR 의 base 가 바뀜 | `pr_base_changed` | — |
| | CI 실패 | `ci_failed` | — |
| | pr-monitor 가 머지 뒤 그 sha 의 push CI 를 읽고 쓰는 기록({repo, sha, run ids}). 재실행 1회로 flake 를 가르고 새 push 로 취소된 run 은 빨강이 아니다 | `main_green` · `main_red` | — |
| | `PostCompact` 기록 hook 이 쓰는 압축 기록({session, role, context_tokens}) | `compacted` | — |
| | `notify` 가 판단 메시지를 보낸 뒤 설정한 분 안에 Orca 우편함에서 읽히지 않음(handled 상태는 `inbox` 가 원본). 받는 순서의 다음 사람에게 `escalation_stale` 길로 올린다 | `wake_unconfirmed` | — |
| | 리뷰 의뢰·리마인드 한 건({pr, reviewer, head, action(request·remind), source(hand·auto·scheduled), scheduled_id, post_at}). `review_ask_record` tool 로만 쓴다 | `review_ask_sent` | — |
| | 리뷰어 매핑이 설정에 없어 리마인드할 수 없음. 🚨 로 보인다 | `unmapped_reviewer` | — |
| 사유 값 | 새 event 종류 없이 기존 `event` 의 `reason` 칸에 적는 값: `worker_dead` 의 `host_restart`(한꺼번에 많이 죽음) · `land_failed` 의 `main_red`(그 저장소의 최신 main 이 빨강) · `land_failed` 의 `evidence_missing`(등급이 요구하는 증거가 그 head 에 없음) · `gate_denied` 의 `report_address`(보고 주소가 `term_` 핸들) · `land_requested` 의 `merge_on_approval`(예약하지 않고 승인 뒤 머지를 남김) · `reap_blocked` 의 `uncommitted`(커밋 안 된 변경, 추적 안 된 파일 포함) · `unpushed`(원격에 없는 커밋) · `unpushed_other_patch`(메시지만 같고 패치가 다른 커밋, 사람에게 넘김) · `task_open`(그 카드의 Task 가 닫히지 않음) · `session_alive`(그 카드의 세션이 살아 있음) · `evidence_in_worktree`(증거 파일이 아직 worktree 안) · `listener`(Orca `ports` 가 그 worktree 에 묶은 listener) · `compose_running`(그 worktree 의 설정 파일로 도는 compose stack. 이 다섯은 결정 194) · `docker_unreachable`(`docker` 명령은 있으나 데몬·context 가 답하지 않거나 시간이 넘어 compose 를 읽지 못함, 결정 201) · `in_use`(쓰는 중인 Docker 자원) · `archive_hook_failed`(저장소의 archive hook 이 실패해 Orca 가 지우지 않음, `--allow-failed-archive-hook` 은 오너만) · `remote_host`(비로컬 행이라 지우지 않음, 카드마다 한 번, 결정 88) · `item_transition` 취소의 `superseded`(다른 항목으로 대체됨) · `escalation_stale` 의 `waiting_unreleased`(제때 풀리지 않은 `waiting_human`)·`verify_unconfirmed`(`입력 확인됨 · 검증 중` 가 길어짐) · `close_suggested` 의 `verified`(오너 항목의 probe 통과) · `decision_closed` 의 `moot`(원인이 사라짐, 결정 91) · `item_transition` 의 `owner_not_yet`(오너가 "아직") | `waiting_unreleased` · `verify_unconfirmed` · `verified` · `moot` · `owner_not_yet` · `host_restart` · `main_red` · `evidence_missing` · `report_address` · `merge_on_approval` · `uncommitted` · `unpushed` · `unpushed_other_patch` · `task_open` · `session_alive` · `evidence_in_worktree` · `listener` · `compose_running` · `docker_unreachable` · `in_use` · `archive_hook_failed` · `remote_host` · `superseded` | — |
| | 새 리뷰 코멘트(작성자가 아닌 사람, 코멘트 id 마다. 결정 195) | `review_commented` | — |
| | 새 리뷰 답글(스레드에 단 작성자의 답, 코멘트 id 마다. 결정 195) | `review_replied` | — |
| | 한도 부족: GitHub API(`kind: github`) 또는 워커 세션의 사용 한도 멈춤(`kind: usage_limit`, 결정 196) | `rate_limited` | — |
| | Orca 메시지를 보낸 기록(`msg_id`·받는 쪽·type). 기록이지 깨움이 아니고 메시지 본문의 사본도 아니다 | `notified` | — |
| | 대체 경로 전용 기록: P10 이 `worktree ps` 시각을 못 믿는다고 보인 자리, 곧 살아 있는 터미널이 둘 이상인 workspace 의 Dispatch 에만 orca-monitor 가 Orca 필드 `state`·`stage`·`liveness` 중 지난 라운드와 달라진 필드 이름을 쓴다(값은 쓰지 않는다. 결정 87·196, 옛 방식은 결정 61) | `observed_change` | — |
| | sangsoe 를 거치지 않고 만들어진 Orca 게이트, 곧 sangsoe 결정 키가 없는 게이트(orca-monitor 가 Run 마다 훑어 쓴다). 그 게이트가 막는 항목은 🚨 로 보인다 | `decision_untracked` | — |
| | 오너가 직접 한 일(머지·수동 sync 같은 사실)이 열린 어느 결정의 답에도 이어지지 않음(pr-monitor 가 쓰고 오케스트레이터에게 Orca 메시지로 알린다. 감시 목록에 든 `!` 명령이 어느 열린 오너 항목에도 안 맞을 때는 `!` 입력을 읽는 hook `H/owner_input.py` 가 쓴다. 현황 열린 항목 절에서 `그 외` 리드 행 아래 PR 행으로 오르고, 오케스트레이터가 잇거나 `unlinked.show_hours`(기본 24)가 지나면 빠진다, 결정 91) | `owner_act_unlinked` | — |
| | REAPER 결과 | `reap_done` · `reap_blocked` | — |
| | REAPER 가 기록 없는 기존 카드나 Docker 자원을 기록에 올림(편입). 어떤 종류(`kind`)와 근거(카드 목록 · Docker 의 작업 폴더)로 올렸는지를 싣는다 | `resource_adopted` | — |
| | REAPER 라운드 한 번의 기록: 시각 · `trigger`(`timer`·`hint`) · `roots_ok` · `round` · `mark_only`(설정에 `reaper` 칸이 없어 표시만 한 라운드에만 true. 루트 실패가 아니다, 결정 174) · 읽은 카드 수 · 표시/후보/정리/모름 수 · Docker 건너뜀 여부(`docker` 명령 없음 한 줄, 결정 201) | `reap_round` | — |
| | 후보 최초 관측과 해제. 유예와 연속 두 라운드를 세는 근거이고 REAPER 만 쓴다. 필드 `kind`·`ref`·`round`·`state`(`seen`·`cleared`) | `reap_candidate` | — |
| | `trigger` = `timer` 인 마지막 라운드가 라운드 간격의 세 배보다 오래 없거나, `roots_ok` 거짓인 라운드가 연속 3회일 때 쓴다. 타이머 멈춤 감지가 멈춤 하나당 한 번 쓰고 `kind` 칸에 멈춘 일의 이름(`reaper`)을 싣는다. 오케스트레이터를 Orca 메시지로 깨운다 | `timer_stalled` | — |
| | land 요청 결과: 판정이 통과해 머지를 예약했거나 "승인되면 머지"를 남겼다 · 거부되었거나 예약·대기열이 실패했다 | `land_requested` · `land_failed` | land_done(머지됐다는 사실은 `pr_merged`) |
| | 만든 쪽이 남기는 자원 기록. `kind` 에는 프로세스 · worktree · 터미널 · compose · 증거 파일 위치와 Docker 넷(컨테이너 · 볼륨 · 네트워크 · 이미지)이 온다 | `resource` | — |
| | 항목의 부가 정보를 붙임·바꿈, 상태를 바꾼 함수가 Orca 호출 뒤에 남기는 이력(원본은 Orca Task 이고 이 줄은 기록이다) | `item_created` · `item_extra_set` · `item_transition` | item_state |
| | 머지 없이 닫힌 PR 의 완료 항목을 거둠({task, by, reason}, 항목마다 한 줄). Orca 에는 쓰지 않고 그 항목은 🗑️ 취소로 읽힌다(결정 223) | `item_retired` | — |
| | 우선순위 지정 | `priority_set` | — |
| | 간선 더함·뺌 | `edge_added` · `edge_removed` | — |
| | 흐름 틀 펼침·단계 건너뜀(건너뜀은 `flow_step_skip`·`sangsoe graph skip`, 이유 필수. 결정 195) | `flow_expanded` · `flow_step_skipped` | — |
| | 결정 열림·닫힘 | `decision_opened` · `decision_closed` | — |
| | 열린 같은 결정 키에 대기자가 합류함 | `decision_joined` | — |
| | 결정에 답이 달림. 답을 잇는 쪽을 `linked_by`(hook·button·orchestrator·observed)에 적는다(게이트를 푸는 대상) | `decision_answered` | — |
| | 한 단계 위로 올림 | `escalation` | 에스컬레이션 보고(오너에게 간 것을 가리킬 때) |
| | 거부 보고: 세션의 escalation 이 가리키는 `orch-refusal/` 아래 파일의 `Act:`·`Category:` 머리 줄을 orca-monitor 가 읽어 쓴다(결정 196) | `refusal_report` | — |
| | 증거·배포 확인. `evidence` 줄은 칸 `kind`(증거 종류: 테스트 출력 · 실행 출력 · 화면 · dev 확인 등) · `head_sha`(증거가 가리키는 머지할 head) · `exit_code`(명령의 종료 코드) · `not_verified`(확인하지 못한 것을 적는 칸)을 싣는다. 큰 파일은 증거 폴더에 두고 event 에는 경로와 sha256 만 둔다. head 가 바뀌면 이전 증거는 그 head 에 대해 무효다 | `evidence` · `kind` · `head_sha` · `exit_code` · `not_verified` · `stage_recorded` | — |
| | 검증 등급이 정해지거나 바뀜(pr-monitor 가 쓰는 하나뿐인 쪽) | `verify_tier_set` | — |
| | 워커 완료 보고. PR 이 걸린 일은 그 본문이 머지 대기 보고다(결정 175). 실제 보고는 Orca 메시지이고, 이 이름의 event 줄은 orca-monitor 가 그 메시지를 본 표지(id 만, `outcome`·본문 없음)다(결정 196) | `worker_done` | — |
| | 모델 도중 변경({from, to, reason}) | `model_changed` | — |
| | 단위 시작 행: `start_unit` 이 고른 정책 행과 고른 까닭(kind·class·role), 모델·effort·advisor·전달 길·예산과 시작 때 쓴 호출 수(결정 200) | `unit_started` | — |
| | advisor 호출 한 번: Stop hook 이 transcript 에서 읽은 advisor 의 모델과 토큰 수. 비용은 읽을 때 카탈로그 가격으로 계산한다(결정 200) | `advisor_used` | — |
| | 신호 한 종류 묶음({kind}) | `signal` | — |
| | `signal` 의 kind | `loss` · `wait` · `orchestrator_correction` · `main_flake` · `start_refused` | — |
| | 시작 함수가 Dispatch 있는 세션을 열지 못해 시작을 거부함(결정 94). `reason` 은 `capability_missing` · `lineage_invalid` · `depth_exceeded` · `model_invalid`(advisor 짝이 맞지 않음, 결정 187) · `orca_error` · `no_dispatch` 중 하나다. 일이 들어간 세션은 없고, 시작을 요청한 세션이 그 일을 맡긴 쪽에 escalation 으로 올린다 | `start_refused` · `capability_missing` · `lineage_invalid` · `depth_exceeded` · `model_invalid` · `orca_error` · `no_dispatch` | `start_fallback`(결정 59 의 옛 이름. 결정 94 가 `start_refused` 로 바꿨다) |
| | 오너 말과 분류 | `owner_action` · `owner_class` | — |
| | 원문 지우기 | `owner_text_redacted` | — |
| 저장소 단위 기록 | 머지·main 상태를 저장소마다 하나로 쌓는 event 묶음 | `land_*` · `main_*` | — |
| plugin 승인 기록 | `sangsoe plugin approve` 가 `orca plugin enable` 에 성공한 뒤에만 쓰는 줄. Orca 의 승인 상태를 복사하지 않고 sangsoe 가 승인했다는 사실만 남긴다(결정 104) | `plugin_approved` | — |
| 리뷰 판정 | 독립 리뷰 하나가 PR head 하나에 낸 판정(Act-on 수 · 리뷰어 · 작성자). 쓰는 곳은 코어 기록 함수 하나이고, 입구는 리드가 부르는 MCP tool `review_record` 와 사람이 부르는 `sangsoe review record` 다(결정 111·162) | `review_verdict` | 리뷰 통과 표시 |
| event 칸 | 한 줄의 칸 | `seq` · `ts` · `type` · `source` · `target` · `subject` · `entity` · `entity_id` · `actor` · `needs` · `severity` · `dedupe_key` · `before` · `after` · `schema_v` | by |
| `needs` 값 | 누구를 깨우나: 기록만·스크립트나 지정 수행자·에이전트 | `none` · `action` · `judgment` | — |

## 10. 전달·원칙 용어

| 용어 | 정의 | 영문 식별자 | 쓰지 않는 말 |
|---|---|---|---|
| goal | Claude Code 의 `/goal`. 결정 121 뒤로 워커·리드의 끝을 정하지 않는다: 끝은 Dispatch 와 `worker_done` 이다. 첫 프롬프트에 `/goal` 줄이 있어도 끝나는 조건은 브리프다 | `/goal` | 목표 |
| escalation | 못 푼 문제·결정을 에이전트 트리 위로 한 단계씩 올리는 것. 이 뜻 하나뿐이다 | `escalation` | 에스컬레이트(모델 승격이나 거부에) |
| 거부 보고 | 거부된 행위를 일을 준 쪽에 바로 알리는 것. escalation 이 아니다 | `refusal_report` | 거부 escalation |
| 모델 승격 | 정책 행의 기본값을 벗어나는 것. effort 를 사다리대로 먼저 올리고, 끝에서도 모자라면 이유를 적고 다음 tier 로 간다. escalation 이 아니다 | `model_changed` | 프로필 승격/강등 |
| 재시도 1회 | 거부된 행위를 조건을 갖춰 한 번만 다시 하고 보고하는 형식 | `재시도 1회: <더한 증거>` | — |
| 위임 게이트 | 오케스트레이터가 조율 밖 도구 호출을 못 하게 막는 게이트 | `[gate:delegate]` | — |
| 압박 게이트 | 머신 부하가 높을 때 무거운 시작을 거부하는 게이트 | `[gate:pressure]` | — |
| 루프 게이트 | 포그라운드 sleep 반복 대기를 거부하는 게이트 | `[gate:sleep-loop]` | — |
| 자기 머지 게이트 | 자기가 연 PR 이 열려 있는데 land 요청(`land_requested`: 머지 예약 또는 `merge_on_approval`) 없이 끝나지 못하게 하는 게이트. 머지를 예약했거나 "승인되면 머지"를 남겼으면 PR 이 열려 있어도 끝낼 수 있다 | `[gate:self-land]` | — |
| 게이트 이름 | 차단 문구가 시작하는 형식 | `[gate:이름]` | — |
| 게이트 4종 | 압박·루프·위임·자기 머지 게이트. 본문과 그림은 "게이트 4종"이라고만 쓰고 이름은 부록 §게이트와 원칙에만 둔다. PreToolUse hook 은 이 넷에 가드 둘(세션 시작 가드 `startGuard`, 보고 주소 모양 검사 `reportAddress`)을 더한 여섯을 돌린다(`core/gates/index.ts` 의 `GATES`). 가드는 가정을 담은 게이트가 아니라 입력 모양을 막는 검사라 4종에 세지 않는다 | — | — |
| Orca 자동화 | 에이전트 프롬프트를 주기로 실행하는 Orca 기능. 모델 없는 감지기에는 쓰지 않는다(plugin worker 타이머가 한다). 모델이 필요한 주기 작업이 생길 때, 그리고 첫 빌드 시험 T2 가 실패해 `--precheck` 가 타이머를 대신할 때만 쓴다 | `orca automations` | 상주 실행, 데몬, cron |
| 배치 규칙 | 구성요소는 Orca plugin 이 할 수 있으면 Orca plugin 에 둔다. Claude Code plugin 에는 Claude Code 안에서만 되는 것(Claude Code hook·skill·MCP 서버·agents 정의)만 남긴다. 한 저장소에 매니페스트 둘과 공유 코어 하나를 둔다 | — | — |
| 배치표 | 구성요소마다 네 칸(Orca CLI 내장 기능·Orca plugin·Claude Code plugin·공유 코어) 중 어디에 사는지, 이유 한 줄, 확인·미확인을 적은 표. design.html 2절 | — | — |
| 네 칸 | 모든 기능과 컴포넌트를 정확히 하나에 놓는 네 자리. 첫째 Orca CLI 내장 기능 · 둘째 Orca plugin · 셋째 Claude Code plugin · 넷째 공유 코어. 이 순서가 판정 순서이고 앞 칸이 할 수 있으면 뒤 칸에 만들지 않는다. 도식 1 이 그린다 | — | 세 칸, 두 plugin 배치 |
| Orca CLI 내장 기능 | 첫째 칸. 만들지 않고 그대로 부르는 Orca 의 명령. 칸마다 어느 컴포넌트가 어떤 명령으로 부르는지 본문 2절 표가 적는다 | — | Orca 기능(칸 이름으로) |
| plugin 켜기 | 첫째 칸의 한 행. 코드를 도는 plugin 을 Orca 가 승인 명령으로 켜는 것. 승인 대상은 둘째 칸, 승인 검사는 넷째 칸에 있다 | `plugin enable --approve` | — |
| 연결점 | 두 plugin 이 이어지는 곳. 공식 직접 통신 경로가 없어 공유 코어(sqlite)와 Orca CLI 둘뿐이다 | — | 다리, 직접 호출 |
| 흐름 | 네 칸 사이를 오가는 일의 순서. 유닛 시작 · 결정 · 머지 · 모니터에서 깨움까지 넷과 앞선 오너 지시 하나. 흐름마다 "누가 → 무엇으로 → 누구에게"를 단계별로 그린 도식 한 장이 있다 | — | 시나리오(그림을 가리킬 때) |
| 경계 | 칸 사이를 건너는 자리 다섯: hook ↔ 공유 코어 · MCP 서버 ↔ 공유 코어 · Orca plugin worker ↔ 공유 코어 · 공유 코어 ↔ Orca CLI · Orca plugin ↔ Claude Code plugin(직접 경로 없음). 경계마다 오가는 것과 원본을 본문 5절 표가 한 줄씩 적는다 | — | — |
| 확인 근거 | 확인 칸의 표기: 실행(이 호스트에서 돌려 봄) · 도움말(`--help`·`agent-context` 로 명령이 있음을 읽음) · 문서(공식 문서) · 미확인(돌려 보지 않은 동작) | — | — |
| 설치 순서 | 사람이 실행하는 명령의 순서: `brew install` → `sangsoe install` → `sangsoe plugin approve`(확인은 `sangsoe doctor`). 갱신은 `brew upgrade` 와 `sangsoe install`, 제거는 `sangsoe uninstall` 과 `brew uninstall`. 본문 2절, 결정 90 | — | 마켓플레이스 추가부터 따로 하는 설치 |
| `sangsoe install` | 브루가 깐 트리 하나를 Claude Code(`claude plugin marketplace add` · `install`)와 Orca(`orca plugin dev load`)에 등록하는 멱등 명령. 승인은 부르지 않고 안내만 한다. `doctor` 는 등록 위치와 세 버전이 같은지 읽고, `uninstall` 은 등록을 되돌린다(결정 90) | `sangsoe install` · `sangsoe doctor` · `sangsoe uninstall` | 브루 post_install 에서 등록 |
| Orca plugin | Orca 가 읽는 plugin 매니페스트(`orca-plugin.json`)로 싣는 쪽. 둘째 칸이고 Orca plugin 이 할 수 있는 것을 전부 싣는다: plugin worker 의 타이머로 도는 monitor 5개·패널·상태 표시줄 항목·Orca 이벤트 처리·타이머 멈춤 감지·REAPER·plugin 저장소. 켤 때 오너가 `--approve` 로 승인한다 | `orca-plugin.json` | — |
| Claude Code plugin | Claude Code 가 읽는 plugin 매니페스트(`.claude-plugin/plugin.json`)로 싣는 쪽. 셋째 칸이고 Orca plugin 이 못 담는 것만 싣는다: hook·skill·MCP 서버(tools + resources)·agents 정의 | `.claude-plugin/plugin.json` | — |
| 공유 코어 | 넷째 칸. 두 매니페스트가 같은 저장소 안에서 함께 부르는 코어 라이브러리(TS/Node)와 sqlite 파일 하나와 셸 호출자 전용 CLI. 에이전트는 MCP 만 쓴다 | — | 이중 코어 |
| plugin worker | Orca plugin 의 `main` 코드. Orca 호스트의 별도 Node 프로세스로 사용자 계정 권한으로 돈다. monitor 의 타이머·이벤트 처리·패널 요청 처리를 맡는다. 역할 워커와 다른 것이다 | `main` · `trusted-worker` | — |
| plugin 승인 | plugin worker 를 켜는 오너 승인. `sangsoe plugin approve` 코어 함수 하나로만 하고, 오너가 직접 친다(`sangsoe install --permissions` 가 더하는 규칙 17개에 이 명령은 없다, 결정 221·263). 명령이 독립 리뷰 지적 0으로 main 에 머지된 버전인지, 폴더의 내용 해시(`contentHash`)가 main 의 빌드 커밋 트리와 리뷰된 head 트리와 같은지(결정 105, `orca plugin inspect` 는 지문을 주지 않는다), 대상이 sangsoe plugin 자신인지 검사하고 통과할 때만 `orca plugin enable --approve <지문>` 을 부르며 승인 event 를 남긴다. `orca plugin enable` 자체는 허용 목록에 두지 않는다. MCP tool 이 아닌 호출 경로 규칙의 예외다 | `plugin approve` · `orca plugin enable` · `orca plugin inspect` · `permissions.allow` | — |
| 첫 빌드 시험 | 구현의 첫 단계가 돌리는 시험 T1~T6. 결과가 설계의 갈래를 정하고, 실패하면 정해 둔 대체가 적용된다: T1 worker 안 `node:sqlite` → 코어 프로세스를 CLI 로 부름 · T2 worker 타이머 → `orca automations --precheck` · T3 패널 그림 → 상태 표시줄과 `sangsoe brief` 출력 · T4 승인 뒤 자율 범위와 재승인 빈도 · T5 Dispatch 재시작 거부와 세 번 실패 차단(PR 작성자의 끝은 결정 175 가 `worker_done` 하나로 정했다). T6(결정 90) 경로 마켓플레이스 설치와 `brew upgrade` 뒤 갱신, hook PATH 의 `sangsoe`, 개발 폴더로 올린 Orca plugin 이 앱 재시작 뒤에도 남는지. 어느 것도 오너 결정을 기다리지 않는다 | `T1`~`T6` | 오너 결정 대기 |
| Orca·Node 호스트 낱말 | 호스트가 정한 이름이라 sangsoe 가 바꾸지 않는 것: worker 가 돌리는 파일 형식 `.ts`, Orca plugin 매니페스트의 빈 칸 `mcpServers`, Node 의 내장 sqlite `node:sqlite`, command hook 만 갖는 실패 시 막기 `onFailure: "block"`, plugin 로컬 시험 `orca plugin test`, worktree 삭제 `orca worktree rm`, 입력을 받을 때까지 기다리는 `tui-idle`(대체 시작이 없어져 쓰지 않는다, 결정 94), Orca 가 돌려주는 거부·승인 코드 `approval_required`·`approval_stale`·`consumer_fenced`·`task_not_startable`·`task_id` | `approval_required` · `approval_stale` · `consumer_fenced` · `task_not_startable` · `task_id` · `.ts` · `mcpServers` · `node:sqlite` · `onFailure: "block"` · `orca plugin test` · `orca worktree rm` · `tui-idle` | — |
| 패널 | Orca plugin 이 오른쪽 사이드바에 그리는 화면. 현황 세 단계·오너 할 일·결정 버튼을 낸다. 폭은 사이드바가 정한다. Orca 패널처럼 머리 행(새로 고침·터미널에서 전체 현황·더 보기)과 1단계의 탭(전체 · 할 일 · 열린 항목)을 두고 색은 Orca 테마 변수를 따른다(결정 169) | `panels` | 웹 화면, 페이지(패널을 가리킬 때) |
| 상태 표시줄 항목 | Orca 상태 표시줄에 이름표와 건수 줄의 짧은 꼴(`✨ SANGSOE | 🚧 2 | 결정 2 | 🔄 5`: 막힌 것 · 열린 결정 · 진행 중, 재시작이 밀렸으면 `♻️ N`, 결정 170·219)을 올리는 항목. 숫자는 `BriefModel.summary`·`owner_todo` 에서 오고 따로 세지 않는다. 🚧 가 있거나 오너의 결정·할 일이 있거나 재시작이 밀렸으면 `danger` 색이고 누르면 명령이 실행된다(패널 열기는 미확인, 결정 92) | `statusBarItems` · `statusBar.update` | 오너 할 일 수·🚨 항목 |
| 호출 경로 규칙 | 코어는 하나이고 에이전트(리드·워커·오케스트레이터)는 MCP 만 쓴다. Bash 로 CLI 를 부르지 않는다. CLI 는 셸에서만 도는 호출자 여섯 행(시작 hook·막는 hook·기록 hook·오너 전용 skill 의 상태 주입 줄·사람 터미널·시험·CI·승인 명령)용으로 얇게 둔다. plugin worker(패널 버튼·monitor 타이머)는 코어를 직접 import 한다 | — | — |
| 폴백 웹 화면 | 패널로 안 되는 기능만 맡는 최소 웹 화면(같은 코어·같은 읽기 뷰, 새 수집기 없음). 지금은 범위가 비어 있어 두지 않는다 | — | 웹 대시보드 |
| 외부 plugin | sangsoe 밖에서 만든 Orca plugin. Orca 에는 plugin 사이 공식 데이터 교환 경로가 없어서 sangsoe 는 기대지 않는다 | — | — |
| Act-on | 리뷰 판정에서 고쳐야 할 지적. Consider 는 항목이 되지 않는다 | `Act-on` | — |
| 내장 먼저 | 새로 만들기 전에 Orca 기능 → Claude Code 기본 기능 → 공개 도구 → 자체 스크립트 순으로 본다 | — | — |
| 티켓 도구 | sangsoe 밖에서 티켓을 관리하는 도구(Jira·Linear 등은 예일 뿐 sangsoe 는 이름을 가정하지 않는다). 일의 기록은 Orca Task 이고, 티켓은 일을 하는 워크스페이스에 `reference add` 로 키·주소만 붙인다. 워크스페이스가 아직 없는 📅·🟢 항목은 Task 의 제목·`spec` 글에 키를 적어 두고 워커 시작 절차가 워크스페이스를 만든 뒤 붙인다. sangsoe 는 트래커를 읽지도 쓰지도 동기화하지도 않고, 티켓 상태를 옮기는 일은 그 도구가 참조를 읽어서 한다(결정 93) | `reference add` · `reference find` | tracker, 트래커 |
| Orca 기능 활용 표 | Orca 기능마다 sangsoe 가 쓰는지(씀) · 나중 · 안 쓰는지(안 씀)와 맡는 컴포넌트·이유·확인 여부를 적은 표. 기본값은 씀이고 안 씀은 Orca 에 그 기능이 없거나 sangsoe 범위 밖일 때뿐이다. 부록 `#orca-feature-table` | `#orca-feature-table` | — |
| 확인 / 미확인 | Orca 기능 판정의 근거 표시. 등급은 실행·도움말·문서·미확인 넷이다(확인 근거 항목). 확인(실행)은 읽기 전용 실행으로 출력 모양을 본 것, 확인(도움말)은 도움말·스키마로 명령이 있음을 읽은 것, 확인(문서)는 공식 문서로 읽은 것이고, 미확인은 돌려 보지 않은 동작이다 | — | — |
| Orca Dispatch | Orca 가 Task 를 워커에 배정한 기록. Run 을 쥔 쪽이 `ready` 뷰에서 골라 `worker-start --task` 로 직접 시작할 때 생기고 `worker_done`·escalation·자동 정리가 이것을 따라 돈다. 이중 시작은 이미 `dispatched` 인 Task 가 막아야 하고(시험으로 확인), 실패가 쌓이면 Dispatch 가 끊긴다. sangsoe 에는 claim·세대·lease 가 없다 | `Dispatch` · `worker-start` | claim, 세대, lease |
| 시작 거부 | 코어의 시작 절차가 `worker-start` 로 Dispatch 있는 세션을 열지 못할 때 하는 일. 다른 길로 세션을 열지 않고 `signal`(`start_refused`)을 남기며, 시작을 요청한 세션이 그 일을 맡긴 쪽(리드는 오케스트레이터, 오케스트레이터는 `owner_todo`)에 escalation 으로 올린다. 부모는 같은 일을 자기 Run 에서 다시 시작하지 않는다(결정 94) | `start_refused` | 대체 시작(결정 59 의 `agent launch` 길. 결정 94 가 없앴고 `agent launch` 는 쓰지 않는다) |
| 중첩 워커 깊이 | Orca 가 워커가 워커를 시작할 수 있는 깊이를 정하는 설정. 워커 시작 절차가 시작 전에 읽고, 오케스트레이터는 리드를 시작하기 전에 읽어 리드 아래 워커를 열 수 없으면 리드 없이 자기 Run 에서 프로그램을 돌린다(결정 94). 읽는 길은 미확인이다 | — | — |
| skills over MCP | MCP 서버가 skill 을 배포하자는 제안(SEP-2640). sangsoe 는 쓰지 않는다(부록 §MCP 인터페이스) | — | — |
| 부록 | `design-appendix.html`. 본문이 줄여 말한 것의 전체 내용 | — | 별첨 |
| 허용 도구 줄 | skill 머리글의 `allowed-tools` 칸. 그 skill 이 도는 동안 권한을 묻지 않고 허용할 도구·명령을 적는다 | `allowed-tools` | — |
| 기존 설계 참고 | 설계 결정마다 이미 있는 해법을 가져다 씀·아이디어만 참고·안 씀으로 판정한 부록 절 | `#prior-art` | 벤치마크 |
| 가져다 씀 · 아이디어만 참고 · 안 씀 | 기존 설계 참고의 세 판정 | — | 채택, 참조, 기각 |
| 오너를 막지 않는다 | 결정을 물을 때 추천을 함께 적고 기다리는 동안 다른 일을 계속한다 | — | — |
| 완료 조건 | 프로그램을 닫는 조건. 시작 전에 적는다 | — | 수락 기준 |
| 설계 관점 | sangsoe 를 읽는 세 관점(harness · loop · graph engineering). 본문 1절의 소절이고 그림은 부록 `#perspectives-figure` | `#perspectives` | — |
| harness engineering | 모델 바깥의 환경을 만드는 일. sangsoe 에서는 hook · 게이트 · 거부 규칙 · `event` · Orca 메시지 · 감지기 · 실행 역할 · REAPER 를 가리키며 설계의 중심이다. 업계에 합의된 정의가 없어 이 뜻으로만 쓴다 | — | 하네스 개발 |
| loop engineering | 역할마다 도는 루프와 그 멈추는 조건을 정하는 일. 워커는 브리프의 끝나는 조건과 `worker_done` 한 번, 리드는 Orca 메시지 대기(`check --wait`) → 처리 → 대기, 오케스트레이터는 Orca 메시지로만 깨어남. 정기적으로 훑는 LLM 루프는 두지 않는다 | — | 루프 설계 |
| graph engineering | 일의 순서(의존 간선 · 흐름 틀 · 크리티컬 패스)에 한해 그래프를 쓰는 일. 오너 지시 흐름과 에이전트 대화 경로는 그래프로 고정하지 않는다(event 기반 상태 기계) | — | 그래프 설계, 그래프 프레임워크 |
| plugin 구성 칸 | Claude Code plugin 이 싣는 갈래 | `hooks` · `skills` · `agents` · `scripts` | — |
| 코어 라이브러리 | 부가 정보·부가 간선·결정·뷰 계산과 Orca 호출을 하는 코드 한 벌(TS/Node). MCP 서버·CLI·plugin worker 가 부른다 | — | 공용 모듈 |
| 어댑터 | 코어 라이브러리를 부르는 입구. 셋이다: MCP 서버(에이전트), CLI(`sangsoe`, 셸 전용 호출자), plugin worker(코어를 직접 import) | — | 프런트엔드 |
| MCP 서버 | 코어 라이브러리의 어댑터로 tools 와 resources 를 내는 stdio 서버. 저장소가 아니고 세션마다 하나씩 뜬다. plugin 루트의 `.mcp.json` 으로 싣고 plugin 이 켜지면 Claude Code 가 띄운다 | `#mcp` | — |
| plugin MCP 등록 | plugin 루트의 파일 하나로 MCP 서버를 싣는 길 | `.mcp.json` | — |
| MCP prompts | MCP 의 사용자 호출 템플릿. 쓰지 않는다: 오너 전용 skill 이 같은 입구를 낸다 | `prompts/get` | — |
| mcp_tool hook | 세션 안 hook 이 plugin 서버의 tool 을 부르는 형식. 세션 시작에는 못 돌고 서버가 없으면 막지 못한다 | `mcp_tool` | — |
| 오너 전용 skill | 모델은 못 부르고 오너가 슬래시로만 부르는 skill. 본문의 명령 줄로 호출 시점의 현황을 싣는다 | `disable-model-invocation` | — |
| tool 오류 | tool 이 거부를 사유·코드·다음 할 일과 함께 구조화해 돌려주는 모양 | `isError` | — |
| tool (MCP) | MCP 서버가 내는 행동 하나(`event` 를 쓰는 일). 읽기는 tool 로 만들지 않는다 | — | — |
| resource (MCP) | MCP 서버가 내는 읽기 상태(현황 단계 · 항목 · 그래프 · 결정). 뷰가 곧 resource 다 | — | — |
| 세션 id | Claude Code 세션의 식별자. 생존·활동 판정의 기준이다. 터미널은 세션을 가리키는 참조일 뿐이고 한 세션에 터미널이 여럿 붙을 수 있다 | `cc_session` | 터미널 단위 생존 판정 |
| resource 구독 | MCP 의 `resourceSubscriptions`(서버가 resource 갱신을 알리는 기능). Claude Code 가 요청하지 않아 안 씀(재검토 조건: anthropics/claude-code#106696이 닫히고 깨움이 확인될 때). 깨움은 Orca 메시지 | `resourceSubscriptions` | — |
| MCP tasks | MCP 의 오래 걸리는 일 확장(`io.modelcontextprotocol/tasks`). 쓰지 않는다: 후보 일은 세션 밖이고 Orca 가 이기며, 세션 안 장시간 호출은 Claude Code 내장 백그라운드가 한다 | `io.modelcontextprotocol/tasks` | — |
| 결정 루프 회귀 시나리오 | 결정 루프가 겪은 실패 사례를 다시 돌리는 시험 11개(앞 넷은 결정 루프, 뒤 일곱은 결정 91) | `decision_reask_blocked` · `decision_answer_linked` · `owner_direct_merge` · `answer_gate_unresolved` · `waiting_human_released` · `owner_item_probe_closes` · `decision_moot_closed` · `late_answer_reaches_next_worker` · `owner_act_unlinked_expires` · `owner_ran_command_marks_verifying` · `owner_input_probe_fails_no_change` | — |
| 역할 끄기 줄 | sangsoe 가 만드는 모든 브리프와 역할의 첫 프롬프트에 넣는 한 줄. 전환 전에 agent-skills 가 켜진 PC 에서 sangsoe 세션을 시험할 때 agent-skills 의 역할 판정을 꺼 두 plugin 의 규칙이 겹치지 않게 한다 | `ROLE: none` | — |
| worker_start_dispatched | 회귀 시나리오: 중첩 워커 깊이 설정이 3 인 Orca 에서도 워커 시작 절차가 설정을 읽고 `worker-start` 로 시작해 Dispatch 가 생긴 워커를 띄운다. 세 경우를 가른다: 깊이가 모자라면 시작을 거부해 `signal`(`start_refused`, `depth_exceeded`)을 한 줄 남기고 부모에게 escalation 을 한 통 보내며 일이 들어간 세션은 없다 · 깊이가 충분하면 Dispatch 가 있고 event 는 0 · 설정을 읽지 못하고 영수증에 Dispatch 가 없으면 성공으로 세지 않고 `start_refused`(`no_dispatch`)를 남긴다(결정 94) | `worker_start_dispatched` | — |
| unit_lineage_complete | 회귀 시나리오: 가짜 Orca 와 실제 Orca 둘 다에서 시작한 단위마다 `parentWorktreeId` 와 Run·Dispatch 를 읽어 부모나 Dispatch 가 없으면 실패한다(결정 94) | `unit_lineage_complete` · `parentWorktreeId` | — |
| raw_start_refused | 회귀 시나리오: 에이전트가 코어를 거치지 않고 세션을 여는 명령(`orca agent launch`, 프롬프트나 `--agent` 를 붙인 `worktree create`, 백그라운드 `claude`, 직접 부른 `worker-start`·`dispatch`)을 막는 hook 이 거부하고 쓸 MCP tool 을 알린다. 코어의 정상 시작은 막히지 않는다(결정 94) | `raw_start_refused` | — |
| one_session_two_terminals | 회귀 시나리오: 한 세션에 터미널이 둘 붙어 있고 세션이 활동 중이면 orca-monitor 가 "깨우는 길 없음"을 쓰지 않는다 | `one_session_two_terminals` | — |
| 재시작 권고 | 오케스트레이터·리드의 컨텍스트가 길어 `/clear` 가 안전한 때를 `compacted` 에서 계산하는 뷰. 네 규칙(자동 압축 횟수 · 압축 직후 첫 호출이 압축 전의 절반 이상 · 최근 두 압축 간격 · 토큰 상한)이고 기본값은 설정이다. 시계가 아니라 이 규칙으로만 판정하고 자동 `/clear` 는 기본 꺼짐이다 | `restart_due` | 정기 재시작 |
| 인계 저장 | 재시작해도 남아야 하는 판단 상태 넷(다음에 할 일 · 기다리는 답 · 답 없는 질문 · 오너 요청의 회신 경로)의 모양을 검사해 Orca 메시지 type `handoff` 로 자기 Run 우편함에 남기는 MCP tool. 새 세션이 같은 우편함에서 읽는다 | `handoff_save` | — |
| 복구 계획 | 머신·Orca 재시작 뒤 Orca `worker-list` 의 워커를 Task · Dispatch · 상태 · liveness · 터미널 · worktree 한 표로 모으고 잃었을 수 있는 워커를 표시하는 읽기 전용 코어 함수. 죽은 워커 찾기와 되살리기는 Orca 가 하고 이 함수는 실행하지 않는다 | `recover_plan` | — |
| 의뢰 기록 입구 | 리뷰 의뢰를 `review_ask_sent` 로 남기는 MCP tool. 손으로 보낸 의뢰도 자동 의뢰도 이 입구 하나를 지난다 | `review_ask_record` | — |
| 판정 기록 입구 | 리드가 독립 리뷰 판정을 `review_verdict` 로 남기는 MCP tool. 부른 세션의 checkout 이 그 PR 의 head 를 쥐었으면(PR 을 쓴 세션) 거부한다(결정 162) | `review_record` | — |
| 증거 기록 입구 | 검증 실행의 결과를 PR head 의 `evidence` 로 남기는 MCP tool. land 의 `evidence_missing` 이 이 입구를 가리킨다. 작성자와 그 PR 을 쥔 세션은 거부한다(결정 171) | `evidence_record` | — |
| 단계 기록 입구 | 머지된 PR 이 `merge`·`dev`·`prod` 에 닿았음을 `stage_recorded` 로 남기는 MCP tool. `deploys_after` 가 기다리는 것이 이 줄이다(결정 171) | `stage_record` | — |
| 리마인드 대상 | 리마인드할 때가 된 의뢰를 `review_ask_sent` 에서 계산하는 뷰 | `ask_due` | — |
| 릴리스 묶음 틀 | 여러 항목이 dev 배포·확인·prod 승격 한 번을 함께 쓰는 흐름 틀. 흐름 변수 `members`(항목 id 목록)의 구성원을 Orca deps(`blocks`)로 기다리고, 증거는 구성원 PR 마다 하나씩 쓰는 `stage_recorded`(`pr`·`stage`·`sha`, `members` 칸은 없다)다. 단독 긴급 수정은 `ship-change` 다 | `ship-batch` | — |
| main 수정 land | 그 저장소의 최신 main 이 `main_red` 인 동안 land 판정 함수가 받는 유일한 요청 종류 | `main_fix` | — |
| 감시 범위 | pr-monitor 가 읽는 PR 의 범위를 정하는 설정 키. 기본은 자기 프로그램·항목에 연결된 PR 만이고 "연결됨"은 Orca `reference` 조회가 원본이다 | `watch`(`repos` · `authors` · `linked_only`) | — |

## 11. CLI 하위 명령 (`sangsoe`)

| 용어 | 정의 | 영문 식별자 | 쓰지 않는 말 |
|---|---|---|---|
| brief | 1단계 현황. Markdown 표 네 절을 출력한다(결정 89) | `sangsoe brief` | status, board |
| brief 묶음 | 2단계. 묶음 id(`lead:<name>`·`<name>`·`others`)를 받는다 | `sangsoe brief <id|name>` | — |
| brief 항목 | 3단계. 묶음과 항목(`iNNN`)을 받는다 | `sangsoe brief <id> <item>` | — |
| todo | 오너 할 일 | `sangsoe todo` | — |
| models | 모델 표 보기: 카탈로그 · 일의 종류별 정책 · 지금 걸린 고정 · 확인한 날(읽기만, 토큰 X). `--markdown` 은 `docs/models.md` 의 원문을 낸다(결정 200) | `sangsoe models` | — |
| verify-tier | PR 의 검증 등급과 사유, 요구 증거와 모자란 것을 보인다(읽기 전용, 아무것도 쓰지 않는다). 셸 호출자(사람 · 시험 · CI)용이고 에이전트는 land tool 의 결과와 항목 상세로 본다 | `sangsoe verify-tier <pr>` | — |
| land | land 요청 하나: 판정하고 조건 넷이 참이면 머지를 예약하고 아니면 승인되면 머지를 남긴다 | `sangsoe land <pr>` | orch land |
| recover | 머신·Orca 재시작 뒤 항목 ↔ 마지막 세션 표와 Orca 가 내는 되살리기 `next` 를 출력한다(읽기 전용, 아무것도 실행하지 않는다) | `sangsoe recover` | orch reboot |
| graph | 간선의 유일한 입구. 묶음의 의존 그래프를 보인다 | `sangsoe graph` | — |
| graph add · remove | 간선을 더하고 뺀다(순환은 거부) | `sangsoe graph add` · `sangsoe graph remove` | edge add |
| graph ready | `ready` 뷰를 읽는다 | `sangsoe graph ready` | — |
| graph why | 한 항목이 왜 준비됨·막힘인지 설명한다 | `sangsoe graph why` · `sangsoe graph why <iNNN>` | item why |
| graph expand | 흐름 틀을 항목과 간선으로 펼친다. `--dry-run` 은 미리보기 | `sangsoe graph expand` · `sangsoe graph expand <틀>` · `sangsoe graph expand --dry-run` | item new --flow, flow preview |
| graph skip | 펼친 흐름의 단계 하나를 이유와 함께 건너뛴다(이유가 비면 거부, 결정 195) | `sangsoe graph skip` | — |
| graph critical | 크리티컬 패스를 낸다 | `sangsoe graph critical` | graph --critical |
| graph impact | 영향 범위를 낸다 | `sangsoe graph impact` · `sangsoe graph impact <iNNN>` | — |
| graph sync | 감지 사실로 간선 충족을 갱신한다 | `sangsoe graph sync` | — |
| decision | 결정을 열거나 답을 기록한다. 열 때 재질문 게이트를 지난다. MCP 의 `decision_open`·`decision_answer` tool 과 같은 함수다 | `sangsoe decision add` · `sangsoe decision answer` | — |
| item new | 항목 하나를 만든다 | `sangsoe item new` | — |
| item retire | 머지 없이 닫힌 PR 의 완료 항목을 거둔다. MCP 의 `item_retire` tool 과 같은 함수다(결정 223) | `sangsoe item retire <iNNN> --reason <글> --by <누가>` | — |
| priority | 우선순위를 정한다 | `sangsoe priority set` | — |
| owner-text redact | 원문을 지운다(오너 승인 필요) | `sangsoe owner-text redact` | — |
| hook | Claude Code hook 의 입구. PreToolUse 한 번의 게이트 판정이나 기록 hook 하나를 표준 입력으로 받는다. `--replay` 는 실제 명령 모음으로 게이트를 잰다 | `sangsoe hook` | — |
| monitor run | monitor 라운드 한 번. Orca plugin worker 의 타이머와 같은 함수다. `--dry-run` 은 쓸 event 와 Orca 쓰기를 보이기만 한다 | `sangsoe monitor run` | — |
| reap run | REAPER 라운드 한 번(표시 → 정리). `--dry-run`·`--mark-only` 는 아무것도 지우지 않는다 | `sangsoe reap run` | — |
| resource record | 막 만든 Docker id(또는 compose 프로젝트의 id 전부)를 소유자와 함께 `resource` 로 남긴다. checkout·등록·브랜치·파일·프로세스도 받지만 이것은 오너 몫이라 패널에 보이기만 하고 치우지 않는다(결정 240). MCP `resource_record` 와 같은 함수다 | `sangsoe resource record` | — |
| review record | 독립 리뷰 판정 하나를 `review_verdict` 로 남긴다(결정 111). 리뷰어가 작성자이면 거부한다 | `sangsoe review record` | — |
| evidence record | 검증 실행 한 건을 PR 의 현재 head 에 `evidence` 로 남긴다(결정 171). 기록자가 작성자이면 거부한다. MCP `evidence_record` 와 같은 함수다 | `sangsoe evidence record` | — |
| stage record | 머지된 PR 이 닿은 단계를 `stage_recorded` 로 남긴다(결정 171). 머지 전이거나 기록자가 작성자이면 거부한다. MCP `stage_record` 와 같은 함수다 | `sangsoe stage record` | — |
| migrate | 옛 저장소의 열린 항목·결정을 한 번 가져온다. 옛 DB 는 읽기만 하고 `--apply` 없이는 쓰지 않는다(결정 140) | `sangsoe migrate` | — |
| version | 버전을 출력한다(`--version` 과 같다) | `sangsoe version` | — |
| `--help` | 도움말. 아무것도 바꾸지 않는다 | `--help` | — |
| `--done` | 접힌 완료 목록을 펼친다 | `--done` | — |
| `--dry-run` | 펼치기·적용 전 미리보기 | `--dry-run` | — |

## 12. 패널 화면

| 용어 | 정의 | 영문 식별자 | 쓰지 않는 말 |
|---|---|---|---|
| 현황 | 1단계 패널 화면. 표 네 절과 같은 열(결정 필요 · 지금 오너가 할 일 · 열린 항목 · 보류)을 행마다 한 블록으로 보인다. 오너가 해야 하는 행은 배경색을 입지 않고 🚧 마커와 절 건수가 신호다. 넓은 화면의 표 행은 모두 한 높이다(결정 92). 시안 파일은 `dashboard/hallmark-final/index.html`(hallmark 하나, 결정 92) | `index.html` | 메인, 대시보드 홈, `/#/fleet/brief` |
| 묶음 상세 | 2단계 패널 화면. 한 묶음의 항목을 상태별로, 의존 그래프·크리티컬 패스와 함께. 넓은 화면은 왼쪽 열(그래프 + 그 아래 간선 종류 범례)이 높이를 정하고 오른쪽 열(표 넷)은 같은 높이에서 스크롤하며, 360px 은 그래프 · 범례 · 표 순으로 쌓는다(결정 92). 그래프 표는 열 역할이 너비를 정하고 좁은 패널에서는 테두리 카드로 접히며, 간선 범례는 접혀서 시작한다(결정 218 ⑤ · 220). 시안 파일은 `dashboard/hallmark-final/group.html` | `group.html` | — |
| 항목 상세 | 3단계 패널 화면. 한 항목의 이력·증거·원문. 시안 파일은 `item.html` | `item.html` | — |
| 내가 할 일 | `owner_todo` 뷰의 화면 이름. 패널 맨 위 띠이고, 결정에 답하는 버튼이 여기 있다 | `owner_todo` | 소유자 할 일 페이지, `owner.html`(폐기) |
| 내 지시는 어디까지 갔나 | 현황 아래 접힘 구역. `owner_action` 최근 몇 건과 분류·항목 상태 | `owner_action` | — |
| 대기열 | 묶음 상세의 접힘 구역. 🟢 준비됨·📅 예정·⏸️ 보류 | — | 큐 |
| 누구를 기다리나 | 막힘의 기다리는 쪽별 건수 | — | — |
| 최근 상태 변화 | `item_transition` 최근 줄 | `item_transition` | — |
| 의존 그래프(화면) | 묶음 상세의 선행 → 후속 그림(기본은 인라인 SVG DAG, 들여쓴 목록은 대체)과 크리티컬 패스(결정 92) | `critical_path` | — |
| 줌 | 현황 · 묶음 상세 · 항목 상세 세 단계를 한 캔버스의 연속 줌(L1 · L2 · L3)으로 오가는 보조 화면. 기본 화면이 아니고 새 뷰도 새 명령도 없다(결정 92). 시안 파일은 `zoom.html` | `zoom.html` | 기본 화면 |
| 왜 준비되지 않았나 | 묶음 상세의 표. 열은 항목 · 막는 선행 · 간선 종류 · 선행 상태 · 해야 할 일이고 막는 선행 하나가 한 행이다. `sangsoe graph why` 와 같은 사실이다(결정 92) | `graph why` | — |
| 데이터 신선도 | 화면 위쪽의 갱신 시각 한 줄 | — | — |
| 이력 | 항목 상세의 절. 잡음을 뺀 최근 `event` 줄을 시간순으로 보인다 | `item_timeline` | 히스토리 |
| 답이 전달된 곳 | 항목 상세에서 답한 결정의 전달 대상(게이트가 풀렸는지·`notified` 한 쪽·보낸 시각)을 보이는 절 | `notified` | — |
| 할 수 있는 것 | 항목 상세의 버튼 절(한 줄 보내기·완료·취소(이유)). 모두 `owner_action` 이 된다 | `button` | 액션 |
| 닫힘(결정 칩) | 결정 줄에 붙는 표시. 답이 달려 `decision_closed` 가 쓰인 결정이다. 열린 결정은 🙋 가 센다 | `decision_closed` | — |
| 외부 선행 | 묶음 상세의 의존 그래프에서 다른 묶음에 있는 선행. 그 묶음 이름을 붙이고 점선 테두리로 보인다 | — | 타 묶음 선행 |

## 13. 경로·외부 명령·값

| 용어 | 정의 | 영문 식별자 | 쓰지 않는 말 |
|---|---|---|---|
| sqlite 파일 | `event` 와 번호 표·`owner_text`·캐시 예외 표·보존 기간 표가 든 파일 하나. Orca plugin 저장소가 아니라 plugin 밖 경로에 두고 양쪽 매니페스트가 같은 파일을 연다 | `~/.local/share/sangsoe/sangsoe.db` | — |
| 설정 | 언어·규칙 수준. 사람이 고친다. 모델 선택은 설정이 아니라 `core/models/table.ts` 다 | `~/.config/sangsoe/config.json` · `~/.config/sangsoe/` | — |
| 등급 설정 키 | 검증 등급이 읽는 설정 키. 경로 패턴 목록 셋과 내리기 권한자 목록이다. 값은 설정에만 있고 설계에는 없으며, 읽지 못하면 V3 다(`protected_paths` 는 자동 머지 조건 넷과 같은 키) | `docs_globs` · `test_globs` · `ui_globs` · `owners` · `protected_paths` | — |
| 틀 폴더 | 오너가 덮어쓰는 흐름 틀 | `~/.config/sangsoe/flows/` | — |
| 프로그램 폴더 | 리드의 보고·계획·브리프 | `~/.local/share/sangsoe/programs/<slug>/` · `~/.local/share/sangsoe/programs/<slug>/briefs/*.md` | — |
| 로그 | 줄만 더하는 디버그 로그 | `~/.local/state/sangsoe/logs/` | — |
| 압박 기록 | 압박 감지기의 보조 로그(8일, 4MB) | `~/.local/state/sangsoe/pressure-history` | — |
| 브리프 | 워커에게 주는 지시서 | `briefs/*.md` | — |
| Orca 명령 | Orca 의 워커·메시지·Task·게이트·plugin | `orca orchestration send` · `orca orchestration worker-start` · `orca plugin` | — |
| Claude Code 명령 | 모델·effort 선택과 재개 | `claude --model <id> --effort <level>` · `claude --resume` · `/model` · `/effort` · `/clear` | — |
| PR 머지 직접 명령 | 직접 머지하는 길은 `sangsoe land` 로 돌린다. 머지 예약(`gh pr merge --auto`)과 승인 뒤의 직접 머지는 land 요청 안에서만 한다 | `gh pr merge` | — |
| Docker 명령 | REAPER 가 쓰는 Docker 의 이름. `docker` 명령과 현재 context 만 쓰고 런타임을 가리지 않는다. `docker` 명령이 없을 때만 건너뛰고, 설치된 Docker 가 답하지 않으면 지우지 않고 다음 라운드에 다시 묻는다(결정 201). 지울 때는 id 하나씩, 정지한 컨테이너 → 볼륨 → 네트워크 → 이미지 순서이고 쓰는 중이면 지우지 않는다. 일괄 정리 명령(`prune`)과 `down -v`, 라벨·이름 패턴으로 지울 대상을 거르는 일, base 이미지 삭제는 쓰지 않는다. `working_dir` 라벨은 편입의 근거로 읽는 데만 쓴다 | `docker` · `compose up` · `<project>_default` · `working_dir` · `prune` · `down -v` | — |
| 값 | 값 이름 | `created` · `released` · `deep` · `standard` · `light` | — |
| SQLite 낱말 | 스키마·트랜잭션에 쓰는 SQLite 의 이름 | `UNIQUE` · `RETURNING` · `RAISE(ABORT)` · `BEGIN IMMEDIATE` · `busy_timeout` · `IS NOT 1` · `sha256` | — |
| Claude Code hook 이름 | 감지기가 붙는 이벤트. 도식이 쓰는 이름 전부. 등록된 것은 `claude-plugin/hooks/hooks.json` 의 여덟이다. 거부 수집과 오류 종료는 hook 이 아니라 Orca escalation 이 원천이다(결정 193) | `Notification` · `Stop` · `PreToolUse` · `PostToolUse` · `SessionStart` · `UserPromptSubmit` · `SessionEnd` · `PostCompact` · `Monitor` | — |
| sangsoe 스킬 | sangsoe 가 플러그인에 싣는 판단 절차 스킬. 오너 지시 분류(`intake`), 워커 브리프 쓰기(`write-brief`), 현황 보고(`brief`), 배포 절차(`deliver-ticket`) | `intake` · `write-brief` · `brief` · `deliver-ticket` | — |
| 일반 스킬 | sangsoe 밖의 일반 스킬 | `principles` · `tdd` · `write-plainly` · `prune-comments` | — |
| Orca 읽기 명령 | 상태를 읽는 Orca 명령과 옵션 | `worker-list` · `check --wait` | — |
| Orca 개요 명령 | Orca 가 할 수 있는 일과 이 호스트의 기능을 읽는 명령. 시작 점검과 계약 시험이 쓴다 | `orca help` · `orca agent-context` · `orca agent-context --json` · `agent-context` · `orca status --json` · `runtime.capabilities` · `caller.orcaSessionId` · `orca skills get orchestration` · `skills get` · `skills list` · `skills installed` · `agent hooks status` | — |
| Orca 워커 명령 | 워커를 시작·읽기·붙잡기·해제하는 명령과 그 관측 값 | `worker-start --comment` · `worker-show` · `worker-read` · `worker-read --source auto` · `worker-keep-open` · `worker-release` · `worker-stop` · `worker-abandon` · `observation.agentWait` · `agentWait` · `autoReleaseAt` · `structworker_` · `structured-` · `orchestration.worker-auto-release.v1` | — |
| Orca 메시지·Run 명령 | 메시지 동사와 Run·Task·Gate·Dispatch 의 만들기·읽기. sangsoe 는 Task·게이트·메시지를 쓰고 읽으며 `dispatch` 는 쓰지 않는다 | `question` · `reply` · `@all` · `orca orchestration check` · `check --peek` · `orchestration inbox` · `request-show` · `dispatch-show` · `run-create` · `run-current` · `run-list` · `run-show` · `run-use` · `runs` · `task-create` · `task-list` · `task-update` · `gate-create` · `gate-list` · `gate-resolve` · `run_required` · `coordinator-start` · `coordinator-stop` | — |
| Orca 조회·진단 명령 | 워크트리·터미널·자원의 상태를 읽는 명령. 터미널 화면 읽기는 마지막 수단이다 | `worktree list` · `worktree ps` · `worktree ps --agent-wait` · `worktree create` · `worktree rm` · `--delete-branch` · `worktree set` · `worktree set --workspace-status` · `terminal list` · `terminal create` · `terminal send` · `terminal close` · `terminal wait` · `terminal read --screen` · `draft` · `diagnostics memory` · `orca diagnostics memory` · `ports` · `reclaimable` · `terminal-daemon` | — |
| Orca 참조·검색 명령 | 참조를 붙이고 찾는 명령과 대화 기록 검색. 항목↔PR 연결의 원본과 찾기 보조로 쓴다(PR 상태는 `pr_ref` 캐시에서 읽는다) | `reference add` · `reference find` · `search-refs` · `orca search` · `linked: false` · `resumeCommand` · `enabled` | — |
| Orca 그 밖의 명령 | sangsoe 가 쓰지 않는 Orca 명령 묶음의 이름. 표에서 안 쓰는 이유와 함께 나온다 | `account` · `account list` · `artifacts` · `capture` · `claude-teams` · `click` · `computer` · `cookie` · `current` · `dev watch` · `diff` · `edit` · `emulator` · `environment` · `eval` · `file open` · `fill` · `focus` · `goto` · `host list` · `host name` · `install` · `intercept` · `jira` · `linear` · `mouse` · `off` · `open-changed` · `project list` · `rename` · `repo add` · `repo list` · `reset` · `screenshot` · `serve` · `set-base-ref` · `set-pane-title` · `setups` · `shot` · `show` · `snapshot` · `speech` · `split` · `storage` · `switch` · `tab profile` · `update` · `vm recipe doctor` · `skipped_precheck` | — |
| Orca plugin 명령 | plugin 을 만들고 검증하고 켜는 명령. `--approve` 는 오너 몫이다 | `plugin list` · `plugin validate` · `plugin inspect` · `plugin check` · `plugin test` · `plugin shot` · `plugin enable` · `--approve` · `plugin release-entry` | — |
| Orca 명령(네 칸 표) | 본문 2절 첫째 칸 표와 설치 순서가 쓰는 명령과 옵션. 모두 도움말에서 있음을 읽었다 | `task-create --deps` · `worker-start --task --worktree new-child` · `--worktree` · `new-child` · `reference list` · `orca reference` · `--scope conversation` · `orca --help` · `orca orchestration --help` | — |
| CLI 폴더 | Claude Code plugin 이 `sangsoe` CLI 를 Claude Code 의 Bash 도구 PATH 에 올리는 폴더. CLI 코드는 공유 코어이고 이 폴더로 배포된다 | `bin/` | — |
| 설치 명령 | 사람이 순서대로 실행하는 명령. `<…>` 안은 자리표시자다 | `brew install <탭>/sangsoe` · `sangsoe install` 이 부르는 `claude plugin marketplace add <브루 트리의 마켓플레이스 경로> --scope user` · `claude plugin install sangsoe@<마켓플레이스 이름> --scope user` · `orca plugin dev load <브루 트리의 Orca plugin 폴더>` · 승인은 `sangsoe plugin approve` 가 `orca plugin enable <plugin-key> --approve <지문>` 으로 부른다(키는 `orca plugin list --json` 에서 읽는다). Orca 에는 plugin 설치 명령이 없다(카탈로그 설치는 설정 화면뿐) | — |
| 저장소 설정 이름 | 병합 대기열이 받는 워크플로 이벤트 | `merge_group` | — |
| 판정 없음 | 독립 리뷰 판정이 비어 있는 경우의 표시 | `no verdict` | — |
| 거부 사유 이름 | Orca 가 에이전트 세션 작업을 알 수 없을 때 내는 사유 | `agent_session_operation_unknown` | — |
| 게이트 값 | 흐름 틀 단계의 게이트 값 | `gate = "owner"` | — |
| 조사 자료 경로 | MCP 기능별 판정의 조사 기록 (비공개 조사 메모, 저장소에 싣지 않는다) | — | — |

SQL 문장 조각, `<…>`·`{…}`·`(…)` 가 든 형식 예시, `칸=값` 표기는 용어가 아니라 예시 문법이어서 검사에서 뺀다.

`port-plan.md` 의 백틱 낱말과 HTML 파일의 `<code>` 낱말은 아래 규칙으로 검사한다. ① sangsoe 의 이름(event 종류·뷰·명령·시나리오·역할 줄)은 이 파일에 글자 그대로 있어야 한다. ② 파일 이름·경로(`_research/` 조사 자료 경로 포함)·명령 옵션(`--apply`·`--task-id` 같은 것)·묶음 글(`gate-*`)·예시 안의 값·커밋 해시·`#절` 앵커(부록에 실제 id 가 있는지 따로 검사)·화면에 뜬 문구를 그대로 인용한 것은 용어가 아니어서 뺀다. ③ agent-skills 의 옛 파일·시험·스크립트·스킬 이름은 첫 문단의 예외 문장이 정한 자리에서만 쓰고 sangsoe 용어가 아니다. 모델 id 와 버전은 `core/models/table.ts` 에만 쓰고, 브리프에는 모델을 쓰지 않는다(결정 164, `test/model-table.test.ts` 가 검사한다).

## 14. 문서 절 이름

`design.html`(여섯 절): 무엇을 만드는가(안의 절: 설계 관점) · 네 칸 배치(안의 절: 배치표 · 첫째 칸: Orca CLI 내장 기능을 어디서 어떻게 부르나 · 한 저장소, 매니페스트 둘, 설치) · 컴포넌트(안의 절: 역할과 완료 판정 · 호출 경로 규칙 · monitor 다섯 · 오너가 보는 것 · 상태와 용어 · MCP 인터페이스) · 데이터(안의 절: 데이터 소유 · 의존 관리) · 흐름(안의 절: 오너 지시 하나 · 유닛 시작 · 결정 · 머지와 정리 · 모니터에서 깨움까지 · 경계마다 무엇이 오가나) · 구현 순서와 전환. 도식은 1 네 칸 배치 · 2 컴포넌트와 상호작용 · 3 토큰 · 3a GC 가 도는 자리 · 4 데이터 저장 · 5 오너 지시 · 6~9 흐름 넷 · 10 모듈 의존 순서다.
`design-appendix.html`: 차례 · 신호 흐름 · 역할 카드(안의 절: 역할과 완료 판정 표 · 당사자 원칙 표) · sqlite 스키마(안의 절: 데이터 소유 · 캐시 예외 · 키와 불변식) · 의존 관리 상세 · 지시 분류 표(안의 절: 지시가 흐르는 그림) · 전달 규칙(안의 절: 일이 기다리는 곳 · 결정 루프 · Orca 연동 우회) · 게이트와 원칙 · 모델 선택 · 남는 파일과 플러그인 경계 · 패널 화면 · MCP 인터페이스 · 기존 설계 참고(안의 절: Orca 기능 활용 표).

링크 글은 이 이름 그대로 쓴다. 약칭 "데이터 소유 상세"·"결정 루프 상세"는 쓰지 않는다.

도식 색(범례와 같다): 초록 = 데이터·스크립트(토큰 X) · 주황 = LLM 에이전트(토큰 O) · 회색 = 외부 시스템 · 파랑 = 오너 · 보라 = Orca 가 하는 일(외부 시스템 중 Orca 만 보라로 구분한다).

결정을 가리키는 번호는 둘이다. "결정 57" 은 `decisions.md` 의 번호이고, "d107" 처럼 d 가 붙은 것은 오너가 내린 결정의 id 다.

## 15. 이관과 구현 순서 (port-plan.md · design.html 6절)

| 용어 | 정의 | 영문 식별자 | 쓰지 않는 말 |
|---|---|---|---|
| 참조해서 새로 씀 | port-plan 분류. sangsoe 에도 같은 일을 하는 부품이 필요하다. 옛 코드는 옮기지 않고 새로 쓰되 규칙·함정·시험 사례는 명세로 가져온다 | — | — |
| 참조 안 함 | port-plan 분류. sangsoe 구조가 같은 일을 하거나 일회성·죽은 코드라서 코드도 시험도 가져가지 않는다 | — | — |
| 별도 plugin | port-plan 분류. sangsoe 본체의 일이 아니라서 가는 곳과 가져가는 것만 정한다 | — | — |
| 개념만 | port-plan 분류. 코드·시험 없이 규칙 한 문장만 설계·브리프·시험으로 들어간다 | — | — |
| 모듈 | design.html 6절이 짓는 단위. 기반 · 코어(스키마 · 알림 · GRAPH · 결정 루프 · 역할·세션 · 현황·MCP) · 랜드(land 판정 함수와 land 요청) · 정리 · 감지기 · 패널 · 설치. 모듈마다 서는 곳(선행)이 있고 서는 곳이 같으면 병렬로 짓는다. 흐름 틀의 단계(`step`)나 현황 1~3단계와 다른 말이다 | — | 빌드 단계, 페이즈, 트랙 |
| 전환 | agent-skills 를 한 번에 끄고 sangsoe 로 넘어가는 한 번의 작업. 각 PC 에서 오너가 한다. 역할을 하나씩 넘기지 않는다 | — | 단계별 이관, 병행 운영, 퇴역 |
| 전환 조건 | 전환하기 전에 모두 통과해야 하는 검증의 목록 하나(design.html 6절은 갈래별 개수와 핵심 검증, 개별 목록은 구현 시작 때 구현 리드가 만든다. 갈래는 모듈마다 하나이고 이관도 한 갈래다). 하나라도 실패하면 agent-skills 를 끄지 않는다 | — | 완료 조건(빌드를 뜻할 때), 진입 조건 |
| 이관 | 전환 조건의 한 갈래. 공통 요구 R-01–R-23이 모두 sangsoe CI에 있고(R 23/23), 다시 만드는 13가지(port-plan.md 1절)가 모두 다시 만들어졌는지(코어 또는 port-plan 이 정한 위치) 종단으로 센다. 모듈이 아니라 전환 조건의 갈래 이름이다 | — | 이식 |
| 전환 체크리스트 | 전환 날 오너가 하는 순서: 설치 순서(`brew install` → `sangsoe install`, 2절) · agent-skills 플러그인 비활성 · Orca plugin 승인·켜기 · 열린 항목·결정 가져오기(design.html 6절) | — | — |
| 롤백 | 전환을 되돌리는 것. agent-skills 플러그인을 다시 켜고 sangsoe 의 Orca plugin 을 끈다. sangsoe sqlite 는 그대로 남고 두 쪽을 합치지 않는다 | — | 되돌리기 |
| 부트스트랩 | 구축하는 동안 일을 agent-skills 로 계속하는 것. agent-skills 는 보관되어 코드가 바뀌지 않는다 | — | — |
| 시작 점검 | 시작할 때 SQLite 허용 버전·네트워크 위 DB·필요한 Orca 기능(`runtime.capabilities` 대조. 버전은 보조)을 검사하고, 어긋나면 시작을 거부하는 점검. 비로컬 행이 보이거나 `omittedHostIds` 가 비지 않거나 로컬이 아닌 연결된 호스트가 있으면 "건드리지 않는다"는 경고 한 줄을 더 내지만 그것으로 시작을 거부하지는 않는다(결정 88) | — | — |
