# 저장소 배치 — 층 · 칸 · 토큰

설계(`design.html` 2절 네 칸 배치, 3절 "항목의 상태를 누가 바꾸나")를 디렉터리에 옮긴 표다. 각 폴더의 `README.md` 첫 줄이 같은 값을 기계가 읽는 꼴로 갖고(`<!-- layout: slot=… layer=… tokens=… -->`), `test/layout.test.ts` 가 이 표를 집의 유일한 목록으로 읽어, README 가 없거나 표에 없는 README 가 있거나 표지가 표와 다르면 실패한다.

## 층 → 디렉터리 → 토큰 → 칸

| 층 | 디렉터리 | 토큰 | 칸 | 담는 것 |
|---|---|---|---|---|
| 감지 | `orca-plugin/monitors/` | X | ② Orca plugin | monitor 다섯 · 타이머 멈춤 감지 |
| 감지 | `claude-plugin/hooks/` | X | ③ Claude Code plugin | SessionStart · 막는 hook(게이트) · 기록 hook |
| 감지 | `core/detect/` | X | ④ 공유 코어 | monitor 판정 다섯(orca · resource · chat · pr · queue, 앞 셋은 이 폴더, 뒤 둘은 아래 두 줄)과 알림 길 하나(`notice.ts`): worker 타이머와 `sangsoe monitor run` 이 같이 부른다 |
| 감지 | `core/detect/pr/` | X | ④ 공유 코어 | pr-monitor 판정: PR 사실 → event, 머지 확인 뒤 PR 항목 Task `completed`(감지기가 항목을 닫는 유일한 예외) · main CI · 등급 라벨 · 참조 |
| 감지 | `core/detect/queue/` | X | ④ 공유 코어 | queue-monitor 라운드(판정 + 규칙을 가진 코어 함수 호출)와 타이머 멈춤 판정. 항목을 닫지 않는다 |
| 실행 | `core/` | X | ④ 공유 코어 | 판단 함수(GRAPH · ready · capacity · land · verify_tier · decision_* · notify · restart_due · recover_plan · 시작 점검) |
| 실행 | `core/store/` | X | ④ 공유 코어 | sqlite event 표와 뷰 |
| 실행 | `core/contract/` | X | ④ 공유 코어 | 계약: event type 파일 · 뷰 시그니처 · `dedupe_key` 규칙 · 전이표 · 시계 |
| 실행 | `core/orca/` | X | ④ 공유 코어 | Orca CLI 어댑터(① 을 부르는 유일한 자리) |
| 실행 | `core/gh/` | X | ④ 공유 코어 | GitHub 클라이언트(한도·ETag 캐시 인터페이스, 결정 81 의 조건 넷 읽기) |
| 실행 | `core/checks/` | X | ④ 공유 코어 | 시작 점검과 `doctor` 의 점검 함수(점검 하나 = 파일 하나) |
| 실행 | `core/install/` | X | ④ 공유 코어 | install · uninstall · doctor |
| 실행 | `core/approve/` | X | ④ 공유 코어 | `sangsoe plugin approve` 의 세 조건 검사와 `orca plugin enable` 을 부르는 유일한 자리 |
| 실행 | `core/land/` | X | ④ 공유 코어 | land 판정 함수(`sangsoe land`·MCP `land`, 머지하는 유일한 길) · `merge_confirm` · `gh pr merge --auto` 를 부르는 유일한 자리 |
| 실행 | `core/verify/` | X | ④ 공유 코어 | `verify_tier` 순수 함수(V0~V3) · head 별 증거 점검 · `deploys_after` 항목의 dev 증거 판정 |
| 실행 | `core/gates/` | X | ④ 공유 코어 | 막는 hook 의 판정 함수: 게이트 4종 · 시작 가드 · 모양 검사 · 합치기 · `gate_denied` 기록 |
| 실행 | `core/start/` | X | ④ 공유 코어 | 세션을 여는 유일한 시작 함수(Task + Dispatch + new-child lineage)와 lineage·깊이 검사, `unit_lineage_complete` 읽기(결정 94) |
| 실행 | `core/capacity/` | X | ④ 공유 코어 | 부하 판정 함수 하나(압박 게이트·resource-monitor·REAPER·`capacity` 공용, 결정 83) |
| 실행 | `core/recover/` | X | ④ 공유 코어 | `sangsoe recover` 의 읽기 전용 표(결정 80 N4) |
| 실행 | `core/decision/` | X | ④ 공유 코어 | 결정 루프: `decision_open`(재질문 게이트) · `decision_answer` · `moot` 닫기 · 결정 84③ 읽기 |
| 실행 | `core/notify/` | X | ④ 공유 코어 | `notify`: Orca 메시지 한 번 + `notified`, 받는 순서 · `term_` 거부 |
| 실행 | `core/owner/` | X | ④ 공유 코어 | 오너 큐: `owner_todo` 몸체 · `verify` probe 다섯 · 입력 연결 규칙 · 표지 · `waiting_released` · 완료 버튼(결정 89·91) |
| 감지 | `core/session/` | X | ④ 공유 코어 | 기록 hook 일곱의 판정(`session_started` · `owner_action` · `waiting_human`/`waiting_released` · `turn_ended` · `compacted` · `!` 입력), SessionStart 주입, `restart_due`, `handoff_save` · `review_ask_record` |
| 실행 | `core/graph/` | X | ④ 공유 코어 | GRAPH: 간선의 유일한 입구 · 순환 거부 · `ready` · `why` · 크리티컬 패스 · 영향 범위 · 흐름 틀 · `graph sync` |
| 실행 | `core/brief/` | X | ④ 공유 코어 | 현황 세 단계: `buildBrief`·`renderMarkdown` 한 쌍과 `item_status`·`group_*` 뷰 몸체(`owner_todo` 는 `core/owner/` 에 넘긴다)(결정 89, 구현 결정 128·129) |
| 실행 | `core/migrate/` | X | ④ 공유 코어 | `sangsoe migrate`: agent-skills 의 열린 항목·결정을 읽기 전용으로 한 번 가져오기(D-13, 구현 결정 140) |
| 실행 | `cli/` | X | ④ 공유 코어 | 셸 호출자 전용 `sangsoe` |
| 실행 | `orca-plugin/reaper/` | X | ② Orca plugin | REAPER 라운드 타이머 |
| 실행 | `orca-plugin/panel/` | X | ② Orca plugin | 패널 · 상태 표시줄 B · 버튼 |
| 실행 | `claude-plugin/mcp/` | X | ③ Claude Code plugin | MCP 서버(에이전트의 입구) |
| 실행 | `claude-plugin/mcp/tools/` | X | ③ Claude Code plugin | MCP tool 하나 = 파일 하나 |
| 실행 | `claude-plugin/mcp/resources/` | X | ③ Claude Code plugin | MCP resource 하나 = 파일 하나(읽기, 현황 `brief`) |
| 판단 | `claude-plugin/skills/` | O | ③ Claude Code plugin | 판단 절차 skill |
| 판단 | `claude-plugin/skills/general/` | O | ③ Claude Code plugin | 일반 작업 skill(결정 95) |
| 판단 | `claude-plugin/agents/` | O | ③ Claude Code plugin | 오케스트레이터 · 리드 · 워커 정의 |
| — | `orca-plugin/` | X | ② Orca plugin | 칸 뿌리(매니페스트 `orca-plugin.json` 자리) |
| — | `claude-plugin/` | 섞임 | ③ Claude Code plugin | 칸 뿌리(매니페스트 `.claude-plugin/plugin.json` 자리) |

① Orca CLI 내장 기능에는 디렉터리가 없다: 만들지 않고 `core/orca/` 가 부른다. 저장소 밖에 두는 것: sqlite 파일(`~/.local/share/sangsoe/`), 설정(`~/.config/sangsoe/`), Homebrew formula(별도 탭 저장소). 그 밖의 폴더: `test/`(저장소 전체에 걸친 시험), `docs/`(설계 사본과 이 문서), `.github/workflows/`(CI 와 릴리스), `.claude-plugin/`(Claude Code 마켓플레이스 파일, 아래 "설치와 릴리스").

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

## 어댑터 등록 계약 (MCP tool · CLI 명령)

같은 코어 함수를 두 입구가 감싼다. 입구마다 항목 하나가 파일 하나이고, 입구는 시작할 때 자기 폴더를 읽어 모은다. 그래서 단위는 파일 하나를 더하고 공유 목록을 고치지 않는다(결정 110).

| 입구 | 파일 | default export | 호출자 |
|---|---|---|---|
| MCP 서버 `claude-plugin/mcp/server.ts`(stdio) | `claude-plugin/mcp/tools/<name>.ts`, `resources/<name>.ts` | `ToolDef`·`ResourceDef`(`claude-plugin/mcp/contract.ts`) | 에이전트 전부 |
| CLI 라우터 `cli/main.ts` | `cli/commands/<name>.ts`(두 낱말 이름은 `-` 로: `plugin approve` → `plugin-approve.ts`) | `CommandDef`(`cli/contract.ts`) | 셸 호출자 여섯 행 |

- 결과는 `Outcome` 하나: `{ ok: true, value }` 또는 `{ ok: false, refusal: { code, reason, fix } }`. MCP 는 `isError` 와 JSON 본문으로, CLI 는 종료 코드(0 성공 · 1 거부 · 2 사용법 오류)와 `--json` 출력으로 낸다. 사람에게 보고만 하는 CLI 명령(`install`·`uninstall`·`doctor`·`plugin approve`)은 `Report`(`{ code, lines }`)를 돌려준다. 명령은 호스트(`Host`)를 인자로 받아 시험이 가짜를 넣는다.
- 모르는 명령·인자·tool·입력 칸은 코어 함수에 닿기 전에 입구가 거부하고 맞는 형태(사용법 줄, 입력 칸 목록)를 보인다. `--help` 도 아무것도 부르지 않는다.
- `test/boundaries/both-entrances.ts` 의 `expectSameViaBothEntrances` 가 한 호출을 두 입구로 보내 `Outcome` 이 같은지 본다.

## 코어 계약 (U1)

뒤 유닛(U7–U21)이 대고 짜는 계약이다. 코드는 `core/contract/`, 저장은 `core/store/` 이고 다른 칸은 `core/index.ts` 로 들어온다.

**event.** type 하나가 `core/contract/events/<type>.ts` 파일 하나다(부록 `#signal-flow` 의 이름 전체 74개와 결정 104·111 의 둘). 파일은 `defineEvent(type, 칸 검증기, { dedupe?, dedupeRequired?, dedupeBound?, dedupeClosed?, sources?, storeOnly?, needs?, version?, upcast? })` 하나를 내보낸다. 쓰기는 `Store.append({ type, source, payload, target?, subject?, entity?, entity_id?, actor?, needs?, severity?, dedupe_key? })` 하나로만 하고, 이 함수가 type 등록·쓰는 쪽(`sources`, 간선은 GRAPH 만)·페이로드(새 쓰기는 정의에 없는 칸도 거부)·`dedupe_key`·전이표(`item_transition`)를 검사한 뒤 `BEGIN IMMEDIATE` 안에서 넣는다. 페이로드는 `after` 칸의 JSON 이다. `before` 칸은 비워 둔다.

- 읽는 쪽은 모르는 칸을 무시하고, 줄의 `schema_v` 가 type 의 `version` 보다 낮으면 `upcast` 로 올려 읽는다(`decodeRow`).
- 페이로드 어디에든(중첩 포함) Orca 가 원본인 사실(`title`·`status`·`spec`·`deps`·`question`·`options`·`message_body`)이 있으면 type 과 상관없이 거부한다. sqlite 에는 Orca id 만 남는다.
- `owner_action` 과 `owner_text_redacted` 는 `storeOnly` 라 `append` 의 인자 타입에서 빠지고 실행 중에도 거부된다. `appendOwnerAction`(원문과 한 트랜잭션, 원문은 비지 않은 문자열)과 `redactOwnerText`(비우기와 한 트랜잭션)만 쓴다.
- Orca id 는 불투명한 값이라 sangsoe 는 형식을 따지지 않는다. 자원 줄(`resource`·`reap_*`·`resource_*`)은 `kind` 를 반드시 적고, `kind: worktree` 의 `ref` 는 경로가 아니라 Orca id 다(공백·`/`·`\` 거부). `item_extra_set.verify` 는 kind 별 합 타입 `VerifySpec` 이라 kind 마다 필요한 칸이 컴파일·실행 양쪽에서 걸린다(`orca_field` 는 target·field·value 등). `evidence{kind: probe:*}` 는 `observed` 가 있어야 한다.
- `plugin_approved`(결정 104)와 `review_verdict`(결정 111)도 이 폴더에 있다. `start_refused` 는 새 type 이 아니라 `signal` 의 kind 다(결정 94 (바), U10).

**`dedupe_key`(split Q13 을 여기서 정한다).** `<접두어>:<대상>[:<조건>…]`. 접두어는 type 이 선언한 것이고 기본은 type 이름이며, 설계가 이미 쓰는 넷만 짧다: `notified`→`notify`, `decision_opened`→`decision`, `item_ready`→`ready`, `edge_added`→`edge`. 접두어 하나는 type 하나의 것이라 다른 type 끼리 부딪히지 않고, 같은 조건을 쓰는 쪽이 둘이어도 `UNIQUE(dedupe_key)` 로 한 줄만 남는다. 키에 기대는 type(`notified`·`decision_opened`·`item_ready`·`edge_added`·`waiting_released`)은 키 없는 쓰기를 거부하고, 각 마디는 `dedupeSegment`(URI 인코딩)로 적어서 `:`·공백이 든 Orca id 도 마디를 가르지 않고, 다른 대상끼리 같은 키가 되지 않는다(`dedupeKey(def, target, ...조건)` 이 해 준다). 앞 마디가 줄에서 나오는 type 은 `dedupeBound` 가 그 마디를 내고 키는 인코딩한 그 마디로 시작해야 한다(`ready:<task>`·`decision:<decision_key>`·`notify:<target 칸>`). `dedupeClosed` 인 type 은 그 뒤에 조건을 붙이지 못한다(`edge:<pred>:<succ>:<kind>`·`waiting_released:<ref>`·`owner_text_redacted:<seq>`). 그래서 한 조건의 철자는 하나뿐이고, 인코딩하지 않은 철자는 거부된다. 두 번째 쓰기는 `{ seq: 첫 줄, inserted: false }` 를 받는다.

**뷰.** 모든 뷰는 `ViewInput = { orca: { tasks, gates }, events, now }` 를 받는 순수 함수이고 결과를 저장하지 않는다(`<뷰>_cache` 표 없음). 뷰가 읽는 Orca 칸은 `ViewTask { id, runId, status, result?, deps, activeDispatchId? }`·`ViewGate { id, taskId, open }` 이다. U2 의 `TaskRow`·`GateRow`(`core/contract/orca.ts`)는 이 모양이 아니다(`runId`·`deps` 가 없고 게이트는 `status` 문자열). 그래서 어댑터 결과를 `OrcaSnapshot` 으로 옮기는 조립 함수가 따로 필요하고, 뷰를 처음 돌리는 유닛이 그것을 만든다. 비로컬 행은 어댑터가 이미 걸렀다(결정 88).

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

## Orca·GitHub 어댑터와 점검 (U2)

코어가 Orca 와 GitHub 을 부르는 길은 둘뿐이다: `core/orca/` 와 `core/gh/`. 뒤 단위는 `core/index.ts` 에서 아래 계약만 쓴다.

```ts
// core/contract/orca.ts
type Exec = (file: string, args: readonly string[]) => Promise<ExecResult>;
type OrcaResult<T> = { ok: true; value: T; requestId?: string } | { ok: false; error: OrcaError; requestId?: string };
type LocalRows<T> = { rows: T[]; nonLocal: { rows: number; hostIds: string[] }; omittedHostIds: string[]; truncated: boolean };
interface OrcaAdapter { taskCreate(…); taskList(…); …; worktreeList(…): Promise<OrcaResult<LocalRows<WorktreeRow>>>; … }
createOrcaAdapter(exec: Exec): OrcaAdapter;
recoverWrite(orca, requestId, replay): Promise<OrcaResult<T>>;

// core/gh
createGhClient({ exec, cache: GhCache, now }): GhClient;   // get(path, { conditional? }) → ok | not_modified | rate_limited | error
readMergeConditions(gh, { repo, base, pr, protectedPaths }): MergeConditions;

// core/checks
type Check = { id: string; run(ctx: CheckContext): Promise<CheckResult> };
type CheckResult = { id: string; status: "ok" | "notice" | "warn" | "fail"; summary: string; fix?: string };
runChecks(START_CHECKS, ctx) → startReport(results) | doctorReport(results)
DOCTOR_CHECKS = [...START_CHECKS, orcaPluginContent]   // sangsoe doctor·install 이 돌린다
```

- **내용 해시 점검(`orca-plugin-content`).** 설치된 `orca-plugin/` 의 `contentHash` 를 그 폴더의 빌드 커밋 트리와 그 커밋을 머지한 PR 의 리뷰된 head 트리(`sangsoe plugin approve` 가 비교하는 바이트)와 다시 비교한다. 다르면 `fail` + `sangsoe plugin approve`, 잴 수 없으면 `warn`. 빌드 트리는 내려받아야 하므로 `CheckContext.pluginBuild` 포트로 들어오고, 시작 점검은 그 포트를 비워 `DOCTOR_CHECKS` 에만 든다(결정 112).

- **명령 표 하나.** `core/orca/commands.ts` 의 `ORCA_COMMANDS` 가 래퍼의 argv 와 시작 점검 `orca-commands` 의 대조 대상을 같이 정한다. 설계 2절 첫째 칸 표의 명령마다 한 행이 있고, 표에 없는 옵션은 래퍼가 넘기지 못한다.
- **호스트.** 호스트를 가진 행(`worktree list`·`worktree ps`·`worker-list`)은 로컬 행만 어댑터 밖으로 나가고 나머지는 수만 남는다(결정 88).
- **요청 id.** 첫 호출에는 id 를 만들지 않는다. Orca 가 알려 준 id 를 결과에 싣고, 응답을 잃으면 `recoverWrite` 가 `request-show` 뒤에만 같은 id 로 다시 보낸다(결정 60, 결정 103).
- **가짜 Orca.** `test/fake-orca/` 의 `createFakeOrca({ scenario, replies })` 가 `Exec` 을 준다. 이 Mac 에서 읽기 전용으로 녹화한 JSON 을 일반 이름으로 바꿔 `scenarios/local/` 에 두었고, 다른 시나리오 폴더는 바뀌는 파일만 갖는다. `ORCA_COMMANDS` 밖의 명령은 거부한다.
- **고르지 않은 꼴.** 명령 이름으로 부르는 범용 함수 하나(`call("worktree list", …)`): 겉면은 작지만 부르는 쪽이 argv 와 결과 모양을 알아야 한다. 메서드마다 타입을 가진 인터페이스를 고르고, 안에서는 같은 표 하나로 argv 를 만든다.

## Orca plugin 골격 (U3)

U15(monitor)·U18(REAPER)·U19(패널)가 대고 짜는 계약이다. 시험 결과는 `test-outcomes.md`.

**plugin 뿌리와 매니페스트.** `orca-plugin/` 가 plugin 폴더이고 `orca-plugin.json` 은 `trusted-worker`, `main: main.ts`, 능력 `workspace:read`·`agent:read`, 이벤트 4종, 패널 하나, 명령 `sangsoe.open`, 상태 표시줄 항목 `summary` 다. `publisher` 는 두지 않는다(개발 폴더 키는 `local.sangsoe`). 능력·명령·이벤트를 더하면 승인 지문이 바뀌어 다시 승인해야 하므로 리드에 알린다. 내용만 바꾸면 개발 폴더는 다시 묻지 않는다(결정 105). 시험 파일은 지문에 들지 않게 `test/` 에 둔다.

**worker 진입점.** `main.ts` 의 `export default function activate(orca)` 하나. 하는 일: 이벤트 4종 구독, 타이머 라운드 시작, 패널 요청 처리기 등록(`orca.panels.handle(name, fn)`), 명령 등록. `main` 과 상태 표시줄 항목이 함께 있어 worker 는 plugin 이 켜져 있는 동안 계속 돈다.

**타이머 라운드(monitor 의 모양).** `timer.ts` 의 `Round = { id, intervalMs, run(at) }` 하나가 monitor 하나다. `startRounds(rounds, clock)` 가 Node 타이머로 돌리고, 앞 라운드가 안 끝났으면 다음 틱을 건너뛰며(겹치지 않음), 라운드마다 실행 수·오류·실제 간격(`gapsMs`)을 낸다. 시험은 `Clock` 을 주입한다. U15 는 `orca-plugin/monitors/<m>.ts` 하나에 `Round` 하나를 export 하고 `main.ts` 의 목록에 한 줄을 더한다.

**패널과 상태 표시줄.** 패널은 `html` 패널(`panel/*.ts` 진입, Orca 가 페이지를 감싼다)이고 `orca.plugin.request(name)` 로 worker 처리기를 부른다. 패널에서 코어를 직접 부르지 않는다. 상태 표시줄은 worker 가 `host.call("statusBar.update", {id: "summary", text, tone})` 로만 바꾼다. 클릭은 명령 `sangsoe.open` 을 돌리고, 호스트 API 에 "자기 패널 열기"가 없어 명령이 `orca plugin open <key> --panel <id>` 를 부른다.

**승인 흐름.** `sangsoe plugin approve`(④ `core/approve/`). 신뢰 기준(저장소 `JeongJaeSoon/sangsoe`, 키 `local.sangsoe`)은 코어 상수이고 승인할 폴더에서 읽지 않는다. 커밋은 40자 SHA 만 받는다. 순서: 읽기 전용 검사 먼저 — (1) 빌드 커밋이 main 에 있고 그것을 실은, main 으로 머지된 PR 하나의 머지된 head 에 대한 리뷰 증거가 작성자 아닌 리뷰어의 Act-on 0 (2) 폴더 `contentHash` = main 커밋 트리 = 리뷰된 head 트리(결정 105) → 그다음에야 `orca plugin dev reload <폴더> --json` 으로 Orca 가 원하는 키·지문을 읽고(켜지 않는다) (3) 키가 `local.sangsoe` 이고 `contentIdentity` 가 그 폴더 → 켜기 직전에 내용 해시를 다시 재서 같을 때만 `orca plugin enable <key> --approve <지문>` → `plugin_approved`(결정 104). 이미 승인된 폴더도 같은 검사를 지나야 통과로 보인다. `--dry-run` 은 명령만 보인다. plugin 코드는 폴더 밖을 import 하지 않는다(승인과 내용 해시가 폴더만 덮는다, `test/orca-plugin.test.ts`). 리뷰 증거는 store 의 `review_verdict` 줄로만 읽고(그 head 에 Act-on 이 남은 판정이 하나라도 있으면 실패, store 를 못 열면 증거 없음), `plugin_approved` 는 store 에 쓴다. `review_verdict` 를 쓰는 곳은 `sangsoe review record` 하나다(작성자는 GitHub 에서 읽고 리뷰어와 같으면 거부, 결정 111).

## 설치와 릴리스

최종 릴리스가 그대로 쓰는 계약이다(결정 90·108·109).

- **릴리스 자산.** 태그 `v<package.json 버전>` 을 push 하면 `.github/workflows/release.yml` 이 검사·빌드 뒤 `npm pack` 으로 `sangsoe-<버전>.tar.gz`(+`.sha256`)를 만들어 GitHub 릴리스에 올린다. 압축을 풀면 `package/` 아래 `package.json`·`dist/`·`.claude-plugin/marketplace.json`·`claude-plugin/`·`orca-plugin/`·`README.md` 가 있다. 담는 목록은 `package.json` 의 `files` 하나다. 버전에 `-` 가 있으면 사전 릴리스다.
- **formula.** 탭 저장소의 `Formula/sangsoe.rb`: `url`(릴리스 자산)·`sha256`·`depends_on "node"`·`libexec.install Dir["*"], ".claude-plugin"`(`Dir["*"]` 는 점 폴더를 뺀다)·`bin/sangsoe` sh 래퍼(`SANGSOE_ROOT=<opt_libexec>` 를 두고 브루의 `node` 로 `dist/cli/main.js` 실행)·`test do`(`--version` 과 `doctor --offline`). `post_install` 은 없다.
- **`sangsoe install`(멱등).** 상태를 읽고 고른다: 마켓플레이스 `sangsoe` 가 없으면 `claude plugin marketplace add <트리> --scope user`, 있으면 `update`, 다른 경로를 가리키면 `remove` 뒤 `add` → plugin `sangsoe@sangsoe` 가 없으면 `claude plugin install … --scope user`, 있으면 `update` → `orca-plugin/orca-plugin.json` 이 트리에 있으면 `orca plugin dev load <트리>/orca-plugin --json`(종료 코드 3 은 승인 대기, 지문을 보여 주고 `sangsoe plugin approve` 를 안내), 없으면 한 줄로 건너뛴다 → `doctor`. `<트리>` 는 `$(brew --prefix)/opt/sangsoe/libexec` 이라 `brew upgrade` 뒤에도 같다.
- **`sangsoe uninstall`.** 있는 것만 지운다: `claude plugin uninstall sangsoe@sangsoe --scope user --keep-data` · `claude plugin marketplace remove sangsoe --scope user` · `orca plugin list --json` 에 sangsoe 개발 plugin 이 있으면 `orca plugin dev unload <키>`. 목록을 읽지 못하면 없는 것으로 치지 않고 종료 코드 1 이다. sqlite·설정은 남긴다.
- **`sangsoe doctor [--offline]`.** 트리 · Claude Code 실행과 마켓플레이스 · Orca plugin 로드 상태 다음에 `DOCTOR_CHECKS`(시작 점검 + 내용 해시)를 같은 줄 모양으로 잇는다. 항목마다 `ok` · `FAIL … — fix: <명령>` · `warn`/`notice … — fix: <명령>` · `not yet`(아직 없는 부분). `FAIL` 이 하나라도 있으면 종료 코드 1, `warn`·`notice` 는 0. Claude Code plugin 행은 시작 점검 `claude-plugin-version` 하나뿐이다. `--offline` 은 트리(매니페스트 버전 일치·Node 하한)만 본다. `sangsoe install` 은 끝에 같은 doctor 를 돌려 그 종료 코드를 낸다.

고른 꼴과 버린 꼴: (A, 고름) `tsc` 출력 + `npm pack` + 래퍼가 트리 경로를 환경 변수로 건넴. 선언 하나(`files`)가 자산을 정하고 시험이 그것을 읽는다. (B) 진입점별 esbuild 번들 + `packaging/` 의 묶음 스크립트 + 실행 경로의 Cellar→opt 변환. 번들은 런타임 의존이 없는 지금 얻는 것이 없고, 파일을 실행 중에 찾는 라우터·MCP 수집기를 깨며, 경로 변환은 브루 내부 배치에 기대므로 버렸다.
