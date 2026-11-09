# 120. 판단 층은 agent 정의 셋과 skill 열하나이고, 역할·완료·깊이 규칙은 한 블록을 글자 그대로 나눠 쓴다

`claude-plugin/agents/` 에 `orchestrator`·`lead`·`worker`, `claude-plugin/skills/` 바로 아래에 `intake`·`write-brief`·`brief`·`todo`·`deliver-ticket`·`orchestrate`·`start`·`end-session`·`reflect`·`reap-resources`·`setup` 을 둔다. 이 열넷이 판단 층 전부이고 토큰을 쓰는 것은 이들뿐이다. 코드는 없다(경계 규칙).

## 정한 것

- **규칙 블록 하나.** 역할·완료·깊이 규칙은 `<!-- sangsoe:rules:begin -->` 과 `end` 사이 한 블록이고, 세 agent 정의와 `start`·`orchestrate` skill 에 글자 그대로 같다. `test/judgment-layer.test.ts` 가 다섯 벌이 같은지, 그 블록이 코어 시작 함수가 거부 사유로 쓰는 문장(`워커는 세션을 시작하지 않는다`·`리드는 리드를 시작하지 않는다`·`오케스트레이터의 자식은 1`·`start_refused`)을 담는지, 그리고 `core/start/start.ts` 가 같은 문장을 쓰는지를 문자열로 대조한다. 코어 쪽 문장을 바꾸면 이 시험이 판단 층을 같이 고치게 한다(오너 요구 d125 (4)).
- **agent 본문은 MCP 만.** agent 본문에는 `sangsoe` 하위 명령도 셸 주입 줄도 없다(시험). Orca 기능(Run·Task·메시지·게이트)은 Orca 명령을 그대로 쓴다.
- **셸 주입은 오너 전용 skill 둘만.** `brief`·`todo` 는 `disable-model-invocation` 이고 본문의 `` !`sangsoe brief` ``·`` !`sangsoe todo` `` 줄이 부른 순간의 출력을 싣는다(결정 75 나의 "오너 전용 skill 의 상태 주입 줄"). 모델이 부르는 skill 에는 주입 줄이 없다(시험).
- **`dispatch-card` 는 `start` 가 된다.** 시작 절차는 `start_unit` 하나를 부르는 법과 결과(`started`·`waiting`·`stopped`·거부)를 읽는 법만 남았다.
- **`skills-config`·`setup-pc` 는 `setup` 하나가 된다.** 사람이 돌릴 `sangsoe install`·`doctor`·`plugin approve`·`uninstall` 을 가리키기만 하고 설정 파일을 쓰지 않는다.

## 가정한 tool·resource 이름

`claude-plugin/mcp/tools/README.md` 의 표와 열린 PR(시작 #13, 결정 #14)에 없는 것은 아래 이름으로 썼다. 그 tool 을 만드는 단위가 이름을 바꾸면 이 skill 들을 같이 고친다.

| 이름 | 쓰는 곳 | 하는 일 | 근거 |
|---|---|---|---|
| `owner_class`(tool) | `intake` | `owner_action` 에 분류 한 줄 | 부록 `#intake-table`. 표에 쓰는 tool 이 없다 |
| `review_record`(tool) | `orchestrate`·`lead` | 리뷰 판정 기록(작성자 거부) | 결정 111 이 MCP 입구를 뒤 단위로 미뤘다 |
| `resource_record`(tool) | `end-session`·`reap-resources` | 당사자가 띄운 자원의 기록 | 부록 `#role-cards` REAPER: 치우는 근거는 만든 쪽의 기록뿐 |
| `ready`·`brief`·`item_timeline`(resource) | `start`·`orchestrate`·`reflect`·`orchestrator` | U1 의 뷰를 resource 로 | 부록 `#mcp`: 뷰가 곧 resource |
| `notify`(tool) | `intake` | 진행 중인 일의 세션 깨우기 | 표에 있으나 단위가 `미정` |
| `item_trigger`(tool) | `intake` | 날짜·글 조건 항목에 trigger 달기 | #13 의 `item_create` 에 trigger 칸이 없다 |
| `owner_action` seq(맥락) | `intake` | 오너 발언 hook 이 맥락에 붙이는 seq | `owner_class`·`decision_answer` 가 seq 를 받는데 아직 내주는 곳이 없다 |

항목을 만드는 tool 은 #13 의 `item_create` 다(`runId`·`spec`·`who`·`doneWhen` 필수). CLI 의 `sangsoe item new` 와 이름이 다르다.

## 버린 것

- 옛 `orchestrate` 의 inbox 대기·카드 감시·대시보드 갱신: 깨움은 Orca 메시지이고 현황은 resource 다.
- 옛 `end-session` 의 터미널 닫기·카드 아카이브: 터미널은 Orca 의 자동 해제, worktree 는 REAPER 다.
- 옛 `reap-resources` 의 목록·판정·정리 절차: REAPER 라운드(토큰 X)의 일이다. skill 에는 당사자의 몫과 보고를 받았을 때의 판단만 남았다.
- 옛 `reflect` 의 교훈 원장 파일: 재료는 event 와 PR 리뷰 원문이다.
- 노트·티켓 저장소, 채팅 게시: sangsoe 범위 밖이다.
