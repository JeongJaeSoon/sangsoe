# 설계 대 코드 대조

설계(`design.html`·`design-appendix.html`·`decisions.md`·`README.md`)의 요소마다 그것을 짓는 코드를 적는다. 모든 `file:line` 은 커밋 `22ead1d`(U73 머지) 기준이다. 뒤 커밋에서 줄이 밀렸으면 같은 파일의 같은 이름을 찾는다.

상태:

- `implemented` — 본문을 읽었고 설계 문장대로 한다.
- `partial` — 일부만 한다. 빠진 것을 비고에 적었다.
- `missing` — 짓는 코드가 없다. 찾아본 곳을 비고에 적었다.
- `cut` — 결정 N 이 설계에서 지웠거나, 다시 볼 조건을 달고 짓지 않기로 했다(비고의 LATER 는 그 결정의 조건).
- `changed` — 결정 N 이 꼴을 바꿨고 코드는 바뀐 꼴을 따른다.

`partial`·`missing` 행은 비고 앞에 `G<번호>` 를 단다. 7절의 갭 목록이 그 번호로 NOW·LATER·DROP 을 제안한다. 한 갭이 여러 행에 걸치면 같은 번호를 단다.

## 집계

| 절 | 행 | implemented | partial | missing | cut | changed |
|---|---|---|---|---|---|---|
| 0. 오너의 고정 규칙 | 5 | 4 | 1 | 0 | 0 | 0 |
| 1. 칸 배치 · Orca CLI · 설치 | 134 | 92 | 8 | 9 | 1 | 24 |
| 2. 컴포넌트 · 게이트 · hook · 패널 | 115 | 80 | 11 | 2 | 6 | 16 |
| 3. 데이터 · MCP · CLI · GRAPH | 81 | 53 | 6 | 1 | 3 | 18 |
| 4. 흐름 · 결정 루프 · 실패 방지 | 57 | 34 | 4 | 4 | 6 | 9 |
| 5. 결정이 자르거나 바꾼 것 | 45 | 0 | 0 | 0 | 13 | 32 |
| 합계 | 437 | 263 | 30 | 16 | 29 | 99 |

`partial`·`missing` 46행은 갭 27개(`G1`–`G36` 에서 U77 이 고친 `G2`, U76 이 고친 `G13` `G16`, 결정 212 가 닫은 `G10`·`G11`·`G23`·`G29`, 결정 215 가 닫은 `G22`·`G31` 을 뺀 것)로 묶인다. 제안은 NOW 0 · LATER 23 · DROP 4 다. 집계는 표의 상태 칸을 세어 냈다.

## 0. 오너의 고정 규칙

| 규칙 | 상태 | 코드 | 근거 |
|---|---|---|---|
| 데이터를 두 번 저장하지 않는다(사실마다 원본 하나, Orca·Claude plugin 의 데이터를 복사하지 않음) | implemented | `core/contract/define.ts:44`, `core/contract/define.ts:55`, `core/contract/contract.test.ts:97` | Orca 가 원본인 칸(`title`·`status`·`spec`·`deps`·`question`·`options`·`message_body`)은 페이로드 어디에 있든 `append` 가 거부한다. 캐시 예외는 부록 표의 셋이고 `pr_ref`·`gh_budget`·`gh_seen` 은 예약만 된 빈 표다(결정 186). `owner_text` 는 대화 기록이 지워질 때를 위한 보존 사본으로 설계가 이름을 붙인 예외다(`core/store/schema.ts:60`). |
| Orca plugin · Orca CLI · Claude plugin 의 기본 기능을 최대한 쓴다 | partial | `core/orca/commands.ts:22`, `orca-plugin/timer.ts:20`, `claude-plugin/mcp/server.ts:198` | G1·G3·G6 — 상주 감지는 Orca plugin worker 타이머, 에이전트 입구는 Claude Code plugin 의 stdio MCP 서버이고, 코어가 Orca 를 부르는 길은 명령 표 하나다. 다만 패널이 그 표 밖에서 Orca CLI 를 부르고(G1), 부록 "Orca 기능 활용 표" 가 쓴다고 적은 기능 몇이 코드에도 세션 글에도 없다(G3·G6). |
| 설계한 층 구성을 지킨다 | implemented | `test/layout.test.ts:76`, `test/layout.test.ts:84`, `test/layout.test.ts:126` | `docs/architecture.md` 의 층→디렉터리 표가 유일한 목록이고, 폴더 README 의 표지가 표와 다르거나 다른 칸이 `core/index.ts` 밖을 import 하면 시험이 실패한다. |
| 토큰을 쓰는 것과 쓰지 않는 것이 나뉜다 | implemented | `test/layout.test.ts:84`, `test/layout.test.ts:111`, `test/layout.test.ts:118` | 판단 층(`claude-plugin/skills/`·`agents/`)만 토큰을 쓰고, 토큰 O 폴더에 코드가 있거나 토큰 X 폴더에 프롬프트가 있으면 실패한다. |
| launch agent 금지(LaunchAgent·launchd 없음) | implemented | `test/layout.test.ts:135`, `core/gates/start.ts:134` | 트리에 property-list 작업 정의가 있으면 시험이 실패하고, 시작 가드가 `launchctl` 로 에이전트를 띄우는 명령을 막는다(`test/fixtures/hook-commands.jsonl` 의 deny 사례). 주기 일은 Orca plugin worker 타이머뿐이다. |

## 1. 칸 배치 · Orca CLI · 설치 (본문 1·2·6절, 부록 남는 파일·플러그인 경계·Orca 기능 활용 표·Orca 연동 우회·모델 선택)

| 요소 | 설계 자리 | 상태 | 코드 | 비고 |
|---|---|---|---|---|
| event append-only | design.html §1 | implemented | `core/store/schema.ts:52` | UPDATE·DELETE 트리거가 막는다 |
| 상주 프로세스·launchd 없음 | design.html §1 아니다 | implemented | `test/layout.test.ts:135`, `orca-plugin/main.ts:164` | 주기는 worker 타이머 |
| 일반 스킬 자리 | design.html §1 아니다 | changed (결정 95) | `claude-plugin/.claude-plugin/plugin.json:7` | 별도 plugin 이 아니라 ③ 안의 `skills/general` |
| harness 중심(hook·게이트) | design.html 설계 관점 | implemented | `claude-plugin/hooks/hooks.json:3`, `core/gates/start.ts:39` | 막는 hook 과 기록 hook 등록 |
| loop 의 끝 | design.html 설계 관점 | changed (결정 121) | `claude-plugin/agents/lead.md:23` | /goal 대신 Dispatch 와 worker_done 한 번 |
| ① 은 `core/orca` 만 부른다 | design.html §2 네 칸 배치 | partial | `core/orca/commands.ts:22`, `orca-plugin/panel/requests.ts:69` | G1 — 패널 버튼이 `orca terminal create`·`plugin open` 을 어댑터 밖에서 직접 부른다. install·approve 의 `plugin dev`·`enable`·`account list` 도 각자의 host 로 부른다(approve 가 enable 의 유일한 자리인 것은 설계대로) |
| ② Orca plugin | design.html §2 네 칸 배치 | implemented | `orca-plugin/orca-plugin.json:11`, `orca-plugin/main.ts:39` | 패널·상태 표시줄·monitor·REAPER 타이머가 worker 하나 |
| ③ Claude Code plugin | design.html §2 네 칸 배치 | implemented | `claude-plugin/hooks/hooks.json:3`, `claude-plugin/.mcp.json:3` | hook·skill·MCP·agent 넷 |
| ④ 코어, 연결점 둘 | design.html §2 네 칸 배치 | implemented | `test/layout.test.ts:126`, `orca-plugin/core-link.ts:51` | 다른 칸은 `core/index.ts` 로만, worker 는 core-link 한 곳 |
| 배치표 ① Task·Run | design.html §2 배치표 | implemented | `core/orca/commands.ts:29`, `core/start/item.ts:33` | task-create 에 deps·parent·run |
| 배치표 ① 게이트·메시지 | design.html §2 배치표 | implemented | `core/decision/open.ts:127`, `core/decision/release.ts:80` | 받은 편지함 사본 없음 |
| 배치표 ① 워커·Dispatch·Auto-close | design.html §2 배치표 | changed (결정 197) | `core/start/start.ts:436`, `claude-plugin/agents/lead.md:39` | 모든 시작이 keep-open, 시작한 쪽이 worker-release |
| 배치표 ① 카드 표시·참조·검색 | design.html §2 배치표 | implemented | `core/orca/commands.ts:84`, `claude-plugin/skills/deliver-ticket/SKILL.md:49`, `claude-plugin/skills/orchestrate/SKILL.md:32`, `claude-plugin/skills/intake/SKILL.md:33` | 결정 193 이 세션의 자기 글로 옮긴 `worktree set`·`reference list`·`search` 를 agent·sangsoe skill 본문이 부른다(U77 에서 고침, 줄은 U77 머지 기준). `test/session-verbs.test.ts` 가 지킨다 |
| 배치표 ① plugin 켜기 | design.html §2 배치표 | implemented | `core/approve/approve.ts:191` | approve 만 enable 을 부른다 |
| 배치표 ② 패널 | design.html §2 배치표 | implemented | `orca-plugin/orca-plugin.json:13`, `orca-plugin/main.ts:114` | 화면 내용은 2절 |
| 배치표 ② 상태 표시줄 | design.html §2 배치표 | implemented | `orca-plugin/orca-plugin.json:20`, `orca-plugin/main.ts:83` | 클릭은 `sangsoe.open` |
| 배치표 ② monitor 다섯 | design.html §2 배치표 | implemented | `orca-plugin/main.ts:39`, `orca-plugin/main.ts:164` | 판정 세부는 2절 |
| 배치표 ② REAPER | design.html §2 배치표 | implemented | `core/reaper/round.ts:449`, `core/orca/adapter.ts:319` | rm 은 run-hooks·delete-branch, force 없음 |
| 배치표 ② 멈춤 감지·이벤트 4종 | design.html §2 배치표 | implemented | `orca-plugin/orca-plugin.json:14`, `orca-plugin/main.ts:64` | |
| 배치표 ② plugin 저장소 | design.html §2 배치표 | missing | `orca-plugin/main.ts:24` | G3 — `orca-plugin/` 어디에도 plugin storage 호출이 없다 |
| 배치표 ② 승인 대상 | design.html §2 배치표 | implemented | `orca-plugin/orca-plugin.json:3`, `core/approve/approve.ts:134` | id 가 sangsoe 가 아니면 거부 |
| 배치표 ③ SessionStart | design.html §2 배치표 | implemented | `claude-plugin/hooks/hooks.json:16`, `core/session/session-start.ts:60` | 역할 줄과 run-use 안내 |
| 배치표 ③ 막는 hook | design.html §2 배치표 | changed (결정 208) | `claude-plugin/hooks/hooks.json:10`, `core/gates/start.ts:151` | 시작하지 못하면 통과, 검사가 실패하면 막음 |
| 배치표 ③ 기록 hook | design.html §2 배치표 | implemented | `claude-plugin/hooks/hooks.json:19` | UserPromptSubmit·Stop·Notification·PostToolUse·PostCompact·SessionEnd |
| 배치표 ③ skill | design.html §2 배치표 | changed (결정 120) | `claude-plugin/.claude-plugin/plugin.json:7` | sangsoe skill 열하나 + general |
| 배치표 ③ MCP 서버 | design.html §2 배치표 | implemented | `claude-plugin/.mcp.json:3` | tool 16(결정 223 의 `item_retire`)·resource 4 |
| 배치표 ③ agent 정의 | design.html §2 배치표 | implemented | `claude-plugin/agents/lead.md:4` | 오케스트레이터·리드·워커 |
| 배치표 ④ 코어 라이브러리 | design.html §2 배치표 | implemented | `core/index.ts:59` | 입구는 `core/index.ts` 하나 |
| 배치표 ④ sqlite 파일 | design.html §2 배치표 | implemented | `core/store/store.ts:86`, `core/store/backup.ts:113` | jsonl 사본 포함(결정 183) |
| 배치표 ④ verify_tier | design.html §2 배치표 | implemented | `core/verify/verify-tier.ts:68`, `core/verify/verify-tier.ts:172` | |
| 배치표 ④ CLI | design.html §2 배치표 | implemented | `cli/commands/doctor.ts:4`, `cli/commands/install.ts:4` | 파일 하나 = 명령 하나 |
| 배치표 ④ land | design.html §2 배치표 | implemented | `core/land/land.ts:156` | |
| 배치표 ④ plugin approve | design.html §2 배치표 | implemented | `core/approve/approve.ts:140`, `core/approve/approve.ts:156` | 키·지문은 `plugin dev reload` 로 읽는다(`docs/architecture.md` 승인 흐름) |
| 첫째 칸 Task | design.html 첫째 칸 | implemented | `core/orca/commands.ts:29`, `core/detect/pr/round.ts:159` | task-update 로 completed |
| 첫째 칸 Run | design.html 첫째 칸 | changed (결정 193) | `core/orca/commands.ts:41`, `claude-plugin/agents/lead.md:30` | 코어는 run-current·run-show·run-list(결정 207), 만들기와 run-use 는 리드의 글 |
| 첫째 칸 게이트 | design.html 첫째 칸 | implemented | `core/decision/open.ts:127`, `core/decision/open.ts:142` | |
| 첫째 칸 메시지 | design.html 첫째 칸 | changed (결정 203) | `core/orca/commands.ts:57`, `core/orca/commands.ts:62` | 코어는 send·inbox, ask·reply 는 세션 글 |
| 첫째 칸 워커·Dispatch 두 단계 | design.html 첫째 칸 | changed (결정 202) | `core/start/start.ts:381`, `core/start/start.ts:439` | create → 설정 파일 → worker-start keep-open |
| 첫째 칸 Auto-close | design.html 첫째 칸 | changed (결정 197) | `claude-plugin/agents/orchestrator.md:45`, `core/reaper/round.ts:148` | REAPER 는 setup 셸 handle 하나만 닫는다 |
| 첫째 칸 카드 표시·조회 | design.html 첫째 칸 | implemented | `core/orca/commands.ts:75`, `core/reaper/round.ts:449`, `claude-plugin/skills/deliver-ticket/SKILL.md:49` | ps·list·rm 은 어댑터에 있고, `worktree set` 은 워커가 PR 을 열 때 자기 카드에 쓴다(U77 에서 고침) |
| 첫째 칸 포트 | design.html 첫째 칸 | implemented | `core/reaper/live.ts:10`, `core/orca/adapter.ts:343` | 비로컬 호스트 답은 거부 |
| 첫째 칸 참조 | design.html 첫째 칸 | partial | `core/detect/pr/round.ts:102`, `core/detect/pr/round.ts:340` | G4 — add·find 는 있고(시작 때 `references` 를 붙이는 길은 `core/start/start.ts:475`) `reference remove` 행이 없다 |
| 첫째 칸 검색 | design.html 첫째 칸 | implemented | `claude-plugin/skills/general/recall/SKILL.md:22`, `claude-plugin/skills/intake/SKILL.md:33`, `claude-plugin/skills/orchestrate/SKILL.md:68` | 결정 193 으로 세션 글이 됐다. 일반 스킬 `recall` 과, 오너 원문 찾기(`intake`)·재시작 뒤 앞 세션 찾기(`orchestrate`)가 `--index-status` 가 켜졌을 때만 부른다(U77 에서 고침) |
| 첫째 칸 진단 | design.html 첫째 칸 | implemented | `core/detect/resource/round.ts:21` | resource-monitor |
| 첫째 칸 plugin 켜기 | design.html 첫째 칸 | implemented | `core/approve/approve.ts:67`, `core/approve/approve.ts:165` | 종료 코드 3 의 두 사유를 가른다 |
| 첫째 칸 자동화 안 씀 | design.html 첫째 칸 | implemented | `core/orca/commands.ts:22` | automations 행 없음 |
| 첫째 칸 그 밖 안 씀 | design.html 첫째 칸 | implemented | `core/gates/start.ts:152` | 감독 없는 dispatch 는 시작 가드가 거부 |
| 첫째 칸 외부 plugin 안 씀 | design.html 첫째 칸 | implemented | `orca-plugin/core-link.ts:51` | |
| 시작 점검 기능 대조 후 거부 | design.html 첫째 칸 머리 | implemented | `core/start/start.ts:215`, `core/checks/orca-capabilities.ts:8` | 호환 어댑터 없음 |
| 로컬 행만, 비로컬 경고 | design.html 첫째 칸 머리 | implemented | `core/orca/adapter.ts:316`, `core/checks/remote-hosts.ts:10` | |
| cross-PC | design.html 첫째 칸 머리 | cut (결정 203) | `core/checks/remote-hosts.ts:10` | "모르면 행동 0" 하한만 남는다 |
| 매니페스트 둘과 같은 버전 | design.html 한 저장소, 매니페스트 둘, 설치 | implemented | `orca-plugin/orca-plugin.json:6`, `claude-plugin/.claude-plugin/plugin.json:3` | doctor tree 행이 셋을 대조 |
| install 마켓플레이스 등록 | design.html 설치 | implemented | `core/install/install.ts:85`, `core/install/install.ts:91` | 없으면 add, 있으면 update, 다른 경로면 remove 뒤 add |
| install plugin 설치와 켜기 | design.html 설치 | changed (결정 166) | `core/install/install.ts:102`, `core/install/install.ts:112` | 꺼진 채면 enable |
| install Orca 프로필에도 등록 | README Claude profiles | changed (결정 167) | `core/install/install.ts:122`, `core/install/host.ts:108` | account list 를 읽는다 |
| install Orca dev load | design.html 설치 | implemented | `core/install/install.ts:43`, `core/install/install.ts:48` | 3 이면 지문과 approve 안내 |
| install 끝의 doctor | design.html 설치 | implemented | `core/install/install.ts:129` | doctor 종료 코드를 낸다 |
| install --permissions | README Install 3 | changed (결정 221·224) | `cli/commands/install.ts:20`, `core/install/permissions.ts:11`, `core/install/permissions.ts:183`, `core/install/permissions.ts:215` | 빠진 규칙만, diff·y/N·원자적 쓰기·백업, 두 번째는 변화 없음. 두 프로필(결정 167). 터미널이 없으면(Claude Code 의 `!` 줄) diff 뒤 같은 범위의 `--yes` 줄을 적고 쓰지 않는다(결정 224) |
| uninstall 이 권한 규칙을 되돌림 | README Install 3 | changed (결정 221) | `core/install/install.ts:181`, `core/install/permissions.ts:271` | sangsoe 가 기록한 규칙 중 같은 글자로 남은 것만 |
| formula · post_install 없음 | design.html 설치 | partial | `core/install/host.ts:46` | G9 — formula 는 별도 탭 저장소라 이 저장소에서 확인할 수 없다. 여기는 트리 경로 환경 변수를 받는 쪽만 있다 |
| approve 세 조건 | design.html 설치, README Install | implemented | `core/approve/approve.ts:140`, `core/approve/approve.ts:174` | 켜기 직전 해시 재측정 |
| approve 기록 event | design.html 설치 | implemented | `core/approve/approve.ts:199`, `core/approve/approve.ts:212` | store 를 먼저 연다(결정 123) |
| approve dry-run | README Install | implemented | `core/approve/approve.ts:192`, `cli/commands/plugin-approve.ts:16` | |
| version 출력 | README Install | implemented | `cli/commands/version.ts:8` | |
| 갱신과 재승인 | design.html 설치, README Update | implemented | `core/install/doctor.ts:182`, `core/checks/orca-plugin-version.ts:36` | 승인 대기 FAIL, 버전 warn 둘 다 approve 안내 |
| uninstall | design.html 설치, README Uninstall | changed (결정 208) | `core/install/install.ts:161`, `core/install/install.ts:178` | 마켓플레이스는 scope 없이 지우고 재시작 안내 줄 |
| 데이터·설정 남김 | README Uninstall | implemented | `core/install/install.ts:180` | |
| 버전 어긋남 SessionStart 줄 | design.html 설치 | implemented | `core/session/session-start.ts:71`, `core/detect/queue/drift.ts:19` | Orca 쪽은 job_drift |
| 낡은 MCP 서버 거부 | README Update | changed (결정 211·233) | `claude-plugin/mcp/tools/start_unit.ts:166`, `claude-plugin/mcp/stale.ts:9` | start_unit 만 `server_stale`. 고칠 말은 `claude --continue`(결정 233) |
| install 끝의 낡은 세션 목록 | README Install | changed (결정 247) | `core/install/stale-sessions.ts:70`, `core/install/install.ts:133`, `cli/commands/install.ts:26` | 결정 211 ⑤ 가 버린 대안을 install 의 목록으로. 버전 대신 "지금 설치본보다 오래된 설치본", 판정은 시작 시각 대 package.json change time |
| hook·MCP 가 CLI 찾기 | design.html 설치 | changed (결정 118) | `claude-plugin/.mcp.json:6` | plugin 옆 dist, 없으면 PATH |
| 플러그인 경계 bin 폴더 CLI | design-appendix 플러그인 경계 | changed (결정 90) | `claude-plugin/.mcp.json:6` | plugin 안 bin 없음, CLI 는 브루 래퍼 |
| vendor 코어 사본 | design-appendix 배치 규칙 | implemented | `orca-plugin/core-link.ts:51`, `package.json:26` | |
| doctor tree·node | README Install | implemented | `core/install/doctor.ts:59`, `core/install/doctor.ts:285` | offline 은 이것만 |
| doctor claude·claude profile | README Claude profiles | implemented | `core/install/doctor.ts:146`, `core/install/doctor.ts:150` | |
| doctor orca claude profile | README Claude profiles | implemented | `core/install/doctor.ts:96` | |
| doctor land allow | README Install | changed (결정 228) | `core/install/doctor.ts:130`, `core/checks/land-allowed.ts:26` | 따로 행이 없다. `permissions` warn 행 끝에 land 가 다른 규칙으로 허락되는지 적는다. 설정은 쓰지 않는다. 줄 번호는 U95 기준 |
| doctor permissions | README Install 2·5 | changed (결정 221·224·228) | `core/install/doctor.ts:129`, `core/install/permissions.ts:333` | N of M, 모자라면 warn. 고칠 말에 `!` 줄의 `--yes` 줄도 적는다(결정 224). 16 of 16 이면 land 도 덮는다(결정 228). 줄 번호는 U95 기준 |
| doctor claude marketplace | README Install | implemented | `core/install/doctor.ts:156` | 경로가 트리와 다르면 FAIL |
| doctor orca plugin | README Install | implemented | `core/install/doctor.ts:172`, `core/install/doctor.ts:182` | 승인 대기는 FAIL |
| doctor orca-plugin-version | README Install | implemented | `core/checks/orca-plugin-version.ts:26` | |
| doctor orca-plugin-content | README Install, Update | changed (결정 233) | `core/checks/orca-plugin-content.ts:47`, `core/checks/orca-plugin-content.ts:18` | 빌드 커밋·리뷰된 head 와 비교. GitHub 인증 실패로 트리를 못 받으면 한 줄 notice |
| doctor reaper-config | README REAPER | implemented | `core/checks/reaper-config.ts:21`, `core/reaper/config.ts:21` | |
| doctor watch-repos | README Watched repositories | implemented | `core/checks/watch-repos.ts:12` | |
| doctor tier-config | README Verify tier | implemented | `core/checks/tier-config.ts:14` | |
| doctor model-table | README Install | implemented | `core/checks/model-table.ts:120`, `core/checks/model-table.ts:137` | 60일 warn, 새 Claude Code·고정 notice |
| doctor 시작 점검 | architecture.md Orca·GitHub 어댑터와 점검 | implemented | `core/checks/index.ts:22`, `core/checks/orca-commands.ts:7` | reachable·capabilities·commands·hooks·remote-hosts·두 plugin 버전 |
| doctor sqlite-version·store-restore | design-appendix 남는 파일 | implemented | `core/checks/sqlite-version.ts:11`, `core/checks/store-restore.ts:24` | |
| Orca plugin 매니페스트 능력 | README Layout | partial | `orca-plugin/orca-plugin.json:11`, `orca-plugin/panel/requests.ts:69` | G5 — 능력은 읽기 둘만 선언하고, 패널은 `terminal create` 를 CLI 로 부른다 |
| 기능표 terminal create | design-appendix Orca 기능 활용 표 | changed (결정 169) | `orca-plugin/panel/requests.ts:69` | 패널 머리 행 버튼이 부른다 |
| 기능표 worker-show·read·list | design-appendix Orca 기능 활용 표 | partial | `core/detect/orca/round.ts:22`, `core/detect/orca/round.ts:65` | G6 — `worker-read` 어댑터 행 없음 |
| 기능표 inbox | design-appendix Orca 기능 활용 표 | implemented | `core/detect/orca/round.ts:60` | 읽기 전용 |
| 기능표 request-show·retry-request | design-appendix Orca 기능 활용 표 | implemented | `core/orca/adapter.ts:88`, `core/notify/notify.ts:102` | 잃은 응답만 같은 id 로 |
| 기능표 dispatch-show | design-appendix Orca 기능 활용 표 | implemented | `core/start/lineage.ts:27` | |
| 기능표 status | design-appendix Orca 기능 활용 표 | partial | `core/checks/orca-capabilities.ts:22`, `core/contract/orca.ts:126` | G6 — 세션 id 칸은 타입만 있고 쓰는 코드가 없다 |
| 기능표 agent-context | design-appendix Orca 기능 활용 표 | implemented | `core/checks/orca-commands.ts:9` | |
| 기능표 worktree ps | design-appendix Orca 기능 활용 표 | implemented | `core/detect/orca/round.ts:58` | |
| 기능표 host list | design-appendix Orca 기능 활용 표 | implemented | `core/checks/remote-hosts.ts:13` | |
| 기능표 agent hooks status | design-appendix Orca 기능 활용 표 | implemented | `core/checks/orca-hooks.ts:6` | |
| 기능표 terminal list·show·read | design-appendix Orca 기능 활용 표 | partial | `core/orca/commands.ts:79`, `core/detect/queue/round.ts:97` | G6 — list 는 있다(REAPER·시작이 부른다). show·read 행이 없어 queue-monitor 가 대기 발췌를 못 싣는다고 스스로 적는다 |
| 기능표 skills get | design-appendix Orca 기능 활용 표 | missing | `core/orca/commands.ts:22` | G6 — agent·sangsoe skill 본문에도 없다 |
| 기능표 worktree list·show·current | design-appendix Orca 기능 활용 표 | partial | `core/orca/commands.ts:75` | G6 — show·current 행 없음 |
| 기능표 worktree create·terminal·repo show | design-appendix Orca 기능 활용 표 | implemented | `core/start/start.ts:381`, `core/reaper/round.ts:148` | |
| 기능표 repo list·project list | design-appendix Orca 기능 활용 표 | missing | `core/orca/commands.ts:81` | G6 — repo show 만 있다 |
| 기능표 plugin | design-appendix Orca 기능 활용 표 | implemented | `orca-plugin/main.ts:83`, `orca-plugin/main.ts:114` | 저장소 칸은 G3 |
| 기능표 terminal-daemon status | design-appendix Orca 기능 활용 표 | missing | `core/detect/resource/round.ts:21` | G6 — resource-monitor 가 읽지 않고 어댑터 행도 없다 |
| 연동 우회 세션 조작 "모름" 응답 | design-appendix Orca 연동 우회 | missing | `core/notify/notify.ts:99` | G7 — 그 오류 코드를 다루는 곳이 없다 |
| 연동 우회 worker-start 실패 | design-appendix Orca 연동 우회 | changed (결정 80) | `core/start/start.ts:317`, `core/recover/recover.ts:21` | 세 번 차단은 코어, `next`·`--retry-of` 되살리기는 세션 몫이고 sangsoe 는 표 하나를 읽는다(결정 80 N4) |
| 연동 우회 스크립트는 소비하지 않음 | design-appendix Orca 연동 우회 | implemented | `core/orca/commands.ts:62` | check 행 없음 |
| 연동 우회 기존 터미널에 Dispatch | design-appendix Orca 연동 우회 | missing | `core/orca/commands.ts:66` | G7 — worker-start 플래그에 terminal 이 없다 |
| 연동 우회 응답 모양 | design-appendix Orca 연동 우회 | implemented | `core/orca/adapter.ts:56`, `core/orca/adapter.ts:337` | 모양 밖이면 `unexpected_shape` |
| 회귀 worker_start_dispatched | design-appendix Orca 연동 우회 | implemented | `core/start/start.ts:269` | |
| 회귀 unit_lineage_complete | design-appendix Orca 연동 우회 | implemented | `core/start/lineage.ts:27` | |
| 회귀 raw_start_refused | design-appendix Orca 연동 우회 | implemented | `core/gates/start.ts:39`, `core/gates/start.ts:151` | |
| 회귀 one_session_two_terminals | design-appendix Orca 연동 우회 | implemented | `core/detect/orca/judge.ts:63`, `core/detect/orca/judge.ts:257` | |
| 모델 표 한 곳 | design-appendix 모델 선택 | changed (결정 187) | `core/models/table.ts:54`, `core/models/table.ts:178` | 정책 행에 hard·docs 가 더해졌다 |
| start_unit 의 model·effort | design-appendix 모델 선택 | changed (결정 209) | `core/start/start.ts:434`, `core/models/index.ts:156` | effort 를 받지 않는 tier 는 넘기지 않는다 |
| model_changed 기록 | design-appendix 모델 선택 | implemented | `core/start/start.ts:471` | |
| agent frontmatter 대조 | design-appendix 모델 선택 | implemented | `test/model-table.test.ts:113` | |
| alias 고정 읽기 | design-appendix 모델 선택 | implemented | `core/checks/model-table.ts:131` | 읽기만 |
| 흐름 틀 파일 | design-appendix 남는 파일 | implemented | `core/graph/flow.ts:131` | 사용자 틀이 기본 틀을 덮는다 |
| 트리 경로 | design-appendix 남는 파일 | implemented | `core/install/host.ts:46` | |
| 설정 파일 | design-appendix 남는 파일 | implemented | `core/checks/reaper-config.ts:12` | 읽기만 |
| 브리프·리드 기록 경로 | design-appendix 남는 파일 | missing | `core/store/store.ts:86` | G8 — 그 경로를 쓰는 코드가 core·cli 에 없다 |
| 압박 기록(8일·4MB) | design-appendix 남는 파일 | missing | `core/gates/record.ts:8` | G8 — 거부 기록만 있고 압박 이력 파일이 없다 |
| 실행 출력·hook 로그 | design-appendix 남는 파일 | missing | `core/gates/record.ts:8` | G8 — 로그 폴더를 쓰는 코드가 없다 |
| Orca plugin 이 못 싣는 넷 | design-appendix 배치 규칙 | implemented | `orca-plugin/orca-plugin.json:12` | |
| 코어 TS/Node 하나 | design-appendix 배치 규칙 | implemented | `package.json:20` | Node 하한(결정 102) |
| 승인 해시와 job_drift | design-appendix 배치 규칙 | changed (결정 185) | `core/checks/orca-plugin-version.ts:17`, `core/detect/queue/drift.ts:8` | drift 는 버전·켜짐·재승인, 해시는 doctor |
| 토큰 경계 표 대 README 표지 | architecture.md 층 표 | implemented | `test/layout.test.ts:92`, `test/layout.test.ts:101` | |
| agents 표지 | architecture.md 층 표 | implemented | `test/layout.test.ts:45` | |
| 섞임은 칸 뿌리만 | README Layout | implemented | `test/layout.test.ts:105` | |
| 전환 때 읽기 전용 이관 | design.html §6 | implemented | `cli/commands/migrate.ts:25`, `core/migrate/source.ts:44` | |
| 전환 확인 todo 숫자 | design.html §6 | implemented | `cli/commands/todo.ts:7` | |
| 첫 빌드 시험 T1–T6·전환 조건 | design.html §6 | implemented | `docs/test-outcomes.md`, `docs/switch-conditions.md` | 코드가 아니라 기록 문서 |

## 2. 컴포넌트 · 역할 · monitor · 오너 화면 · 게이트 · hook · skill (본문 3절, 부록 역할 카드·당사자 원칙·게이트·패널 화면)

| 요소 | 설계 자리 | 상태 | 코드 | 비고 |
|---|---|---|---|---|
| 오케스트레이터 역할 | design.html §3 역할과 완료 판정 | implemented | `claude-plugin/agents/orchestrator.md:21`, `core/gates/delegate.ts:69` | 끝이 없고, 직접 일은 위임 게이트가 막는다 |
| 리드 역할 | design.html §3 역할과 완료 판정 | changed (결정 94) | `claude-plugin/agents/lead.md:37`, `claude-plugin/agents/lead.md:22` | ready resource 를 읽고 `start_unit` 으로 시작 |
| 워커 역할 | design.html §3 역할과 완료 판정 | implemented | `claude-plugin/agents/worker.md:23`, `core/gates/self-land.ts:60` | worker_done 한 번(결정 121·175) |
| 스크립트 역할 GRAPH·REAPER | design.html §3 역할과 완료 판정 | implemented | `core/graph/edit.ts:104`, `core/reaper/round.ts:171` | 기본 설치의 REAPER 는 표시만(결정 174) |
| land 판정 함수 | design.html §3 역할과 완료 판정 | implemented | `core/land/land.ts:189`, `core/land/land.ts:211` | 결정 158·204 |
| 당사자 원칙 넷 | design.html §3 역할과 완료 판정 | implemented | `claude-plugin/agents/worker.md:53`, `claude-plugin/agents/lead.md:39` | |
| 감지기 | design.html §3 역할과 완료 판정 | implemented | `core/detect/pr/round.ts:149`, `core/detect/pr/round.ts:200` | 닫기는 머지 확인 뒤 하나뿐 |
| 오너 | design.html §3 역할과 완료 판정 | implemented | `core/session/record.ts:81`, `core/owner/done.ts:36` | 채팅과 패널 버튼 모두 owner_action |
| 감지 층이 바꾸는 것 | design.html §3 항목의 상태를 누가 바꾸나 | implemented | `core/session/record.ts:180`, `core/owner/probe.ts:157` | 사실·표지·close_suggested 만 |
| 실행 층이 바꾸는 것 | design.html §3 항목의 상태를 누가 바꾸나 | implemented | `core/session/record.ts:103`, `core/owner/done.ts:22` | 결정 173·181 |
| 판단 층이 바꾸는 것 | design.html §3 항목의 상태를 누가 바꾸나 | implemented | `claude-plugin/mcp/tools/decision_answer.ts:14`, `claude-plugin/agents/orchestrator.md:49` | 결정 179 |
| 에이전트는 MCP 만 | design.html §3 호출 경로 규칙 | implemented | `claude-plugin/mcp/server.ts:38`, `test/judgment-layer.test.ts:61` | |
| plugin worker 의 코어 import | design.html §3 호출 경로 규칙 | implemented | `orca-plugin/core-link.ts:64` | 결정 132 |
| SessionStart hook → CLI | design.html §3 호출 경로 규칙 | implemented | `claude-plugin/hooks/hooks.json:17`, `claude-plugin/hooks/record.sh:8` | |
| 막는 hook → CLI | design.html §3 호출 경로 규칙 | implemented | `claude-plugin/hooks/hooks.json:11`, `claude-plugin/hooks/pre-tool-use.sh:21` | 결정 208 |
| 기록 hook → CLI | design.html §3 호출 경로 규칙 | implemented | `claude-plugin/hooks/record.sh:12` | 언제나 0 으로 끝난다 |
| 오너 전용 skill | design.html §3 호출 경로 규칙 | implemented | `claude-plugin/skills/brief/SKILL.md:12`, `claude-plugin/skills/todo/SKILL.md:12` | |
| 사람·시험·CI 의 CLI | design.html §3 호출 경로 규칙 | implemented | `cli/main.ts:31`, `cli/main.test.ts:20` | |
| chat-monitor | design.html §3 monitor 다섯 | partial | `core/detect/chat/round.ts:4`, `core/detect/run.ts:90` | G36 — 라운드는 있으나 provider 가 `nullChatProvider` 로 박혀 있어 다른 것을 꽂을 자리가 없고, `mention_new` 를 오케스트레이터에게 Orca 메시지로 보내는 곳도 없다. 결정 45 는 대체 수집 경로만 금한다 |
| queue-monitor | design.html §3 monitor 다섯 | implemented | `core/detect/queue/round.ts:36`, `core/detect/queue/judge.ts:41` | 대기 발췌는 G6 |
| resource-monitor | design.html §3 monitor 다섯 | partial | `core/detect/resource/round.ts:20`, `core/detect/resource/judge.ts:89` | G12 — 누수 검사는 Docker 컨테이너·볼륨만, 프로세스·worktree·compose·네트워크·이미지는 보지 않는다 |
| orca-monitor | design.html §3 monitor 다섯 | implemented | `core/detect/orca/judge.ts:130`, `core/detect/orca/mail.ts:125` | 결정 196 |
| pr-monitor | design.html §3 monitor 다섯 | implemented | `core/detect/pr/round.ts:473`, `core/detect/pr/reviews.ts:37` | 캐시는 프로세스 메모리(결정 186) |
| 타이머 멈춤 감지 | design.html §3 monitor 다섯 | implemented | `core/detect/queue/stall.ts:33`, `orca-plugin/main.ts:164` | |
| N1 재시작 감지와 인계 | design.html §3 복구와 운영 규칙 여덟 | changed (결정 212) | `core/session/restart-due.ts:18`, `core/brief/build.ts:532`, `core/brief/panel.ts:57`, `core/session/session-start.ts:63` | brief 와 상태 표시줄 B 가 역할마다 마지막 오케스트레이터·리드 세션의 `restart_due` 를 보인다. "인계 저장됨" 은 보이지 않는다: 인계는 Orca 메시지이고 brief 는 우편함을 읽지 않는다(결정 212 ①) |
| N2 main 감시와 동결 | design.html §3 복구와 운영 규칙 여덟 | implemented | `core/detect/pr/round.ts:418`, `core/land/land.ts:164` | |
| N3 깨움 확인 | design.html §3 복구와 운영 규칙 여덟 | implemented | `core/detect/orca/judge.ts:204`, `core/detect/orca/round.ts:103` | 읽히지 않은 줄이 간 곳의 다음 칸에 notify escalation 으로 한 번, `status` 로 올린다. 오케스트레이터 칸은 줄로 남는다(결정 212 ②) |
| N4 머신 재시작 복구 | design.html §3 복구와 운영 규칙 여덟 | implemented | `core/recover/recover.ts:21`, `core/detect/orca/judge.ts:99` | |
| N5 릴리스 묶음 | design.html §3 복구와 운영 규칙 여덟 | implemented | `core/graph/flows/ship-batch.toml:17`, `core/graph/flows/ship-batch.toml:30` | |
| N6 리뷰 의뢰 기록 | design.html §3 복구와 운영 규칙 여덟 | implemented | `core/session/review-ask.ts:41` | 리마인드 뷰는 다음 행 |
| N6 리마인드(`ask_due` 몸체·일반 스킬) | design.html §3 복구와 운영 규칙 여덟 | cut (결정 161) | `core/contract/views.ts:182` | LATER — 리뷰 리마인드를 sangsoe 가 정해야 하는 첫 경우 |
| N7 감시 범위 필터 | design.html §3 복구와 운영 규칙 여덟 | implemented | `core/detect/pr/config.ts:30`, `core/detect/pr/round.ts:494` | |
| N8 보고 주소 규칙 | design.html §3 복구와 운영 규칙 여덟 | implemented | `core/gates/report-address.ts:20` | |
| 현황 1단계 | design.html §3 오너가 보는 것 | implemented | `core/brief/build.ts:133`, `core/brief/render.ts:35` | |
| 묶음 상세 2단계 | design.html §3 오너가 보는 것 | changed (결정 218·219·220) | `core/brief/build.ts:310`, `core/brief/build.ts:369`, `orca-plugin/panel/view.ts:124`, `orca-plugin/panel/view.ts:100` | G13 고침(U76, 결정 213): 패널은 시안 순서대로 요약 수치 → 의존 그래프 → 왜 준비되지 않았나 → 간선 → 상태별 절 → 최근 전환 → 접힌 완료. 글은 지금 꼴을 지킨다(결정 213 ④). 결정 218: 머리는 "열린 N건 · 막힘 M"(🔄 + 🚧 + 남은 것, ✅ 는 따로), 🚧 항목마다 왜 행, 묶음 안 항목의 PR 마디는 그 항목. 결정 219: 크리티컬 패스·왜 행이 이름 대는 항목은 모두 마디, 경로는 화면의 자리(현황 › 묶음 › 항목)이고 뒤로는 그 줄 끝, 스택의 화면은 메모리에서 먼저 그린다, 좁은 패널의 요약 칸은 4+3, 게이트 없는 결정은 버튼 없는 깨진 행(`core/brief/build.ts:277`). 결정 220: 아래 절의 표는 넓은 패널에서 열 역할로 너비를 나누고 좁은 패널에서 항목마다 카드 하나(`orca-plugin/panel/view.ts:551`) |
| 항목 상세 3단계 | design.html §3 오너가 보는 것 | partial | `core/brief/build.ts:541`, `orca-plugin/panel/view.ts:578` | G14 — 대화 기록 위치(세션 id·메시지 uuid)가 없다 |
| 줌 보조 화면 | design.html §3 오너가 보는 것 | missing | `orca-plugin/panel/view.ts:600` | G15 — 결정 92 ③ 의 별도 보기가 없다 |
| 상태 표시줄 항목 | design.html §3 오너가 보는 것 | changed (결정 219) | `core/brief/panel.ts:57`, `orca-plugin/main.ts:83` | 결정 170. 결정 219: 항목 사이 세로 막대, 🚧 나 오너의 할 일이 있으면 `danger`. 붉은 배경은 host API 가 tone 만 받아 정할 수 없다 |
| owner_todo 한 곳 셈 | design.html §3 오너가 보는 것 | implemented | `core/brief/build.ts:138`, `core/brief/panel.ts:66` | |
| 우선순위 P0–P3 | design.html §3 오너가 보는 것 | cut (결정 160) | `core/brief/item_status.ts:188` | 읽기·정렬은 있고 `priority_set` 을 쓰는 입구는 짓지 않았다. LATER — 오너가 우선순위를 바꾸려 한 첫 경우 |
| 표 결정 필요 | design.html §3 현황 보고는 표 네 절이다 | implemented | `core/brief/build.ts:50`, `core/brief/build.ts:213` | |
| 표 지금 오너가 할 일 | design.html §3 현황 보고는 표 네 절이다 | implemented | `core/brief/build.ts:51`, `core/brief/build.ts:277` | |
| 표 진행 중 | design.html §3 현황 보고는 표 네 절이다 | changed (결정 222) | `core/brief/build.ts:53`, `core/brief/build.ts:241`, `orca-plugin/panel/view.ts:721` | 결정 222 ④: 절과 탭의 이름은 "열린 항목" 이다. 묶음 안의 열린 항목을 상태와 상관없이 담아 요약 줄의 "🔄 진행 중" 과 다른 수를 셌다 |
| 표 보류 | design.html §3 현황 보고는 표 네 절이다 | implemented | `core/brief/build.ts:53`, `core/brief/build.ts:239` | |
| 완료 최근 7일 접힌 목록 | design.html §3 현황 보고는 표 네 절이다 | implemented | `orca-plugin/panel/view.ts:221`, `core/brief/render.ts:41`, `cli/commands/brief.ts:37` | G16 고침(U76, 결정 213, 줄 번호는 U76 기준): 글은 건수 줄로 접고 `sangsoe brief [<묶음>] --done` 이 같은 행을 표로 편다 |
| 묶음 0개 안내 줄 | design.html §3 현황 보고는 표 네 절이다 | implemented | `orca-plugin/panel/view.ts:209`, `core/brief/render.ts:53` | G16 고침(U76, 결정 213, 줄 번호는 U76 기준): 글도 열린 항목 절 아래에 패널 문장의 앞 두 문장을 둔다 |
| 상태 일곱과 읽기 상태 | design.html §3 상태와 용어 | implemented | `core/contract/transitions.ts:10`, `core/brief/item_status.ts:75` | 예정·준비됨·진행 중·막힘·보류·완료·취소, 검증 대기(결정 181), PR 모름·닫힘(결정 178). 머지 없이 닫힌 PR 의 완료 항목을 거두면 취소로 읽는다(결정 223) |
| 플래그 넷 | design.html §3 상태와 용어 | implemented | `core/brief/build.ts:555`, `core/brief/item_status.ts:202` | 결정 필요·오류·확인 필요·근거 부족 |
| 역할 표 GRAPH | design-appendix 역할과 완료 판정 표 | implemented | `core/graph/edit.ts:113`, `core/detect/queue/round.ts:66` | |
| 역할 표 판정 함수 | design-appendix 역할과 완료 판정 표 | implemented | `core/notify/notify.ts:55`, `core/capacity/capacity.ts:107` | ready·decision 함수도 같은 층 |
| 역할 표 REAPER | design-appendix 역할과 완료 판정 표 | implemented | `core/reaper/round.ts:171`, `orca-plugin/reaper/round.ts:10` | |
| 역할 표 land | design-appendix 역할과 완료 판정 표 | implemented | `core/land/land.ts:207`, `core/land/land.ts:233` | |
| 당사자 land·ready·capacity·GRAPH | design-appendix 당사자 원칙 표 | implemented | `core/land/land.ts:107`, `core/graph/ready.ts:213` | |
| 당사자 결정 함수와 notify | design-appendix 당사자 원칙 표 | implemented | `core/decision/moot.ts:24`, `core/notify/notify.ts:80` | |
| 당사자 REAPER | design-appendix 당사자 원칙 표 | implemented | `core/reaper/round.ts:401`, `core/reaper/checks.ts:104` | 터미널은 시작한 쪽(결정 197) |
| 재질문 게이트 | design-appendix 당사자 원칙 표 | implemented | `core/decision/open.ts:57`, `core/decision/open.ts:72` | |
| 독립 리뷰 | design-appendix 당사자 원칙 표 | implemented | `core/approve/review-verdict.ts:74`, `core/land/land.ts:190` | |
| 당사자 게이트 수 | design-appendix 당사자 원칙 표 | changed (결정 94) | `core/gates/index.ts:14` | 막는 게이트는 넷이 아니라 여섯(시작 가드·보고 주소) |
| Orca 메시지·plugin 타이머·패널 | design-appendix 당사자 원칙 표 | implemented | `orca-plugin/timer.ts:53`, `orca-plugin/main.ts:114` | |
| 압박 게이트 | design-appendix 게이트와 원칙 | partial | `core/gates/pressure.ts:20` | G17 — 기다릴 순서를 알려 주지 않고, 무거운 작업은 start_unit·compose up·worktree create 만 맞춘다 |
| 루프 게이트 | design-appendix 게이트와 원칙 | implemented | `core/gates/sleep-loop.ts:7` | |
| 위임 게이트 | design-appendix 게이트와 원칙 | implemented | `core/gates/delegate.ts:55`, `core/gates/delegate.ts:69` | |
| 자기 머지 게이트 | design-appendix 게이트와 원칙 | implemented | `core/gates/self-land.ts:60` | |
| 시작 가드 | design-appendix 게이트와 원칙 | implemented | `core/gates/start.ts:166` | |
| 보고 주소 검사 | design-appendix 게이트와 원칙 | implemented | `core/gates/report-address.ts:20` | |
| 원칙 내장 먼저 | design-appendix 게이트와 원칙 | implemented | `test/layout.test.ts:135` | |
| 원칙 완료 조건·승인 줄·거부 문단 | design-appendix 게이트와 원칙 | implemented | `claude-plugin/skills/write-brief/SKILL.md:21`, `claude-plugin/skills/write-brief/SKILL.md:40` | |
| 원칙 오너를 막지 않는다 | design-appendix 게이트와 원칙 | implemented | `claude-plugin/agents/orchestrator.md:49` | |
| 규칙은 기계가 강제 | design-appendix 게이트와 원칙 | partial | `test/judgment-layer.test.ts:41` | G18 — 스킬·참조 문서 크기 상한 시험이 없다 |
| hook 정확도와 비용 | design-appendix 게이트와 원칙 | partial | `core/gates/replay.ts:42` | G18 — 오탐·미탐만 재고 호출당 비용·목표치는 없다 |
| 리뷰와 머지 판정 | design-appendix 게이트와 원칙 | implemented | `core/land/land.ts:199` | |
| 동작확인 등급 | design-appendix 게이트와 원칙 | implemented | `core/verify/verify-tier.ts:89` | |
| CI 시간 상한·건너뛴 시험 수 | design-appendix 게이트와 원칙 | cut (결정 161) | `.github/workflows/ci.yml:48` | LATER(R-11) — CI 가 10분을 넘거나 건너뛴 시험이 생기면 |
| 무거운 작업 슬롯을 CPU 에 맞춤 | design-appendix 게이트와 원칙 | cut (결정 161) | `core/capacity/capacity.ts:40` | LATER(R-13) — 슬롯 부족으로 기다린 시작이 관측되면 |
| CLI 규약 | design-appendix 게이트와 원칙 | implemented | `cli/main.test.ts:14`, `cli/main.test.ts:20` | |
| hook 구조 | design-appendix 게이트와 원칙 | implemented | `core/gates/merge.ts:8`, `core/gates/index.ts:17` | deny > ask > allow |
| 저장소 위생과 설치 | design-appendix 게이트와 원칙 | implemented | `test/hooks-registered.test.ts:23` | |
| 게이트가 담은 가정 여섯 | design-appendix 게이트가 담은 가정 | implemented | `core/gates/pressure.ts:20`, `core/approve/review-verdict.ts:74` | 가정을 다시 재는 절차는 코드 밖 |
| 패널 index 현황 | design-appendix 패널 화면 | partial | `orca-plugin/panel/view.ts:180` | G21 — "내 지시는 어디까지 갔나" 접힘 구역이 없다. 결정 225: 좁은 카드의 빈 칸은 자리를 차지하지 않고(`orca-plugin/panel/style.ts:263`), 머리는 상태 배지, 다음은 남는 폭에 두 줄, 누가는 배지와 오른쪽 끝의 경과(`orca-plugin/panel/view.ts:221`), 묶음의 수는 제목 옆 배지 "막힘 M / N"(`orca-plugin/panel/view.ts:209`) |
| 패널 group 묶음 상세 | design-appendix 패널 화면 | changed (결정 218·220) | `orca-plugin/panel/view.ts:495`, `orca-plugin/panel/view.ts:612` | G13 고침(U76, 결정 213): SVG DAG 와 시안의 절 순서. 결정 218: 브레드크럼은 지금 화면을 한 번(`orca-plugin/panel/view.ts:710`, 같은 행 두 번 누르기는 쌓지 않음 `orca-plugin/panel/view.ts:89`), 간선 범례는 접혀서 시작(`orca-plugin/panel/view.ts:599`). 결정 220: 그래프 표는 열 역할(짧은 것·항목·긴 글)이 너비를 정하고(`orca-plugin/panel/view.ts:535`, `orca-plugin/panel/style.ts:195`), 좁은 패널에서는 행 하나가 id 와 상태를 제목 줄로 단 카드 하나다(`orca-plugin/panel/view.ts:551`, `orca-plugin/panel/style.ts:230`). 제목은 화면 > 절 > 절 안의 표 세 단계(`orca-plugin/panel/style.ts:95`). 결정 222: 좁은 패널의 카드 규칙은 모든 표의 것이고(`orca-plugin/panel/style.ts:207`), 지표 칸은 테두리 카드다(`orca-plugin/panel/style.ts:123`). 결정 225: 넓은 표는 `colgroup` 으로 열 너비를 정하고 칸마다 한 줄 말줄임(`orca-plugin/panel/view.ts:271`, `orca-plugin/panel/style.ts:217`), 몸이 빈 그래프 카드는 머리 아래 선이 없고(`orca-plugin/panel/view.ts:647`), 상태 말은 배지(`orca-plugin/panel/view.ts:189`) |
| 패널 item 항목 상세 | design-appendix 패널 화면 | changed (결정 136) | `orca-plugin/panel/view.ts:578` | 버튼은 추천대로·다른 답·완료 셋. 대화 기록 위치는 G14 |
| 패널 zoom | design-appendix 패널 화면 | missing | `orca-plugin/panel/view.ts:600` | G15 |
| 패널 머리 행과 탭 | design-appendix 패널 화면 | implemented | `orca-plugin/panel/view.ts:607`, `orca-plugin/panel/view.ts:626` | 결정 169. 결정 225: 머리와 경로 줄은 함께 고정되고(`orca-plugin/panel/view.ts:810`, `orca-plugin/panel/style.ts:72`), 패널은 Orca 페이지의 `#root` 를 쓴다(`orca-plugin/panel/index.ts:46`) |
| 패널 버튼 | design-appendix 패널 화면 | changed (결정 136) | `orca-plugin/panel/requests.ts:13`, `orca-plugin/panel/view.ts:194` | "확인함" 대신 "완료" |
| 패널 다시 읽기 | design-appendix 패널 화면 | changed (결정 205) | `orca-plugin/main.ts:94`, `orca-plugin/panel/refresh.ts:9` | 새 seq 뒤 몇 초 안에 |
| 세 단계 정렬 | design-appendix 현황 세 단계 | implemented | `core/brief/build.ts:179`, `core/brief/build.ts:307` | |
| 세 단계 3 항목 상세 | design-appendix 현황 세 단계 | partial | `core/brief/build.ts:544` | G14 |
| 줄임 표기 | design-appendix 현황 세 단계 | implemented | `core/brief/build.ts:103` | |
| 1단계 표 열 폭·링크·기간 | design-appendix 현황 1단계의 표 | implemented | `core/brief/width.ts:33`, `core/brief/width.ts:55` | |
| 렌더러 자리 | design-appendix 현황 1단계의 표 | implemented | `core/brief/render.ts:78`, `claude-plugin/mcp/resources/brief.ts:6` | |
| 골든 시험 | design-appendix 현황 1단계의 표 | implemented | `core/brief/brief.golden.test.ts:31` | |
| 건수 줄 넷 | design-appendix 건수 줄 | implemented | `core/brief/build.ts:153`, `core/brief/build.ts:171` | 완료·진행 중·남은 것·막힌 것 |
| 숫자는 한 곳·낱말은 한 벌 | design-appendix 세 화면이 지키는 것 | implemented | `core/brief/panel.ts:57`, `core/contract/views.ts:75` | |
| 한 언어 설정 | design-appendix 세 화면이 지키는 것 | partial | `orca-plugin/panel/view.ts:110` | G19 — 문자열이 한국어로 고정이고 언어 설정이 없다 |
| 보지 않는 것·터미널 현황·좁은 폭 | design-appendix 세 화면이 지키는 것 | implemented | `orca-plugin/panel/view.ts:600`, `orca-plugin/panel/style.ts:191` | |
| 폴백 의존 그래프 | design-appendix 폴백 규칙 | partial | `orca-plugin/panel/view.ts:556`, `core/brief/render.ts:52` | G20 — 패널 안 들여쓰기 목록 대체가 없다 |
| 폴백 넓은 화면·카드 위 표시·Orca 꺼짐·CI 화면 검증 | design-appendix 폴백 규칙 | implemented | `orca-plugin/panel/style.ts:191`, `cli/commands/brief.ts:26` | |
| 폴백 Markdown 저장 | design-appendix 폴백 규칙 | partial | `cli/commands/brief.ts:26` | G20 — CLI 는 있고 패널의 저장 버튼은 없다 |
| hook PreToolUse | design-appendix 역할 카드 | implemented | `claude-plugin/hooks/hooks.json:3`, `core/gates/record.ts:30` | `gate_denied` |
| hook SessionStart | design-appendix 역할 카드 | implemented | `claude-plugin/hooks/hooks.json:16`, `core/session/session-start.ts:47` | |
| SessionStart 인계·늦은 답 주입 | design-appendix 역할 카드 | implemented | `core/session/session-start.ts:99`, `core/session/session-start.ts:118` | |
| SessionStart 역할 줄 없음 | design-appendix 역할 카드 | changed (결정 192) | `core/session/session-start.ts:32` | sangsoe 가 만든 Task 에만 |
| hook UserPromptSubmit | design-appendix 역할 카드 | changed (결정 173) | `claude-plugin/hooks/hooks.json:19`, `core/session/record.ts:103` | Orca 알림은 제외(결정 206) |
| hook Stop | design-appendix 역할 카드 | implemented | `claude-plugin/hooks/hooks.json:22`, `core/session/record.ts:40` | |
| hook Notification | design-appendix 역할 카드 | changed (결정 196) | `claude-plugin/hooks/hooks.json:25`, `core/session/record.ts:183` | |
| hook PostToolUse | design-appendix 역할 카드 | implemented | `claude-plugin/hooks/hooks.json:28`, `core/session/record.ts:50` | |
| hook PostCompact | design-appendix 역할 카드 | implemented | `claude-plugin/hooks/hooks.json:31`, `core/session/record.ts:159` | |
| hook SessionEnd | design-appendix 역할 카드 | implemented | `claude-plugin/hooks/hooks.json:34`, `core/session/record.ts:56` | |
| hook SubagentStop·PreCompact | design-appendix 역할 카드 | cut (결정 193) | `claude-plugin/hooks/hooks.json:3` | 등록 없음 |
| hook StopFailure·PermissionDenied | design-appendix 역할 카드 | changed (결정 193) | `core/detect/orca/mail.ts:134`, `core/detect/orca/mail.ts:162` | 원천은 Orca escalation 과 거부 보고 파일 |
| 가드 다섯(위험 명령·남의 메시지 읽기·스택 유도·주장 차단·바닥 거부) | design-appendix 게이트와 원칙 | cut (결정 193) | `core/gates/index.ts:14` | 남은 코드 없음 |
| agent 셋 | design-appendix 남는 파일과 플러그인 경계 | implemented | `claude-plugin/agents/orchestrator.md:2`, `claude-plugin/agents/lead.md:2`, `claude-plugin/agents/worker.md:2` | |
| skill intake·write-brief·brief·deliver-ticket | design-appendix 남는 파일과 플러그인 경계 | implemented | `claude-plugin/skills/intake/SKILL.md:18`, `claude-plugin/skills/deliver-ticket/SKILL.md:8` | |
| skill todo·orchestrate·start·end-session·reflect·reap-resources·setup | design-appendix 남는 파일과 플러그인 경계 | changed (결정 120) | `claude-plugin/skills/orchestrate/SKILL.md:68`, `claude-plugin/skills/start/SKILL.md:2` | 설계는 넷만 이름을 적었다 |
| 일반 스킬 열넷 | design.html 설계 관점 | changed (결정 95) | `claude-plugin/skills/general/tdd/SKILL.md:2`, `claude-plugin/skills/general/write-skill/SKILL.md:2` | 별도 plugin 대신 `general/` |

## 3. 데이터 · 저장소 · event · MCP · CLI · GRAPH (본문 3절 MCP·4절, 부록 신호 흐름·event·sqlite 스키마·데이터 소유·의존 관리)

| 요소 | 설계 자리 | 상태 | 코드 | 비고 |
|---|---|---|---|---|
| MCP tool item_create | design.html MCP 인터페이스 | implemented | `claude-plugin/mcp/tools/item_create.ts:62`, `core/start/item.ts:29` | trigger·hold·exec_by 입력(결정 162). `lead` 입력과 `item_created.run`(결정 216, `core/start/item.ts:41`, `test/detect/lead-run-s6.test.ts:53`) |
| MCP tool item_retire · CLI item retire | decisions.md 결정 223 (설계 본문에 없음) | changed (결정 223) | `claude-plugin/mcp/tools/item_retire.ts:11`, `cli/commands/item-retire.ts:13`, `core/owner/retire.ts:29`, `core/graph/ready.ts:81`, `core/brief/item_status.ts:78` | PR 이 머지 없이 닫힌 완료 항목을 `item_retired{task, by, reason}` 한 줄로 거둔다. Orca 에는 쓰지 않는다. `retiredOf` 가 참이면 `holdOf` 는 null, 읽기는 🗑️. 흐름 틀의 `closed_pr` 막음도 거둔 단계를 넘긴다(`core/graph/flow.ts:311`). 시험 `test/owner/retire-223.test.ts`. 부록 event 표·용어집·design.html #mcp 의 수는 아직 15 |
| MCP tool edge_add | design.html MCP 인터페이스 | implemented | `claude-plugin/mcp/tools/edge_add.ts:12`, `core/graph/edit.ts:104` | |
| MCP tool edge_remove | design.html MCP 인터페이스 | implemented | `claude-plugin/mcp/tools/edge_remove.ts:12`, `core/graph/edit.ts:136` | |
| MCP tool flow_expand | design.html MCP 인터페이스 | implemented | `claude-plugin/mcp/tools/flow_expand.ts:21`, `core/graph/flow.ts:213` | |
| MCP tool flow_step_skip | design.html MCP 인터페이스 | changed (결정 195) | `claude-plugin/mcp/tools/flow_step_skip.ts:11`, `core/graph/edit.ts:173` | |
| MCP tool decision_open | design.html MCP 인터페이스 | implemented | `claude-plugin/mcp/tools/decision_open.ts:29` | |
| MCP tool decision_answer | design.html MCP 인터페이스 | implemented | `claude-plugin/mcp/tools/decision_answer.ts:19` | |
| MCP tool start_unit | design.html MCP 인터페이스 | implemented | `claude-plugin/mcp/tools/start_unit.ts:44`, `claude-plugin/mcp/stale.ts:13`, `core/start/start.ts:258`, `test/lineage/start.test.ts:1066` | 낡은 서버 거부(결정 211). 오케스트레이터가 비운 `worktreeId` 는 작업 폴더의 worktree 로 읽는다(결정 217) |
| MCP tool land | design-appendix MCP 인터페이스 | implemented | `claude-plugin/mcp/tools/land.ts:6`, `core/land/land.ts:200` | |
| MCP tool handoff_save | design-appendix MCP 인터페이스 | implemented | `claude-plugin/mcp/tools/handoff_save.ts:21` | sqlite 에 쓰지 않는다 |
| MCP tool review_ask_record | design-appendix MCP 인터페이스 | implemented | `claude-plugin/mcp/tools/review_ask_record.ts:21` | |
| MCP tool resource_record | design-appendix MCP 인터페이스 | implemented | `claude-plugin/mcp/tools/resource_record.ts:23`, `core/reaper/record.ts:200` | |
| MCP tool review_record | design-appendix MCP 인터페이스 | changed (결정 162) | `claude-plugin/mcp/tools/review_record.ts:12` | CLI 와 같은 함수의 둘째 입구 |
| MCP tool evidence_record·stage_record | design-appendix MCP 인터페이스 | changed (결정 171) | `claude-plugin/mcp/tools/evidence_record.ts:11`, `claude-plugin/mcp/tools/stage_record.ts:11` | |
| tool item_transition·priority_set·notify | design-appendix MCP 인터페이스 | cut (결정 160) | `claude-plugin/mcp/tools/README.md:55` | LATER — 결정 160 의 조건 |
| tool owner_class·item_trigger | design-appendix 지시 분류 표 | changed (결정 162) | `claude-plugin/mcp/tools/item_create.ts:49` | item_trigger 는 item_create 입력으로 접고 owner_class 는 짓지 않는다 |
| MCP resource brief | design.html MCP 인터페이스 | implemented | `claude-plugin/mcp/resources/brief.ts:6` | |
| MCP resource ready·item_timeline | design.html MCP 인터페이스 | changed (결정 162) | `claude-plugin/mcp/resources/ready.ts:15`, `claude-plugin/mcp/resources/item_timeline.ts:14` | |
| MCP resource models | design.html MCP 인터페이스 | changed (결정 164) | `claude-plugin/mcp/resources/models.ts:15` | |
| 설계에 없는 tool·resource 파일 | design-appendix MCP 인터페이스 | implemented | `claude-plugin/mcp/collect.ts:23` | tool 16·resource 4. 결정 223 의 `item_retire` 하나만 설계 본문에 아직 없다 |
| plugin 이 싣는 서버 | design-appendix MCP 인터페이스 | implemented | `claude-plugin/.mcp.json:1`, `claude-plugin/mcp/server.ts:184` | stdio |
| 서버 메서드 | design-appendix MCP 인터페이스 | implemented | `claude-plugin/mcp/server.ts:57`, `claude-plugin/mcp/server.ts:75` | prompts·구독 없음 |
| CLI brief·todo | design-appendix MCP 인터페이스 | implemented | `cli/commands/brief.ts:34`, `cli/commands/todo.ts:11` | |
| CLI plugin approve·review record | design-appendix 신호 흐름 | implemented | `cli/commands/plugin-approve.ts:10`, `cli/commands/review-record.ts:40` | |
| CLI evidence record·stage record | design-appendix 신호 흐름 | changed (결정 171) | `cli/commands/evidence-record.ts:41`, `cli/commands/stage-record.ts:32` | |
| CLI land·install·uninstall·doctor | design.html 배치표 | implemented | `cli/commands/land.ts:6`, `cli/commands/install.ts:5` | |
| CLI recover·verify-tier·monitor run·migrate | design.html 배치표 | implemented | `cli/commands/recover.ts:15`, `cli/commands/monitor.ts:29` | |
| CLI decision·item new | design-appendix 결정 루프 | implemented | `cli/commands/decision.ts:26`, `cli/commands/item-new.ts:70` | |
| CLI graph add·remove·ready·why·expand·critical·impact | design-appendix GRAPH: 모듈과 CLI | implemented | `cli/commands/graph-add.ts:11`, `cli/commands/graph-why.ts:15` | |
| CLI graph sync | design-appendix GRAPH: 모듈과 CLI | changed (결정 215·217·219) | `cli/commands/graph-sync.ts:19`, `core/graph/sync.ts:58`, `core/graph/own-run.ts:39`, `core/session/record.ts:40`, `test/land/retarget-rereview.test.ts:212`, `test/detect/lead-run-s6.test.ts:99` | G22 닫힘 — queue-monitor 는 `pr_opened` 의 head·base 로 `stacked_on` 을 스스로 더하고(결정 212 ③), base 가 선행 PR 의 head 를 떠난 PR 에서는 그 간선을 뺀다. land 재요청 event 대신 재리뷰(결정 215 ②)가 문이고, 재리뷰 항목 spec 이 land 를 다시 부르라고 한다. 결정 217: CLI 도 재리뷰 항목을 만든다. 결정 219: 타이머는 그 Run 을 깨우지 않는다(실제 Orca 가 보내기를 거부한다). 그 Run 에 묶인 세션의 `UserPromptSubmit`·`Stop` hook 이 같은 호출(`syncOwnRun`)을 한다 |
| CLI graph skip | design-appendix 신호 흐름 | changed (결정 195) | `cli/commands/graph-skip.ts:11` | |
| CLI graph(인자 없음)·priority set·owner-text redact | design.html 의존 관리, design-appendix sqlite 스키마 | cut (결정 160) | `core/store/store.ts:425` | LATER — 오너가 우선순위나 원문 지우기를 요청한 첫 경우 |
| CLI hook·reap run·resource record·models·version | design-appendix 신호 흐름 | implemented | `cli/commands/hook.ts:29`, `cli/commands/reap.ts:27` | 설계 본문에 이름이 없는 셸 입구 |
| 데이터 소유 항목·결정·깨움·간선 | design.html 데이터 소유 | implemented | `core/contract/events/item_extra_set.ts:4`, `core/decision/open.ts:64` | |
| 데이터 소유 오너의 말 | design.html 데이터 소유 | implemented | `core/store/store.ts:413` | owner_class 는 결정 162 가 짓지 않았다 |
| 데이터 소유 PR·증거·등급·자원 | design.html 데이터 소유 | implemented | `core/land/land.ts:200`, `core/reaper/record.ts:200` | |
| 데이터 소유 외부 티켓 | design.html 데이터 소유 | implemented | `core/start/start.ts:475`, `claude-plugin/mcp/tools/start_unit.ts:57` | 키 칸은 없고, `start_unit` 의 `references` 가 새 worktree 에 `reference add` 로 붙인다(`claude-plugin/skills/start/SKILL.md:44`) |
| 간선 종류 넷 | design.html 의존 관리 | implemented | `core/graph/ready.ts:113`, `core/graph/ready.ts:137` | blocks·after·stacked_on·deploys_after |
| GRAPH 유일 입구 | design.html 의존 관리 | implemented | `core/graph/edit.ts:9`, `core/start/item.ts:33` | 만든 뒤 간선은 GRAPH 만. 만들 때의 deps 는 Orca 가 원본이라 task-create 로 간다 |
| 준비됨과 시작 | design.html 의존 관리 | changed (결정 202) | `core/graph/ready.ts:213`, `core/start/start.ts:436` | start_unit |
| 신호는 event 한 줄 먼저 | design-appendix 신호 흐름 | implemented | `core/store/store.ts:355` | |
| notify dedupe·받는 순서 | design-appendix 신호 흐름 | implemented | `core/notify/notify.ts:37`, `core/notify/notify.ts:118` | |
| 예시 사슬 pr_merged → item_ready | design-appendix 신호 흐름 | implemented | `core/detect/queue/judge.ts:52`, `core/detect/queue/round.ts:73` | |
| 주기 실행 한 곳 | design-appendix 신호 흐름 | implemented | `orca-plugin/timer.ts:2`, `core/detect/queue/drift.ts:1` | |
| event 이름 78 대 파일 78 | design-appendix event 이름 전체 | implemented | `core/contract/index.ts:36` | 빠진 이름도 남는 이름도 없다(`test/spec-names.test.ts`) |
| event 묶음 hook·chat·queue·resource·land·REAPER·타이머·리뷰 의뢰·셸·notify·GRAPH·결정·자원 | design-appendix event 이름 전체 | implemented | `core/session/record.ts:121`, `core/detect/queue/judge.ts:52` | |
| event 묶음 orca-monitor | design-appendix event 이름 전체 | changed (결정 196) | `core/detect/orca/judge.ts:1`, `core/detect/orca/mail.ts:1` | |
| event 묶음 pr-monitor | design-appendix event 이름 전체 | changed (결정 195·216) | `core/detect/pr/round.ts:1`, `core/detect/pr/reviews.ts:1` | 결정 216 이 `pr_reopened` 를 더했다(`core/detect/pr/round.ts:254`, `test/land/retarget-rereview.test.ts:248`). 부록 표에는 아직 없다 |
| event 묶음 에이전트 명령 | design-appendix event 이름 전체 | partial | `core/start/start.ts:151`, `core/brief/item_status.ts:113` | G27 — `signal` 의 loss·wait·orchestrator_correction·main_flake 종류를 쓰는 곳이 없다(`priority_set` 은 결정 160) |
| event 묶음 오너 | design-appendix event 이름 전체 | partial | `core/owner/marks.ts:87`, `core/contract/events/owner_class.ts:4` | G28 — `owner_class` 계약과 표시를 지우는 길이 쓰는 쪽 없이 남았다(결정 162) |
| event schema_v | design-appendix event 이름 전체 | implemented | `core/store/store.ts:141` | |
| SQLite 버전 하한·네트워크 FS 거부 | design-appendix sqlite 스키마 | implemented | `core/store/checks.ts:15`, `core/store/checks.ts:56` | |
| BEGIN IMMEDIATE·WAL·busy_timeout | design-appendix sqlite 스키마 | implemented | `core/store/store.ts:228`, `core/store/store.ts:344` | |
| dedupe_key 와 UNIQUE | design-appendix sqlite 스키마 | implemented | `core/store/schema.ts:50`, `core/store/store.ts:376` | |
| 표 event·owner_text·counter·migration | design-appendix sqlite 스키마 | implemented | `core/store/schema.ts:34`, `core/store/schema.ts:60` | |
| 캐시 pr_ref·gh_budget·gh_seen | design-appendix sqlite 스키마 | changed (결정 186) | `core/store/schema.ts:86`, `core/gh/client.ts:41` | 표는 예약, 한도·ETag 는 프로세스 메모리 |
| 보존 기간 표 load_sample | 결정 241 (부록 sqlite 스키마에 없음) | changed (결정 241) | `core/store/schema.ts:115`, `core/store/samples.ts:10`, `core/detect/resource/round.ts:37` | 라운드마다 부하 표본 한 행, 24시간, 사본에 들지 않음 |
| 뷰 owner_action·item_extra·item·evidence·edge | design-appendix sqlite 스키마 | changed (결정 160) | `core/graph/facts.ts:1`, `core/brief/item_status.ts:222` | 이름 있는 함수 없이 같은 event 를 접는다 |
| 뷰 decision·owner_todo·item_timeline·edge_ok·ready·flow_gap·group_brief·group_items·restart_due | design-appendix sqlite 스키마 | implemented | `core/store/views/decision.ts:11`, `core/graph/ready.ts:213` | restart_due 를 부르는 쪽은 G10 |
| 뷰 item_status 의 🚨 orphan_extra | design-appendix sqlite 스키마 | missing | `core/brief/item_status.ts:222`, `core/contract/views.ts:90` | G24 — 주석에 이름만 있고 판정이 없다 |
| 뷰 done_blockers | design-appendix sqlite 스키마 | implemented | `core/graph/flow.ts:311`, `core/detect/pr/round.ts:165`, `core/owner/done.ts:47`, `core/gates/done-blockers.ts:12` | Task 를 닫는 세 자리(pr-monitor 의 닫기, 패널의 완료, 역할 세션의 `task-update --status completed`)가 막는 것을 적어 거부한다(결정 212 ④) |
| 뷰 ask_due | design-appendix sqlite 스키마 | cut (결정 161) | `core/contract/views.ts:182` | 시그니처만. LATER 조건은 2절 N6 |
| 소유 PR·Run·Task·게이트·대화 기록 | design-appendix 데이터 소유 | implemented | `core/detect/pr/round.ts:1`, `core/decision/open.ts:137` | |
| 소유 부가 정보·간선·결정 키 | design-appendix 데이터 소유 | implemented | `core/store/schema.ts:111` | event 만 정본 |
| 캐시 예외 owner_text | design-appendix 데이터 소유 | implemented | `core/store/schema.ts:67` | 비우기만(결정 183) |
| 저장하지 않는 것 | design-appendix 데이터 소유 | implemented | `core/store/schema.ts:110` | 표 목록 고정 |
| 상태 대응표 | design-appendix 데이터 소유 | implemented | `core/contract/transitions.ts:6`, `core/graph/ready.ts:53` | |
| Run 범위 다섯 곳 | design-appendix 데이터 소유 | partial | `core/graph/edit.ts:192` | G24 — 넷째(고아 부가 정보 표시와 REAPER 의 거둠)가 없다 |
| 불변식 event 인덱스 | design-appendix 데이터 소유 | partial | `core/store/schema.ts:54` | G26 — `edge_*` 의 pred 표현식 인덱스가 없다 |
| 불변식 owner_text·edge DAG·ready·크리티컬 패스·notify·owner_todo·counter | design-appendix 데이터 소유 | implemented | `core/store/schema.ts:14`, `core/graph/critical.ts:100` | |
| 불변식 item 전환 | design-appendix 데이터 소유 | partial | `core/contract/transitions.ts:19`, `core/store/store.ts:369` | G24 — 허용 쌍 19 는 강제, done_blockers 는 닫는 세 자리에서 적용(결정 212 ④), orphan_extra 없음 |
| 불변식 decision | design-appendix 데이터 소유 | partial | `core/decision/open.ts:64`, `core/decision/answer.ts:57` | G25 — 키 유일·닫힘 순서는 있고 다시 묻기(`:r<n>`)가 없다 |
| 선행 노드 종류·모름과 없음 | design-appendix 간선과 ready 계산 | implemented | `core/graph/edit.ts:26`, `core/graph/ready.ts:88` | |
| 📅 → 🟢 쓰는 쪽 없음·왜 표 | design-appendix 간선과 ready 계산 | changed (결정 218) | `core/graph/ready.ts:262`, `core/graph/notify-ready.ts:1` | 결정 218: 항목을 스스로 잡는 것(자기 PR, 오너 gate, Orca 막힘)은 `holdOf`(`core/graph/ready.ts:76`) 하나가 답하고, 항목 상태의 🚧 와 왜 행(`core/graph/ready.ts:87`)이 그것을 읽는다 |
| 순환 검사·같은 간선 합침·edge_no_cycle | design-appendix 순환 거부 | implemented | `core/graph/edit.ts:113`, `core/store/schema.ts:14` | |
| 틀 TOML·펼치기·dry-run | design-appendix 흐름 틀 형식 | implemented | `core/graph/flow.ts:132`, `core/graph/flow.ts:217` | |
| ship-change 틀 | design-appendix 흐름 틀 형식 | changed (결정 126) | `core/graph/flows/ship-change.toml:41` | |
| ship-batch 틀·owner 단계·건너뛰기 이유 | design-appendix 흐름 틀 형식 | implemented | `core/graph/flows/ship-batch.toml:15`, `core/graph/edit.ts:174` | |
| 틀 항목 완료 조건 | design-appendix 흐름 틀 형식 | implemented | `core/graph/flow.ts:311`, `core/gates/done-blockers.ts:12` | 흐름 뿌리는 단계가 다 있고 끝나고 PR 이 머지돼야 닫힌다(결정 212 ④) |
| 크리티컬 패스·영향 범위 | design-appendix 크리티컬 패스, 영향 범위 | changed (결정 218) | `core/graph/critical.ts:39`, `core/graph/critical.ts:159` | 결정 218: 자기 PR 이 잡은 완료 Task 도 끝나지 않은 항목이고, 열린 PR 마디의 간선은 그 PR 이 묶인 항목에서 나온다(PR 을 거쳐 순환이 되면 잇지 않는다) |
| GRAPH 상주 안 함 | design-appendix GRAPH: 모듈과 CLI | implemented | `core/graph/index.ts:5` | |

## 4. 흐름 · 지시 · 결정 루프 · 실패 방지 · 기존 설계 참고 (본문 5절, 부록 실패 표·지시 분류·전달 규칙·일이 기다리는 곳·결정 루프·기존 설계 참고)

| 요소 | 설계 자리 | 상태 | 코드 | 비고 |
|---|---|---|---|---|
| 오너 지시 하나 | design.html §5 오너 지시 하나 | changed (결정 162) | `core/session/record.ts:85`, `claude-plugin/skills/intake/SKILL.md:18` | 분류 event 는 쓰지 않는다 |
| 흐름 1 item_create → task-create --deps | design.html §5 흐름 1 | implemented | `core/start/item.ts:33` | |
| 흐름 1 ready·capacity 먼저 | design.html §5 흐름 1 | implemented | `core/start/start.ts:335`, `core/start/start.ts:366` | |
| 흐름 1 worktree create·설정·unit_started·worker-start | design.html §5 흐름 1 | implemented | `core/start/start.ts:381`, `core/start/start.ts:436` | 결정 202 꼴 |
| 흐름 1 setup 셸은 REAPER 가 닫음 | design.html §5 흐름 1 | implemented | `core/reaper/round.ts:141`, `core/reaper/round.ts:148` | |
| 흐름 1 SessionStart 역할 줄·브리프 | design.html §5 흐름 1 | implemented | `core/session/session-start.ts:56` | |
| 흐름 1 lineage·거부 다섯·escalation | design.html §5 흐름 1 | implemented | `core/start/start.ts:151`, `core/start/start.ts:164` | |
| 흐름 1 깊이가 모자라면 리드 없이 | design.html §5 흐름 1 | implemented | `core/start/start.ts:271`, `claude-plugin/agents/orchestrator.md:43` | 거부는 코드, 고르는 것은 판단 층 |
| 흐름 1 코어 밖 시작을 막는 hook | design.html §5 흐름 1 | implemented | `core/gates/start.ts:166`, `test/lineage/no-other-start.test.ts:43` | |
| 흐름 2 기록(dNNN 이면 바로 잇기)·패널 버튼 | design.html §5 흐름 2 | implemented | `core/session/record.ts:110`, `core/brief/panel.ts:154` | |
| 흐름 2 dNNN 없는 답의 연결 | design.html §5 흐름 2 | cut (결정 160) | `core/decision/input.ts:18` | LATER — 오너 발언 hook 이 seq 를 맥락에 붙이는 단위에서 |
| 흐름 2 열기·닫기·전파 | design.html §5 흐름 2 | implemented | `core/decision/open.ts:127`, `core/decision/release.ts:65` | |
| 흐름 2 재질문 게이트·결정 운반 Task | design.html §5 흐름 2 | implemented | `core/decision/open.ts:72`, `core/decision/open.ts:151` | |
| 흐름 3 증거 → 조건 넷 → 예약·승인 대기·판정 머지 | design.html §5 흐름 3 | implemented | `core/land/land.ts:200`, `core/land/land.ts:240` | 결정 158·172·204 |
| 흐름 3 worker_done·worker-release | design.html §5 흐름 3 | implemented | `claude-plugin/agents/worker.md:23`, `claude-plugin/agents/lead.md:39` | 결정 175·197 |
| 흐름 3 머지 전 🚧·pr_ready_to_merge | design.html §5 흐름 3 | implemented | `core/brief/item_status.ts:155`, `core/detect/pr/round.ts:391` | |
| 흐름 3 머지 확인 → completed | design.html §5 흐름 3 | implemented | `core/land/github.ts:248`, `core/detect/pr/round.ts:200` | |
| 흐름 3 deploys_after 항목의 🔍 | design.html §5 흐름 3 | implemented | `core/verify/evidence.ts:50`, `core/brief/item_status.ts:216`, `core/graph/ready.ts:137` | 후속 준비는 stage 기록으로 막고, 머지된 항목은 dev 칸과 통과한 dev 증거가 없으면 🔍 다(결정 212 ⑤) |
| 흐름 3 main 빨강이면 동결 | design.html §5 흐름 3 | implemented | `core/land/land.ts:165`, `core/detect/pr/round.ts:457` | |
| 흐름 3 REAPER 표시 → 정리·삭제 전 검사·rm·Docker | design.html §5 흐름 3 | implemented | `core/reaper/round.ts:388`, `core/reaper/docker.ts:25` | 결정 194 |
| 흐름 3 라운드 시각·pr_merged 힌트 | design.html §5 흐름 3 | implemented | `core/detect/queue/stall.ts:35`, `orca-plugin/reaper/round.ts:10` | |
| 흐름 4 타이머 → monitor → event | design.html §5 흐름 4 | implemented | `orca-plugin/timer.ts:53`, `orca-plugin/main.ts:164` | |
| 흐름 4 판단 필요만 깨움 | design.html §5 흐름 4 | partial | `core/detect/notice.ts:11`, `core/notify/notify.ts:80` | G30 — 순서와 한 키 한 번은 notify 에 있고, event 의 `needs` 칸으로 거르지 않고 판정마다 깨울지를 정한다 |
| 흐름 4 resource 로 2·3단계 | design.html §5 흐름 4 | changed (결정 162) | `claude-plugin/mcp/resources/brief.ts:7` | 2·3단계 resource 는 짓지 않았다 |
| 흐름 4 패널·상태 표시줄 다시 읽기 | design.html §5 흐름 4 | changed (결정 205·219) | `orca-plugin/main.ts:91`, `orca-plugin/main.ts:104`, `core/brief/load.ts:41` | 결정 219 ⑭: 한 읽기의 Orca 호출을 나란히(약 1.23 초 → 0.24 초), 상태 round 는 그 간격 안의 패널 읽기를 쓴다 |
| 경계 다섯 | design.html §5 경계마다 무엇이 오가나 | implemented | `cli/commands/hook.ts:51`, `core/orca/adapter.ts:291` | hook·MCP·worker·Orca CLI·두 plugin |
| 실패 stack_order·review_timing·cross_lead·stack_bottom·overlap_order·unknown_is_not_ready·merge_suggests_close·precheck_blocks_send·repo_level_main | design-appendix 실패 → 방지 장치 → 회귀 시험 | implemented | `core/graph/ready.ts:133`, `test/graph/regressions.test.ts:20` | 장치와 시험이 모두 있다 |
| 실패 retarget_approval | design-appendix 실패 → 방지 장치 → 회귀 시험 | changed (결정 215) | `core/land/land.ts:445`, `core/graph/rereview.ts:27`, `core/detect/pr/round.ts:397`, `test/land/retarget-rereview.test.ts:116` | G31 닫힘 — base 변경 뒤에 기록된 판정만 센다(patch-id 승계도 그 뒤의 판정만). 재리뷰 항목은 queue round 가 blocks 로 만든다(그 Run 밖이라 거부되면 그 Run 을 깨워 그 세션이 만든다, 결정 217, `core/graph/rereview.ts:59`). 결정 216: 머지된 아래 PR 의 head 브랜치를 base 로 둔 PR 은 `base_merged`, retarget 을 pr-monitor 가 아직 기록하지 않았으면 `base_unrecorded` 로 거부한다(`core/land/land.ts:195`, `core/land/land.ts:204`, `test/land/retarget-rereview.test.ts:286`) |
| 실패 early_done·prod_gate | design-appendix 실패 → 방지 장치 → 회귀 시험 | implemented | `core/graph/flow.ts:311`, `test/graph/flow.test.ts:124`, `test/graph/done-close-g23.test.ts` | 닫는 세 자리가 done_blockers 로 거부한다(결정 212 ④) |
| 분류 바로 답·읽기·범위·시각 대기 | design-appendix 지시 분류 표 | changed (결정 162) | `claude-plugin/skills/intake/SKILL.md:18`, `claude-plugin/skills/intake/SKILL.md:32` | owner_class 줄 없이, 범위는 Orca send |
| 분류 새 일·오너 판단·열린 결정의 답 | design-appendix 지시 분류 표 | implemented | `core/start/item.ts:33`, `core/decision/open.ts:45` | |
| 지시가 흐르는 그림 | design-appendix 지시가 흐르는 그림 | changed (결정 162) | `core/session/record.ts:85`, `core/store/schema.ts:60` | |
| 기록과 깨움 따로·받는 순서·한 번만·Orca 메시지 | design-appendix 전달 규칙 | implemented | `core/notify/notify.ts:8`, `core/notify/notify.ts:98` | |
| needs 가 깨울 쪽을 정함 | design-appendix 전달 규칙 | partial | `core/detect/notice.ts:11` | G30 |
| escalation 한 단계 위 | design-appendix 전달 규칙 | implemented | `core/detect/queue/judge.ts:118` | |
| 잘린 메시지를 보낸 쪽이 받음 | design-appendix 전달 규칙 | cut (결정 161) | `core/notify/notify.ts:65` | LATER(R-08) — Orca 가 잘림을 응답에 싣게 되면 |
| 재개 시 대기 다시 붙이기 | design-appendix 전달 규칙 | missing | `core/session/session-start.ts:56` | G32 — SessionStart 도 agent 글도 대기를 다시 붙이라고 하지 않는다 |
| 모아 보내기(기본 300초) | design-appendix 전달 규칙 | missing | `core/notify/notify.ts:55` | G33 — notify 와 notice 에 모아 보내기가 없다 |
| reload 알림 | design-appendix 전달 규칙 | cut (결정 161) | — | LATER(R-23) — 설치가 열린 세션에 갱신을 알려야 할 때 |
| 거부된 행동을 다른 길로 다시 하지 않음 | design-appendix 전달 규칙 | cut (결정 161) | `core/gates/record.ts:12` | LATER(R-10) — 재시도가 관측된 첫 거부에서 |
| 거부 보고 refusal_report·파일 형식 | design-appendix 전달 규칙 | implemented | `core/detect/orca/mail.ts:40`, `core/detect/orca/judge.ts:36` | 결정 196 |
| 거부 수집 뷰·설정 차이 뷰 | design-appendix 전달 규칙 | missing | `core/gates/record.ts:12` | G34 — refusal_report·gate_denied 를 날짜·묶음별로 세는 뷰, 권장과 실제 설정의 차이 뷰가 없다 |
| 일이 기다리는 곳 다섯 | design-appendix 일이 기다리는 곳 | implemented | `core/graph/ready.ts:167`, `core/detect/queue/judge.ts:59` | 보류의 ⚠️ 는 trigger_unclear(`core/brief/build.ts:557`) |
| 닫지 않음, 예외는 머지 확인 | design-appendix 일이 기다리는 곳 | implemented | `core/detect/pr/round.ts:200`, `core/owner/probe.ts:157` | |
| 결정 키 정규화 | design-appendix 결정 루프 | implemented | `core/decision/key.ts:5` | |
| 결정 루프 다시 묻기 | design-appendix 결정 루프 | missing | `core/decision/open.ts:72` | G25 — 오너 근거로 닫힌 결정을 다시 여는 길이 없다 |
| 결정 루프 기록과 연결 | design-appendix 결정 루프 | cut (결정 160) | `core/session/record.ts:110`, `core/decision/answer.ts:82` | 흐름 2 의 dNNN 없는 답과 같은 조건 |
| 결정 루프 닫기·전파·멈춘 전달·waiting_human·moot·늦은 답·후보 신호 | design-appendix 결정 루프 | implemented | `core/decision/release.ts:32`, `core/decision/moot.ts:66` | |
| 결정 루프 오너가 직접 한 일 | design-appendix 결정 루프 | changed (결정 179) | `core/detect/pr/round.ts:216` | 연결은 부른 쪽 몫 |
| 기존 설계 결정별 결론 | design-appendix 결정별 결론 | implemented | `core/store/schema.ts:47`, `core/start/start.ts:317` | 저장·큐·그래프·틀·역할·화면·주기 실행 |
| 결정별 결론·후보별 판정의 스택 PR·머지 대기열 | design-appendix 결정별 결론, 후보별 판정 | partial | `core/land/land.ts:61`, `core/land/land.ts:171` | G35 — 대기열 이탈 사유 분류와 merge_group 사전 점검이 없다 |
| 후보별 판정 나머지 영역 | design-appendix 후보별 판정 | implemented | `core/store/store.ts:344`, `claude-plugin/mcp/server.ts:1` | |
| 스무 가지 1–3 유일성·fencing·기한 | design-appendix 조사가 설계에 낸 스무 가지 | cut (결정 74) | `core/store/schema.ts:50` | 시작 유일성은 Orca Dispatch |
| 스무 가지 4–11·14·16–20 | design-appendix 조사가 설계에 낸 스무 가지 | implemented | `core/start/start.ts:324`, `core/graph/critical.ts:20` | |
| 스무 가지 12 /goal | design-appendix 조사가 설계에 낸 스무 가지 | changed (결정 121) | `claude-plugin/agents/worker.md:23` | |
| 스무 가지 13 hook 후보 | design-appendix 조사가 설계에 낸 스무 가지 | changed (결정 193) | `claude-plugin/hooks/hooks.json:3` | |
| 스무 가지 15 대기열 안 만듦 | design-appendix 조사가 설계에 낸 스무 가지 | partial | `core/land/land.ts:61` | G35 |

## 5. 결정이 자르거나 바꾼 것

설계 본문과 부록에는 이미 바뀐 글이 있고, 아래는 결정 번호로 따라갈 수 있게 모은 목록이다. 앞 절에 같은 요소가 있으면 여기서는 빼거나 묶었다.

| 요소 | 설계 자리 | 상태 | 코드 | 비고 |
|---|---|---|---|---|
| claim·세대·lease·CLAIMER | decisions.md 결정 7·8·50·66 | cut (결정 74) | — | 남은 코드 없음 |
| inbox 뷰·message·ack | decisions.md 결정 2·4·16 | cut (결정 74) | `core/notify/notify.ts:98` | 깨움 원본은 Orca 메시지 |
| DECISION EXECUTOR | decisions.md 결정 36·72·73 | changed (결정 74) | `core/decision/answer.ts:30` | 함수가 닫기·풀기·전파 |
| 결정 루프를 게이트에 얹지 않음 | decisions.md 결정 67 | changed (결정 76) | `core/decision/open.ts:127` | |
| sqlite 가 유일 원본 | decisions.md 결정 33 | changed (결정 76) | `core/start/item.ts:26` | |
| 아무것도 자동으로 닫지 않음 | decisions.md 결정 10·37 | changed (결정 76) | `core/detect/pr/round.ts:200` | 결정 84 ①·142 |
| Orca DAG 를 간선 저장소로 안 씀 | decisions.md 결정 26 | changed (결정 76) | `core/start/item.ts:32` | |
| 정적 웹 대시보드 | decisions.md 결정 11·55·65 | changed (결정 75) | `core/brief/panel.ts:66`, `orca-plugin/main.ts:12` | Orca plugin 패널 |
| Orca 자동화로 주기 실행 | decisions.md 결정 9·41 | changed (결정 75) | `orca-plugin/timer.ts:53` | |
| 설계 7절 오너 결정 목록·별도 build-plan·queue-monitor 단계 | decisions.md 결정 18·56·69·70 | cut (결정 69·71·75) | — | 문서 구조만 |
| REAPER 가 worker-release | decisions.md 결정 62 | changed (결정 197) | `claude-plugin/agents/lead.md:39` | |
| REAPER 이벤트 구동 정리 | decisions.md 결정 82 | changed (결정 83) | `core/reaper/round.ts:388` | 표시 → 정리 |
| sqlite handoff 줄 | decisions.md 결정 80 N1 | cut (결정 80) | `core/session/handoff.ts:6` | 인계 본문은 Orca 메시지 |
| 대체 시작 | decisions.md 결정 59·86 ③ | cut (결정 94) | `core/gates/start.ts:166` | |
| 이전 plugin 규칙 넷 | decisions.md 결정 79 | cut (결정 79) | — | |
| chat-monitor 대체 수집 경로 | decisions.md 결정 45 | cut (결정 45) | `core/detect/chat/round.ts:4` | |
| 현황 1단계 묶음마다 한 줄 | decisions.md 결정 21 | changed (결정 89) | `core/brief/render.ts:78` | 네 절 표 |
| 승인 지문 | decisions.md 결정 77 (다) | changed (결정 105) | `core/approve/approve.ts:66` | contentHash |
| 작성자가 merge_ready 로 끝남 | decisions.md 결정 81·84 ① | changed (결정 175) | `core/brief/item_status.ts:155` | |
| worker_done 으로 후속 풀림 | decisions.md 결정 175 | changed (결정 178) | `core/graph/ready.ts:118` | PR 머지 때 준비됨 |
| 판정 dedupe 키·linked_by 범위 | decisions.md 결정 111·162 | changed (결정 179) | `core/approve/review-verdict.ts:50`, `core/decision/input.ts:18` | |
| 상태 표시줄 글 | decisions.md 결정 92 ⑤ | changed (결정 170) | `orca-plugin/panel/requests.ts:31` | |
| 판정 머지 V3·등급 목록 없음 | decisions.md 결정 85·125·158 | changed (결정 172) | `core/land/land.ts:198`, `core/land/land.ts:240` | |
| 오너 아닌 prompt 꼴 | decisions.md 결정 173·196 | changed (결정 206) | `core/owner/prompt.ts:22` | |
| prompt hook 출처 표시 | decisions.md 결정 196 ⑧ | cut (결정 206) | — | |
| reaper 칸 없음 처리 | decisions.md 결정 144·174 | changed (결정 202) | `core/reaper/round.ts:182` | |
| 오너 완료 바로 닫고 🔍 | decisions.md 결정 91·92 ⑥ | changed (결정 181) | `core/brief/item_status.ts:161`, `core/owner/probe.ts:157` | |
| job_drift 내용 해시 | decisions.md 결정 149 | changed (결정 185) | `core/detect/queue/drift.ts:12` | |
| 계약만 event | decisions.md 결정 186 | changed (결정 196) | `core/detect/orca/judge.ts:36` | |
| 어댑터 행 아홉 | decisions.md 결정 193 ④ | cut (결정 193) | `core/orca/README.md:12` | 남은 행 없음 |
| ports·keep-open·repo 행 | decisions.md 결정 193 ⑤ | changed (결정 193) | `core/orca/adapter.ts:340`, `core/start/start.ts:436` | |
| loop_detected 원천 | decisions.md 결정 193 ① | changed (결정 193) | `core/start/start.ts:324` | 시작 실패 세 번뿐 |
| REAPER 검사·Task 루트 | decisions.md 결정 83·177 | changed (결정 194) | `core/reaper/round.ts:422` | |
| compose 데몬 없음 건너뜀 | decisions.md 결정 194 ④ | changed (결정 201) | `core/reaper/docker.ts:19` | ENOENT 만 |
| 리뷰 사건 깨움·self-land 못 읽으면 | decisions.md 결정 195 ③·198 ③ | changed (결정 201) | `core/gates/self-land.ts:12` | 못 읽으면 막는다 |
| advisor 설정 길·다음 시작 멈춤 | decisions.md 결정 200 | changed (결정 202) | `core/start/start.ts:395` | |
| "주석만" 파서 | design-appendix 동작확인 등급 | cut (결정 203) | `core/verify/verify-tier.ts:73` | 주석만 바꾼 코드는 V2 |
| cross-PC·P11·대안 B | docs/test-outcomes.md P11 | cut (결정 203) | `core/orca/host-filter.ts:6` | 하한만 남음 |
| 코어 어댑터를 거치는 ask·reply | decisions.md 결정 193 | cut (결정 203) | `core/orca/README.md:12` | 세션 자기 글 |
| gh repo clone 실패 처리 | decisions.md 결정 203 (4) | cut (결정 203) | — | 코드에 clone 호출 없음 |
| 머지 조건 (1)–(3) 설정만 읽기 | decisions.md 결정 81·158 | changed (결정 204) | `core/land/land.ts:261`, `core/gh/merge-conditions.ts:10` | |
| run-list 행·REAPER 루트 | decisions.md 결정 193·83 | changed (결정 207) | `core/orca/adapter.ts:253` | |
| 언제나 --effort | decisions.md 결정 172 | changed (결정 209) | `core/start/start.ts:435` | |
| 디스크 문턱 기본값 | decisions.md 결정 115 | changed (결정 210) | `core/capacity/capacity.ts:27` | |
| 돌던 세션 재시작 안내 | decisions.md 결정 208 | changed (결정 211) | `claude-plugin/mcp/tools/start_unit.ts:168` | server_stale |

## 6. 이 대조가 읽지 않은 것

- Homebrew formula 는 별도 탭 저장소에 있어 읽지 않았다(G9).
- `docs/research/` 의 조사 메모와 `docs/dashboard/` 시안은 설계가 가리킬 때만 열었다.
- 각 행의 `implemented` 는 본문을 읽은 판정이다. 시험을 돌려 확인한 것은 아니다.

## 7. 갭 목록

| G | 갭 | 제안 | 이유 · 다시 볼 조건 |
|---|---|---|---|
| G1 | 패널이 `terminal create`·`plugin open` 을 어댑터 밖에서 부른다 | LATER | 명령 표 대조(`orca-commands`)가 이 두 줄을 보지 못한다. Orca 가 그 인자를 바꾼 첫 버전에서 패널 호출을 `ORCA_COMMANDS` 표에 올린다 |
| G2 | 결정 193 이 세션 글로 옮긴 `worktree set`·`reference list`·`search` 가 agent·skill 본문에 없다 | NOW | 결정 193 ④ 가 "세션이 자기 글로 부른다" 고 적었고 오너의 고정 규칙(Orca 내장 기능 최대 사용)이 있다. 카드 상태 표시(`worktree set`)는 오너가 Orca 에서 보는 화면이다. 고칠 것은 lead·worker 글 몇 줄이다. U77 에서 고쳤다: agent 셋과 `deliver-ticket`·`orchestrate`·`intake` 가 세 동사를 부르고 `test/session-verbs.test.ts` 가 지킨다 |
| G3 | Orca plugin storage 를 쓰지 않는다 | LATER | 지금 패널은 매번 store 와 Orca 에서 읽어 잃는 상태가 없다. 패널이 다시 열 때 잃으면 안 되는 화면 상태가 생기면 |
| G4 | `reference remove` 행이 없다 | LATER | 붙인 참조를 떼야 하는 첫 경우(잘못 붙인 티켓) |
| G5 | 매니페스트는 읽기 능력만 선언하고 패널은 쓰기 CLI 를 부른다 | LATER | Orca 가 trusted-worker 의 CLI 호출에도 능력 선언을 요구하게 되면 |
| G6 | 기능 활용 표의 `worker-read`·`status` 세션 id·`terminal read`·`skills get`·`worktree show/current`·`repo list`·`terminal-daemon status` 를 쓰지 않는다 | LATER | 행마다 그 기능이 필요한 첫 판정에서. `terminal read` 는 queue-monitor 가 대기 발췌를 못 싣는다고 스스로 적으므로 가장 먼저다 |
| G7 | Orca 연동 우회 둘(세션 조작 "모름" 응답 `agent_session_operation_unknown`, 기존 터미널에 Dispatch)이 없다 | LATER | 그 오류 코드나 실패가 관측된 첫 경우 |
| G8 | 남는 파일 표의 브리프·리드 기록 경로, 압박 이력, 실행 로그 폴더를 쓰는 코드가 없다 | DROP | 브리프는 Orca Task spec, 리드 기록은 Orca 메시지와 event 가 원본이라 파일 사본은 이중 저장이 된다. 압박 이력은 G17 과 함께 다시 본다 |
| G9 | formula 를 이 저장소에서 확인할 수 없다 | LATER | 탭 저장소를 대조하는 릴리스 점검 단위에서 |
| G10 | `restart_due` 를 부르는 쪽이 없다(N1) | 닫힘(결정 212 ①) | 설계가 지어졌다고 적은 복구 규칙이고, 오케스트레이터 글이 이 신호를 기다린다. 재현: 시험 밖 호출자 0 |
| G11 | `wake_unconfirmed` 를 한 단계 위로 올리지 않는다(N3) | 닫힘(결정 212 ②) | 설계가 지어졌다고 적은 복구 규칙이다. 깨움이 실패하면 아무도 모른다 |
| G12 | resource-monitor 의 누수 검사가 Docker 만 본다 | LATER | Docker 밖의 누수(프로세스·compose·worktree)가 처음 관측되면 |
| G13 | 묶음 상세의 절 순서가 시안과 다르다 | 고침(U76) | 결정 199 ⑥ 이 "다음 패널 단위의 일" 로 남겼다. 그래프 · 왜 · 간선 뒤에 상태별 절과 최근 전환이 온다(`test/panel/group-199.test.ts`) |
| G14 | 항목 상세에 대화 기록 위치가 없다 | LATER | reflect 나 오너가 항목에서 대화로 가야 하는 첫 경우 |
| G15 | 줌 보조 화면이 없다 | DROP | 결정 92 가 기본이 아닌 별도 보기로 낮췄고 시안 파일도 저장소에 없다. 오너가 다시 원하면 새 결정으로 |
| G16 | 채팅 글 현황에 완료 7일 목록·묶음 0개 안내가 없다 | 고침(U76) | 결정 199 ⑥ 이 `sangsoe brief` 글에 새 부분을 더하는 일을 다음 패널 단위로 남겼다. 글은 `--done` 으로 목록을 펴고 묶음 0개면 패널과 같은 안내 줄을 둔다(`test/brief/brief-text-199.test.ts`) |
| G17 | 압박 게이트가 기다릴 순서를 알려 주지 않고 맞추는 무거운 작업이 셋뿐이다 | LATER | 압박 거부 뒤 같은 명령이 되풀이된 것이 관측되면 |
| G18 | 스킬 크기 상한 시험과 hook 호출당 비용 측정이 없다 | LATER | 스킬이 상한을 넘은 첫 PR, 또는 hook 지연이 체감되면 |
| G19 | 화면 언어 설정이 없다 | DROP | 오너가 한 사람이고 한국어를 쓴다. 다른 언어 사용자가 생기면 새 결정으로 |
| G20 | 패널에 그래프 들여쓰기 대체와 Markdown 저장 버튼이 없다 | LATER | SVG 가 그려지지 않는 환경이 관측되거나 오너가 저장을 요청하면 |
| G21 | 현황에 "내 지시는 어디까지 갔나" 접힘 구역이 없다 | LATER | 오너 지시를 항목으로 따라가야 하는 첫 경우(owner_class 와 함께, G28) |
| G22 | `stacked_on` 간선이 자동으로 생기지 않고 base 변경 PR 의 land 재요청이 없다 | 닫힘(결정 215 ⑦) | 흐름 3 과 실패 표의 stack_order 가 기대는 길이다. 재현: queue-monitor 가 `syncGraph` 를 stack 없이 부르고(`core/detect/queue/round.ts:66`) `relandPrs` 는 세기만 한다. 손으로 가는 길은 있다: `deliver-ticket` skill 이 `stacked_on` 간선을 걸라고 하고 land 가 간선으로 순서를 지킨다(`core/land/land.ts:385`). 그래서 빠지는 것은 세션이 간선을 잊은 경우의 자동 보정이다. 결정 212 ③ 이 자동 `stacked_on` 을 지었고, ⑥ 이 land 가 GRAPH 의 `pr:`·`item:` 노드 이름을 읽게 고쳤다(그 전에는 간선이 순서를 지키지 않았다). 남은 반은 결정 215 ⑦ 이 닫았다(U78): base 가 바뀌면 낡은 간선을 빼고, 재리뷰 뒤 land 를 다시 부른다 |
| G23 | `done_blockers` 가 완료 전환을 거부하지 않는다 | 닫힘(결정 212 ④) | 실패 표의 early_done·prod_gate 방지 장치이고 설계가 지어졌다고 적었다. 재현: 시험 밖 호출자 0. 설계가 거부할 자리로 둔 `item_transition` 입구는 결정 160 이 짓지 않았으므로, 고치는 단위는 Task 를 닫는 자리(pr-monitor 의 `closeTask`, `core/owner/done.ts`, 리드가 직접 부르는 Orca `task-update`) 가운데 어디서 막을지부터 정한다 |
| G24 | `orphan_extra`(고아 부가 정보의 🚨 와 REAPER 거둠)가 없다 | LATER | Orca 에 Run 을 지우는 명령이 없어 고아가 생기기 어렵다. Orca 가 Run 삭제를 갖거나 Task 가 사라진 첫 경우 |
| G25 | 닫힌 결정을 다시 묻는 길(`:r<n>`)이 없다 | LATER | 오너가 닫힌 결정을 다시 열어 달라고 한 첫 경우 |
| G26 | `edge_*` 의 pred 표현식 인덱스가 없다 | DROP | 지금 규모에서 차이가 없고 영향 범위 계산은 메모리에서 접는다. 느린 질의가 관측되면 새로 연다 |
| G27 | `signal` 의 네 종류를 쓰는 곳이 없다 | LATER | 그 종류를 남겨야 하는 판단(reflect 의 측정)이 sangsoe 로 옮겨질 때 |
| G28 | `owner_class` 계약과 표시를 지우는 길이 쓰이지 않은 채 남았다 | LATER | 결정 162 의 조건: 오너 발언 hook 이 seq 를 맥락에 붙이는 단위 |
| G29 | dev 증거 없이 머지된 deploys_after 항목에 🔍 를 달지 않는다 | 닫힘(결정 212 ⑤) | 흐름 3 이 적은 표시이고, 배포 단계가 남은 항목이 이것으로 오너에게 보인다. 재현: `mergedItemMark` 의 시험 밖 호출자 0(G23 과 같은 꼴: 함수는 있고 연결이 없다). 지금의 🔍 (`core/brief/item_status.ts:202`)는 증거가 있는지만 보고 dev 단계는 보지 않으므로 이것을 덮지 않는다 |
| G30 | 깨울지를 event 의 `needs` 칸이 아니라 판정마다 정한다 | LATER | 깨움이 빠지거나 넘친 첫 경우에 `needs` 로 모은다 |
| G31 | retarget 뒤 재리뷰 항목을 blocks 로 만들지 않는다 | 닫힘(결정 215) | 오너가 NOW 로 옮겼고 U78 이 고쳤다 |
| G32 | 재개 뒤 대기를 다시 붙이라는 안내가 없다 | LATER | Orca 가 깨움을 밀어 주므로 지금은 필요가 없다. 재시작 뒤 메시지를 놓친 첫 경우 |
| G33 | 깨움을 모아 보내지 않는다 | LATER | 한 세션에 짧은 시간 안에 깨움이 몰린 첫 경우 |
| G34 | 거부 수집 뷰와 설정 차이 뷰가 없다 | LATER | reflect 가 거부를 묶어 세야 하는 첫 회고 |
| G35 | 머지 대기열 이탈 사유 분류와 merge_group 사전 점검이 없다 | LATER | land 가 머지 예약이라 대기열이 없다(결정 161 R-06). 저장소가 merge queue 를 켜면 |
| G36 | chat-monitor 의 provider 를 꽂을 자리가 없고 `mention_new` 로 깨우지 않는다 | LATER | 공개 트리에는 채팅 provider 를 실을 수 없다. 오너가 채팅 감시를 켜려는 첫 경우에 provider 를 설정으로 받는 자리와 오케스트레이터 알림을 함께 짓는다 |

## 8. 213–227 delta (P4 final)

위 1–7절은 결정 212 까지다. 그 뒤 결정 213–226 이 머지되는 동안 단위들은 두 페이지를 고치지 못했다. 이 절은 그 결정마다 `design.html` · `blog-intro.html` · `design-appendix.html`(과 용어집)에서 바뀐 대목을 찾아 처리를 적는다(U92). 코드의 `file:line` 은 `65e930f`(U91 머지, 결정 225) 기준이다. 결정 214 는 번호가 비어 있다(`decisions.md` 에 214 가 없고 어느 문서도 가리키지 않는다). 새 결정 번호는 쓰지 않았다: 코드와 다른 곳은 모두 글을 고쳐 맞췄다.

처리: `고침` 이 단위에서 글을 코드에 맞췄다 · `이미` 앞 단위가 main 에서 고쳤다(커밋) · `메모` v0.1.4 밖이라 결정 번호와 함께 적어만 두었다.

| 결정 | 바뀐 대목 | 처리 | 코드 |
|---|---|---|---|
| 213 | design.html §오너가 보는 것 2단계 행(목록이고 순서가 아니다, 패널 순서는 시안), 글의 요약 수치·최근 전환 없음 | 고침 | `cli/commands/brief.ts:30` |
| 213 | design.html §현황 보고는 표 네 절: 완료 목록은 `--done` 일 때만 표 | 고침 | `cli/commands/brief.ts:36` |
| 213 ② | 부록 §현황 1단계 행의 접기: 건수 줄이 ✅ 를 세고 맨 아래 줄은 기간 길이만 | 고침 | `core/brief/render.ts:56` |
| 213 · 218 · 220 | 부록 §패널 화면 group.html 행(순서, 🚧 마다 왜 행, 열린 N건, 접힌 범례, 좁은 패널 카드) | 고침 | `core/graph/ready.ts:85` `holdOf` |
| 215 | design.html §의존 관리 `stacked_on` 행: base 변경 뒤 리뷰만 센다, `rereview_needed` | 고침 | `core/land/land.ts:505` |
| 215 | 부록 실패 표 `retarget_approval` · `graph sync` 행 | 이미(`9556001`) | 같은 줄 |
| 215 | 부록 완료 조건 land 항목의 예 "base 변경 뒤 patch-id 가 같으면 판정 승계" | 고침 | `core/land/land.ts:505` |
| 215 · 216 | design.html 흐름 3, blog ④, 부록 land 카드: `rereview_needed` · `base_unrecorded` · `base_merged` | 고침 | `core/land/land.ts:204`, `:214` |
| 216 | 부록 event 표·용어집 §9 의 `pr_reopened`, 부록 상태 대응표 ✅ 행, `graph sync` 행 | 고침(`test/spec-names.test.ts` 의 허용 줄 둘을 뺐다) | `core/detect/pr/round.ts:254` |
| 216 ③ | 항목이 자기 Run 을 적는다(읽기만 바뀜) | 고칠 대목 없음: 페이지가 읽는 Run 을 말하지 않는다 | `core/brief/load.ts` `briefRuns` |
| 217 ② | design.html 흐름 1: 오케스트레이터는 `worktreeId` 를 비워도 된다 | 고침 | `core/start/lineage.ts:47` |
| 217 ① | 타이머가 리드 Run 을 깨운다 | 고칠 대목 없음(페이지에 실린 적이 없고 결정 219 가 버렸다) | — |
| 218 | design.html 크리티컬 패스 정의(PR 마디, 머지 대기 완료 Task), §오너가 보는 것 2단계 행, blog 묶음 상세 | 고침 | `core/graph/critical.ts` `itemGraph` |
| 219 | design.html 감지 층 행(hook 이 재리뷰 항목을 만든다), §의존 관리, 부록 실패 표·`graph sync` 행의 "queue round 가 만든다" | 고침 | `core/session/record.ts:40`, `core/graph/own-run.ts:40`, `core/detect/queue/round.ts:193` |
| 219 | 부록 §패널 화면: 경로 줄은 한 번, 뒤로는 메모리에서 | 고침 | `orca-plugin/panel/view.ts` |
| 219 (8) | 상태 표시줄의 꼴 `✨ SANGSOE \| 🚧 N \| 결정 N \| 🔄 N` 과 `danger` 조건: design.html 화면 표·패널 문단, blog, 용어집 | 고침 | `core/brief/panel.ts:57` `statusBarItem` |
| 219 (6) | 게이트 없는 결정은 버튼 없는 깨진 행 | 고칠 대목 없음: 페이지는 결정 버튼을 일반으로만 말한다 | `orca-plugin/panel/view.ts` |
| 220 | design.html §오너가 보는 것 패널 문단, 부록 §패널 화면, blog 묶음 상세 | 고침 | `orca-plugin/panel/style.ts` |
| 222 | 현황 셋째 절과 탭 "열린 항목": design.html · 부록 | 이미(`8215e9f`) | `core/brief/build.ts:241` |
| 222 | blog 패널 목록과 탭 줄의 "진행 중" 절과 탭 | 고침 | `core/brief/build.ts:241`, `orca-plugin/panel/view.ts:321` |
| 222 ③ | 부록 §좁은 폭: 카드 머리의 제목은 한 줄 말줄임(전체 글은 `title`) | 고침 | `orca-plugin/panel/view.ts:254`, `orca-plugin/panel/style.ts:249` |
| 222 | 흰 배경·1px 테두리 톤, 좁은 패널의 행마다 카드: design.html · 부록 · blog | 고침 | `orca-plugin/panel/style.ts` |
| 221 · 224 | design.html §설치와 호출 경로의 승인 행, blog 설치·제거, 부록 §남는 파일, 용어집 plugin 승인 행: `install --permissions`, "permissions.allow 에 한 줄만" | 고침 | `core/install/permissions.ts:11`, `:215` |
| 221 | README Uninstall 의 `permissions: removed N rules …` 줄 | 고침 | `core/install/install.ts:181`, `core/install/permissions.ts:321` |
| 223 | design.html #mcp 15 → 16, 부록 #mcp(읽기 tool 을 더하면 17), blog 열네 → 열여섯 | 고침(`TOOLS_NOT_IN_DESIGN` 을 비웠다) | `claude-plugin/mcp/tools/item_retire.ts` |
| 223 | design.html ✅ · 🗑️ 행, 크리티컬 패스, 부록 ✅ 대응·흐름 틀 `done_blockers`, 부록 event 표·용어집 §9 §11, blog ⑤ | 고침(허용 줄 셋을 뺐다) | `core/graph/ready.ts:81`, `core/owner/retire.ts:63` |
| 225 | 패널의 위 틈·고정 머리·배지·한 줄 칸 | 메모: v0.1.5 에 실렸다(U96). 세 페이지는 결정 222 의 꼴을 적고 225 를 한 문장으로 가리킨다 | `orca-plugin/panel/style.ts` |
| 226 | design.html 역할 표 land 행·흐름 3, blog ④, 부록 land 카드의 "머지하는 길은 land 하나" | 고침(CI 없는 저장소의 예외를 적었다). v0.1.5: design.html 흐름 3 과 부록 land 카드의 "v0.1.5 에서 다시 본다" 를 "v0.1.5 에도 넣지 않은 LATER" 로 바꿨다(결정 226 ④, U96) | `core/land/land.ts:374` |
| 227 | 결정 171 "쓰는 사람은 PR 을 쓴 세션이 아니다" 와 코드: 세션 검사는 MCP 기록 tool 에만 있고 CLI `sangsoe evidence record` 는 이름 비교만 한다(U92 의 #112 증거가 그 길로 세어졌다). design.html 흐름 3 land 문단, blog §MCP 문단, 부록 land 카드 | 결정 227 을 새로 적고 세 페이지에 0.1.4 의 모습과 v0.1.5 고침을 적었다(U93, 코드는 그대로). 위 문단의 "새 결정 번호는 쓰지 않았다" 와 `65e930f` 기준은 U92 까지의 말이고, 이 행의 줄은 `e20288f` 기준이다(두 커밋에서 그 코드는 같다). **고침(U94, v0.1.5)**: 세 기록 CLI 와 세 기록 tool 이 코어의 한 검사를 부르고, CLI 는 `CLAUDECODE` 가 있을 때 부른 폴더를 세션의 checkout 으로 본다. design.html 흐름 3 land 문단과 blog §MCP 문단을 고친 규칙으로 바꿨다. 부록 land 카드는 이 단위의 범위 밖이라 0.1.4 의 글이 남았다 | `core/land/recorder.ts:25`, `:34`, `cli/commands/evidence-record.ts:28`, `cli/commands/review-record.ts:30`, `cli/commands/stage-record.ts:21` |
| 229 | 결정 225 (11) "넓은 표는 표시만" 과 (7) "사람이 없는 누가 칸은 시간만": 값 없는 '누가' 이름표, 넓은 상태 열의 맨 표시. 세 페이지는 결정 222 의 꼴을 적고 225 를 한 문장으로 가리키므로 고칠 대목이 없다 | 메모: 결정 229 를 새로 적었다(U97, v0.1.5-rc.2). v0.1.5 에 실리며 세 페이지의 225 문장에 229 를 한 문장 더했다(U96) | `orca-plugin/panel/view.ts:254`, `orca-plugin/panel/style.ts:225` |
| 230 | 결정 225 (10) "다른 열은 코어의 폭 예산대로" 와 229 ② (2) "상태 열 104px": 고르지 않은 카드 여백, tint 가장자리에 닿은 첫 칸, "ter…" 누가 배지, 넓은 표의 맨 시간, 상태 없는 묶음 행 이름. 세 페이지는 결정 222 의 꼴을 적고 225 를 한 문장으로 가리키므로 고칠 대목이 없다 | 메모: 결정 230 을 새로 적었다(U98, v0.1.6) | `orca-plugin/panel/view.ts` `STATE_COL_PX` · `tableHtml` · `rowHtml`, `orca-plugin/panel/style.ts` 넓은 `td:first-child` · 좁은 `tr.oneline` |
| 231 | 결정 91③ "`tasks_closed` 는 운반 Task 를 뺀 대기자가 하나 이상": 대기자가 하나도 없는 깨진 결정(결정 219)은 `decision moot` 가 영영 거부했다. 용어집 "원인이 사라진 결정"(게이트가 건 Task 가 모두 닫힘)은 대기자가 없을 때도 그대로 참이라 고칠 대목이 없다. 부록 결정 루프와 design.html 은 moot 의 대기자 수를 적지 않는다 | 고침: 결정 231 을 새로 적었다(U99, v0.1.6). 대기자 없는 결정은 입구로만 닫히고 queue-monitor 는 그대로다 | `core/decision/moot.ts:40`, `core/detect/queue/judge.ts:81` |
| 232 | 결정 91 ① "되돌아갈 곳" 의 "풀림을 추측해 닫는 길은 없다": 세션 대기는 같은 세션의 hook 으로만 풀려 SessionEnd 없이 끝난 세션의 대기가 오너 할 일에 남았다. design.html 의 `owner_todo` 문단(이 줄들은 관측한 사실이나 기록된 답으로 닫힌다)과 용어집의 `waiting_released` 행은 아직 나이 규칙을 적지 않았다 | 메모: 결정 232 를 새로 적고 코드를 고쳤다(U100). 페이지는 이 단위의 범위 밖이라 그대로다 | `core/owner/release.ts:76`, `core/session/locate.ts:69`, `core/detect/orca/judge.ts:302` |
| 234 | 패널의 접힌 리소스 절(PC 부하, sangsoe 가 만든 것, 정리 후보, 확인 뒤 정리)과 REAPER 의 `confirmed` 라운드. 세 페이지에는 아직 없다 | 메모: 결정 234 를 새로 적었다(U103). 세 페이지는 v0.1.6 릴리스 단위가 고친다. 시험 임시 폴더 누수의 원인과 고침도 234 ④ | `core/reaper/resources.ts`, `core/reaper/round.ts`, `orca-plugin/panel/resources.ts`, `test/scratch.ts` |
| 235 | 결정 234 ① "정리 후보는 REAPER 를 `explain` 으로 돌린 결과"(모든 카드), ③ "읽는 중" 한 줄과 `#root` 뒤에 떠 있는 절. 세 페이지에는 리소스 절이 아직 없다 | 메모: 결정 235 를 새로 적었다(U104, v0.1.6-rc.2). 정리 후보는 sangsoe 카드로 좁힌 dry run, 읽기는 세 부분, 절은 맨 아래, 단계 띠. 저장하는 시간대 그래프는 0.1.7 첫 항목(오너 승인). 세 페이지는 v0.1.6 릴리스 단위가 234 와 함께 고친다 | `core/reaper/resources.ts`, `core/reaper/round.ts`, `orca-plugin/panel/resources.ts`, `orca-plugin/panel/style.ts` |
| 236 | 결정 47 "🔍 근거 부족" 과 코드: 브리프는 `entity: task` 인 `evidence` 만 읽었는데 `evidence record` 는 `subject` 에 PR 만 적어 PR 증거가 항목에 닿지 않았다. 용어집의 🔍 행은 뜻이 그대로라 고칠 대목이 없고, 👀 리뷰만 있음 행은 아직 없다 | 메모: 결정 236 을 새로 적고 코드를 고쳤다(U105, v0.1.6). 세 페이지와 용어집은 이 단위의 범위 밖이다 | `core/brief/item_status.ts` `ownsPr` · `evidenceShort` · `reviewOnly`, `core/brief/render.ts:56`, `orca-plugin/panel/view.ts` 꼬리 줄 |
| 243 | 결정 94 (가) "리드는 오케스트레이터의 자식", 결정 113 과 `start_unit` 의 `taskId` 설명 "lead or worker": 코드는 Task 없는 리드를 `lineage_invalid` 로 거부했다(`core/start/start.ts:188`, 고치기 전). 역할 규칙 블록의 "리드의 Dispatch 깊이는 1" 은 Task 있는 리드에 맞아 그대로다 | 메모: 결정 243 을 새로 적고 코드를 고쳤다(U109). `start_unit` 설명과 `lead.md` 는 고쳤고, `start` skill 의 `taskId` 칸("리드면 네 Task id")은 범위 밖이라 그대로다 | `core/start/start.ts:96`, `core/start/start.ts:121`, `core/start/start.ts:230` |
| 248 | 결정 235 의 리소스 절(바닥에 붙고 제 아래 여백 없음, 세 부분)과 240 ④ "sangsoe 가 만든 것 아래의 기록됨·오너 손 표". 세 페이지에는 리소스 절이 아직 없다 | 메모: 결정 248 을 새로 적고 패널을 고쳤다(U116, v0.1.6). 여백(#res .empty·몸체·절·#root 아래), 펼침 구분, 리소스 줄의 읽은 시각, "만든 것" 표를 그리지 않음. 수집은 `sangsoe reap plan` 이 써서 둔다 | `orca-plugin/panel/style.ts`, `orca-plugin/panel/resources.ts`, `scripts/panel-measure.devtools.js` |
| 249 | 결정 89 "앞의 둘은 비어도 제목과 없음", 169 "0 절은 제목 한 줄", 11·25 "현황 맨 위 내가 할 일 띠". 세 페이지는 패널 1단계의 첫 줄을 적지 않는다 | 메모: 결정 249 를 새로 적고 패널을 고쳤다(U117, v0.1.6-rc.4). 첫 줄은 `.sr` h1, 두 0 절은 한 줄. 채팅 첫 줄(`core/brief/render.ts:46`)은 그대로 | `orca-plugin/panel/view.ts` `overview` |
| 253 | 결정 248 ② 의 리소스 절 여백과 그 시험의 "펼친 절 마지막 줄 아래 24px". 세 페이지에는 리소스 절이 아직 없다 | 메모: 결정 253 을 새로 적고 패널을 고쳤다(U123, v0.1.6). 접힘·펼침 위아래, 틀 안 위아래, 꺾쇠 가운데를 2px 안으로 맞추고 측정 스크립트가 잰다 | `orca-plugin/panel/style.ts`, `orca-plugin/panel/view.ts` `CHEV`, `scripts/panel-measure.devtools.js` |
| 258 | 결정 105·112 의 "설치된 폴더의 `contentHash` 가 빌드 커밋·리뷰된 head 트리와 같다". 세 페이지는 승인 조건 (2) 를 폴더 내용 해시로만 적고 무엇을 세는지는 적지 않아 고칠 대목이 없다 | 메모: 결정 258 을 새로 적고 코드를 고쳤다(U128, v0.1.6). 맨 위 `.orca/` 디렉터리는 Orca 가 쓰는 것이라 빼고 inspect 한다. 없는 폴더는 전과 같다 | `core/approve/content-hash.ts` `inspectContentHash`, `core/approve/approve.ts:67`, `core/checks/orca-plugin-content.ts:8` |
| 260 | 결정 68 의 "구축 기간 동안 일은 agent-skills 로 계속한다" 와 전환 갭 D7 (b): 살아 있는 agent-skills 프로그램도 전환 때 옮긴다. design.html §6 전환 4단계 | 고침: 결정 260 을 새로 적고(U130) §6 전환 문장에 그 단계를 넣었다(plugin 을 끄기 전 워커 0 · 옛 리드 끝, 끈 뒤 이어받기). 새 코드는 없다: 자료는 M3 의 가져오기가 맡는다. 프로그램은 리드가 그 Run 을 `run-use` 로 다시 쥐고 agent-skills 가 만든 열린 Task 를 `item_create` 로 다시 만든다. brief 는 `item_created` 가 있는 Task 만 보이고(`core/brief/item_status.ts:177`), Run 은 그 첫 `item_create` 가 `payload.run` 에 실을 때부터 읽는다. 남은 갭: 대문자 owner 의 PR trigger 를 글로 읽는다(코드 항목, 이 단위 밖). blog-intro.html 은 전환 조건 수만 말해 고칠 대목이 없다 | `core/migrate/source.ts:84`, `core/migrate/apply.ts:26`, `core/brief/load.ts:20` `briefRuns`, `core/start/start.ts:255`, `core/graph/ready.ts:229` |

첫 빌드 시험 T1–T6 의 결과는 `test-outcomes.md` 의 행이다. 여섯 모두 통과다. T5 는 두 행이다: "워커는 자기 Run 에 Task 를 만들지 못한다"(U10)와, U93 이 Run 을 쥔 리드 세션에서 돌린 이중 시작 거부 · 세 번 실패 차단이다(`smoke-run.md` 3절 끝). 한 번 시작된 Task 는 실패 세기 앞에서 `already_dispatched` 로 멈추므로 버리는 항목 둘을 썼다. 컷오프 항목은 없는 저장소 선택자로 `worktree create` 를 세 번 실패시켜 `loop_detected{start_failed_3x}` 를 남겼고, 넷째는 `stopped` 였다. 이중 시작 항목은 둘째 호출이 `waiting already_dispatched` 였다. 코드는 결정 114 그대로다: 시작 함수는 `worker-start` 전에 그 Task 의 세는 실패를 세어 세 번이면 `stopped` 로 돌려주고(`core/start/start.ts:316-334`), 이어 Task 상태를 읽어 `dispatched` 이면 `already_dispatched` 로 돌려준다(`:341`).
