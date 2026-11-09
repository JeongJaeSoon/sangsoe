# 저장소 배치 — 층 · 칸 · 토큰

설계(`design.html` 2절 네 칸 배치, 3절 "항목의 상태를 누가 바꾸나")를 디렉터리에 옮긴 표다. 각 폴더의 `README.md` 첫 줄이 같은 값을 기계가 읽는 꼴로 갖고(`<!-- layout: slot=… layer=… tokens=… -->`), `test/layout.test.ts` 가 이 표를 집의 유일한 목록으로 읽어, README 가 없거나 표에 없는 README 가 있거나 표지가 표와 다르면 실패한다.

## 층 → 디렉터리 → 토큰 → 칸

| 층 | 디렉터리 | 토큰 | 칸 | 담는 것 |
|---|---|---|---|---|
| 감지 | `orca-plugin/monitors/` | X | ② Orca plugin | monitor 다섯 · 타이머 멈춤 감지 |
| 감지 | `claude-plugin/hooks/` | X | ③ Claude Code plugin | SessionStart · 막는 hook(게이트) · 기록 hook |
| 실행 | `core/` | X | ④ 공유 코어 | 판단 함수(GRAPH · ready · capacity · land · verify_tier · decision_* · notify · restart_due · recover_plan · 시작 점검) |
| 실행 | `core/store/` | X | ④ 공유 코어 | sqlite event 표와 뷰 |
| 실행 | `core/contract/` | X | ④ 공유 코어 | 계약: event type 파일 · 뷰 시그니처 · `dedupe_key` 규칙 · 전이표 · 시계 |
| 실행 | `core/orca/` | X | ④ 공유 코어 | Orca CLI 어댑터(① 을 부르는 유일한 자리) |
| 실행 | `core/install/` | X | ④ 공유 코어 | install · uninstall · doctor |
| 실행 | `cli/` | X | ④ 공유 코어 | 셸 호출자 전용 `sangsoe` |
| 실행 | `orca-plugin/reaper/` | X | ② Orca plugin | REAPER 라운드 타이머 |
| 실행 | `orca-plugin/panel/` | X | ② Orca plugin | 패널 · 상태 표시줄 B · 버튼 |
| 실행 | `claude-plugin/mcp/` | X | ③ Claude Code plugin | MCP 서버(에이전트의 입구) |
| 판단 | `claude-plugin/skills/` | O | ③ Claude Code plugin | 판단 절차 skill |
| 판단 | `claude-plugin/agents/` | O | ③ Claude Code plugin | 오케스트레이터 · 리드 · 워커 정의 |
| — | `orca-plugin/` | X | ② Orca plugin | 칸 뿌리(매니페스트 `orca-plugin.json` 자리) |
| — | `claude-plugin/` | 섞임 | ③ Claude Code plugin | 칸 뿌리(매니페스트 `.claude-plugin/plugin.json` 자리) |

① Orca CLI 내장 기능에는 디렉터리가 없다: 만들지 않고 `core/orca/` 가 부른다. 저장소 밖에 두는 것: sqlite 파일(`~/.local/share/sangsoe/`), 설정(`~/.config/sangsoe/`), Homebrew formula(별도 탭 저장소). 그 밖의 폴더: `test/`(저장소 전체에 걸친 시험), `docs/`(설계 사본과 이 문서), `.github/workflows/`(CI).

## 경계 규칙

- 토큰 O 폴더(`skills/`·`agents/`)에는 코드 파일이 없다. 토큰 X 폴더에는 프롬프트가 없다.
- 다른 칸은 코어를 `core/index.ts` 로만 import 한다. 두 plugin 사이의 연결점은 코어(sqlite)와 Orca CLI 둘뿐이다(결정 78 다).
- 에이전트는 MCP 만 쓰고, CLI 는 셸 호출자 여섯 행만 쓴다. plugin worker 는 코어를 직접 import 한다(결정 75 나).
- Orca 가 원본인 사실은 sqlite 에 복사하지 않는다(결정 74).
- OS 상주 작업·자체 상주 프로세스·포트는 두지 않는다. 주기 감지는 ② 의 worker 타이머다(결정 75 라).

## 빌드 계약

| 명령 | 하는 일 | CI 작업 |
|---|---|---|
| `npm ci` | 의존 설치(잠금 파일 그대로) | 셋 모두 |
| `npm run typecheck` | `tsc --noEmit`, 시험 포함 | `typecheck` |
| `npm run lint` | `biome lint .` | `lint` |
| `npm test` | `node --test` 로 `*.test.ts` 를 소스 그대로 돌림 | `unit` |
| `npm run build` | `tsc -p tsconfig.build.json` → `dist/` | `unit`(뒤이어 `--version` 확인) |

`dist/cli/main.js` 가 `sangsoe` 의 bin 이다. 버전 문자열은 `package.json` 하나가 원본이고 코어가 그것을 import 한다.

## 설계 후보와 고른 것

후보는 둘을 직접 썼다(한 저장소 안의 경계 하나라 compete 를 돌리지 않았다).

- **A. 칸이 최상위인 한 패키지(고름)**: `core/`·`cli/`·`orca-plugin/`·`claude-plugin/` 이 최상위이고 `package.json`·`tsconfig` 는 하나다. 칸이 첫 눈에 보이고, 브루 트리 하나·빌드 하나라 설치(결정 90)가 가장 단순하다. 경계는 패키지 경계 대신 `test/layout.test.ts` 가 지킨다.
- **B. npm workspaces 네 패키지**: `packages/core` 등에 각자 `package.json`·`exports`. 내부 import 를 빌드가 막는 장점이 있으나, 버전 문자열이 네 곳에 생기고(손으로 맞추는 목록), 프로젝트 참조·배포 단위가 늘며, Claude Code plugin 의 `skills/`·`agents/` 관례 위치와 겹쳐 폴더가 한 단계 깊어진다.
- 버린 꼴: 최상위를 `token-free/`·`token-using/` 으로 가르는 안. 토큰 구분은 가장 잘 보이지만 한 plugin(③)이 두 뿌리로 찢어져 매니페스트가 가리킬 폴더가 둘이 된다.

결정 번호와 이유는 `decisions-impl/`(결정 96–101).

## 코어 계약 (U1)

뒤 유닛(U7–U21)이 대고 짜는 계약이다. 코드는 `core/contract/`, 저장은 `core/store/` 이고 다른 칸은 `core/index.ts` 로 들어온다.

**event.** type 하나가 `core/contract/events/<type>.ts` 파일 하나다(부록 `#signal-flow` 의 이름 전체, 74개). 파일은 `defineEvent(type, 칸 검증기, { dedupe?, dedupeRequired?, dedupeTarget?, sources?, storeOnly?, needs?, version?, upcast? })` 하나를 내보낸다. 쓰기는 `Store.append({ type, source, payload, target?, subject?, entity?, entity_id?, actor?, needs?, severity?, dedupe_key? })` 하나로만 하고, 이 함수가 type 등록·쓰는 쪽(`sources`, 간선은 GRAPH 만)·페이로드(새 쓰기는 정의에 없는 칸도 거부)·`dedupe_key`·전이표(`item_transition`)를 검사한 뒤 `BEGIN IMMEDIATE` 안에서 넣는다. 페이로드는 `after` 칸의 JSON 이다. `before` 칸은 비워 둔다.

- 읽는 쪽은 모르는 칸을 무시하고, 줄의 `schema_v` 가 type 의 `version` 보다 낮으면 `upcast` 로 올려 읽는다(`decodeRow`).
- 페이로드 어디에든(중첩 포함) Orca 가 원본인 사실(`title`·`status`·`spec`·`deps`·`question`·`options`·`message_body`)이 있으면 type 과 상관없이 거부한다. sqlite 에는 Orca id 만 남는다.
- `owner_action` 과 `owner_text_redacted` 는 `storeOnly` 라 `append` 로 못 쓴다. `appendOwnerAction`(원문과 한 트랜잭션)과 `redactOwnerText`(비우기와 한 트랜잭션)만 쓴다.
- `plugin_approved`(U3)·`start_refused`(U22, 결정 94)는 그 유닛이 파일을 더한다.

**`dedupe_key`(split Q13 을 여기서 정한다).** `<접두어>:<대상>[:<조건>…]`. 접두어는 type 이 선언한 것이고 기본은 type 이름이며, 설계가 이미 쓰는 넷만 짧다: `notified`→`notify`, `decision_opened`→`decision`, `item_ready`→`ready`, `edge_added`→`edge`. 접두어 하나는 type 하나의 것이라 다른 type 끼리 부딪히지 않고, 같은 조건을 쓰는 쪽이 둘이어도 `UNIQUE(dedupe_key)` 로 한 줄만 남는다. 키에 기대는 type(`notified`·`decision_opened`·`item_ready`·`edge_added`·`waiting_released`)은 키 없는 쓰기를 거부하고, 대상이 페이로드에서 나오는 type 은 키가 그 대상으로 시작해야 한다(`ready:<task>`·`decision:<decision_key>`·`waiting_released:<ref>`). 두 번째 쓰기는 `{ seq: 첫 줄, inserted: false }` 를 받는다.

**뷰.** 모든 뷰는 `ViewInput = { orca: { tasks, gates }, events, now }` 를 받는 순수 함수이고 결과를 저장하지 않는다(`<뷰>_cache` 표 없음). 뷰가 읽는 Orca 칸은 `ViewTask { id, runId, status, result?, deps, activeDispatchId? }`·`ViewGate { id, taskId, open }` 이다. U2 의 Orca 행 타입은 여기에 대입될 수 있으면 되고, 비로컬 행은 어댑터가 이미 걸렀다(결정 88).

| 뷰 | 시그니처 | 몸체 |
|---|---|---|
| `item_status` | `(input) => ItemStatusRow[]` | U9(상태는 U7) |
| `owner_todo` | `(input) => OwnerTodoRow[]` | U14 |
| `decision` | `(input) => DecisionRow[]` | U1 |
| `ready` | `(input) => ReadyRow[]` | U7 |
| `group_brief` | `(input) => GroupBriefRow[]` | U9 |
| `group_items` | `(input, lead) => ItemStatusRow[]` | U9 |
| `item_timeline` | `(input, task) => TimelineRow[]` | U1 |
| `ask_due` | `(input, { remindAfterMinutes }) => AskDueRow[]` | U8 |
| `restart_due` | `(input, { maxAutoCompactions, firstCallShare, minIntervalMinutes, tokenCeiling }) => RestartDueRow[]` | U10 |

**시계.** 코어가 적는 시각은 모두 주입한 `Clock`(`() => ISO UTC`)에서 오고, 뷰는 `now` 를 입력으로 받는다. `core/contract`·`core/store` 에서 `Date.now()`·`new Date()` 를 부르는 곳은 기본 시계 하나뿐이다(시험이 확인).

**전이표.** 상태 일곱(`planned`·`ready`·`in_progress`·`blocked`·`on_hold`·`done`·`cancelled`)의 순서쌍 49 중 허용 19·거부 30(`core/contract/transitions.ts`).

**시작 점검.** `checkSqliteVersion`(3.51.3 이상, 3.50.7+·3.44.6+)과 `checkLocalFs`(로컬로 아는 파일시스템만 통과, DB 파일의 링크는 따라간다)는 `Store.open` 이 먼저 부르고 `doctor` 도 같은 함수를 쓴다. Node 하한이 24.15 인 이유는 결정 102.

**고른 꼴.** 후보 둘을 직접 썼다(한 시스템 안의 경계 하나라 compete 를 돌리지 않았다). (가, 고름) type 마다 파일 하나와 등록표 하나, 쓰기 입구 하나가 검증한다. (나) 모든 type 을 한 파일의 판별 합집합으로 둔다: 타입 추론은 쉽지만 여섯 유닛이 같은 파일을 고쳐 split §1.3 의 "파일 하나당 항목 하나"를 어긴다. 버린 꼴: sqlite `CREATE VIEW` 로 뷰를 두는 안. Orca 행을 읽을 때 합쳐야 해서 SQL 뷰로는 입력을 받을 수 없다.
