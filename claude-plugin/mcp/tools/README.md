<!-- layout: slot=③ layer=실행 tokens=free -->
# claude-plugin/mcp/tools — MCP tool 하나 = 파일 하나 · 실행 · 토큰 X

**에이전트는 sangsoe 를 MCP 로만 부른다.** 오케스트레이터·리드·워커는 이 폴더의 tool 을 쓰고, Bash 로 `sangsoe` CLI 를 부르지 않는다. CLI 는 MCP 를 쓸 수 없는 셸 호출자(시작 hook · 막는 hook · 기록 hook · 오너 전용 skill 의 상태 주입 줄 · 사람 터미널·시험·CI · `sangsoe plugin approve`)의 입구다(결정 75 나).

## tool 파일 하나를 더하는 법

`tools/<name>.ts` 하나를 만들고 `ToolDef`(`../contract.ts`)를 default export 한다. 서버(`../server.ts`)는 시작할 때 이 폴더를 읽어 모으므로 다른 파일은 고치지 않는다. 파일 이름과 `name` 이 다르면 서버가 뜨지 않는다.

```ts
import { decisionOpen } from "../../../core/index.ts";
import type { ToolDef } from "../contract.ts";

export default {
  name: "decision_open",
  description: "Open a decision for the owner, or return the open or closed one with the same key.",
  inputSchema: {
    type: "object",
    properties: { key: { type: "string" }, question: { type: "string" }, waiters: { type: "array" } },
    required: ["key", "question"],
    additionalProperties: false,
  },
  handler: (input) => decisionOpen(input),
} satisfies ToolDef;
```

- `handler` 는 코어 함수를 부르고 `Outcome` 을 돌려준다: `{ ok: true, value }` 또는 `{ ok: false, refusal: { code, reason, fix } }`. 상태는 갖지 않는다(Orca 와 sqlite 에 있다).
- 거부(`refusal`)는 `isError: true` 결과로 나가고 본문은 `{"code","reason","fix"}` JSON 이다. `fix` 에는 대신 성공할 호출이나 명령을 쓴다. 입력 모양 검사(필수 칸·모르는 칸·타입·enum)는 서버가 `inputSchema` 로 먼저 하고, 걸리면 handler 를 부르지 않고 `invalid_input` 으로 거부한다.
- 같은 코어 함수를 CLI 명령(`cli/commands/<name>.ts`)으로도 낸다면 `test/boundaries/both-entrances.ts` 의 `expectSameViaBothEntrances` 로 두 입구의 결과가 같음을 시험한다.
- 설명은 한두 문장(도구당 4,096자 상한, 부록 `#mcp`). 판단 기준은 skill 에 쓰고 여기에는 모양만 둔다.
- 읽기는 tool 로 만들지 않는다: `resources/<name>.ts` 에 `ResourceDef` 를 두면 서버가 같은 방식으로 모은다(현황 `brief` 는 U9).

## tool 17개 (부록 `#mcp`: 행동 9 + land 1 + 기록 6 + 결정 263 의 `unit_close` 1, 결정 160·162·171·195·223·263)

이 표가 tool 이름의 목록이고 `test/spec-names.test.ts` 가 `tools/*.ts` 와 같은지 본다. tool 을 더하거나 빼면 이 표의 행도 같은 PR 에서 고친다.

| tool | 하는 일 | 입력 | 단위 |
|---|---|---|---|
| `item_create` | 항목 만들기(Orca `task-create --deps` + `item_created`). 오너 항목의 확인 사실(`verify`·`cmdHint`)과 시작 시점(`trigger`·`hold`·`review_trigger`·`exec_by`, 결정 162)과 묶음 `lead`(결정 216)는 같은 호출에서 `item_extra_set` 으로. `item_created` 에 Task 의 Run 을 적는다(결정 216). CLI `sangsoe item new` 와 같은 Outcome | `{runId, spec, who, doneWhen, title?, deps?, role?, lead?, verify?, cmdHint?, trigger?, hold?, review_trigger?, exec_by?}` | U10 |
| `start_unit` | 세션을 여는 유일한 길인 코어 시작 함수(결정 94)를 부른다. `kind`·`effort`·`tier`·`reason` 을 모델 선택 표로 풀어 `--model` 로 넘기고(결정 164), `--effort` 는 Orca 가 그 모델에 받을 때만 넘긴다(카탈로그의 `orcaEfforts`, 결정 209) | `{role, worktreeId(오케스트레이터는 생략 가능, 결정 217), runId, childRole, taskId?, task 또는 spec, title?, deps?, lateAnswers?, references?, agent?, kind?, effort?, tier?, reason?}` | U10 |
| `edge_add` | 간선 더하기(순환·없는 항목·후속이 항목 아닌 간선 거부, 같은 간선 합침). CLI `sangsoe graph add` 와 같은 Outcome | `{kind, pred, succ, runs}` | U7 |
| `edge_remove` | 부가 간선 빼기(이유 필수, Orca deps 간선은 거부). CLI `sangsoe graph remove` | `{kind, pred, succ, reason, runs}` | U7 |
| `flow_expand` | 흐름 틀 펼치기(`dry_run` 은 쓰지 않음, 같은 `request_id` 는 이어서). CLI `sangsoe graph expand` | `{template, vars?, run?, who?, request_id?, dry_run?}` | U7 |
| `flow_step_skip` | 펼친 흐름의 단계 하나를 이유와 함께 건너뛴다(`flow_step_skipped`, 이유가 비거나 그 흐름에 없는 단계면 거부). 건너뛴 단계는 `flow_gap` 에서 빠진다(결정 195). CLI `sangsoe graph skip` | `{root, step, reason}` | U54 |
| `item_retire` | Task 가 `completed` 이고 PR 이 머지 없이 닫힌 항목을 이유와 함께 거둔다(`item_retired{task, by, reason}`, 결정 223). 거둔 항목은 🗑️ 취소로 읽혀 🚧 수와 묶음의 열린 수에서 빠진다. Orca 에는 쓰지 않는다(Task 는 `completed` 그대로). 그 밖의 항목은 `not_retirable`, 다시 부르면 `already`. CLI `sangsoe item retire` 와 같은 Outcome | `{item, reason, by, run?}` | U89 |
| `decision_open` | 결정 열기(닫힌 같은 결정 키는 기존 dNNN 과 답 반환, 열린 것은 대기자 합류) | `{subject, question, options?, waiters?: [{task, run}], carrier_run?}` | U8 |
| `decision_answer` | 결정 답·게이트 풀기·대기자마다 notify 한 번(다시 불러도 같다) | `{decision, answer, owner_action, linked_by?, run?}` | U8 |
| `land` | land 판정 함수 호출: 머지 예약, "승인되면 머지"(`merge_on_approval`), 또는 `verdict_merge_repos` 에 든 저장소에서 기록된 리뷰 판정으로 바로 머지(`verdict_approved`, 결정 158). CLI `sangsoe land` 와 같은 결과 | `{pr, repo?, head_sha?, dry_run?, main_fix?}` | U11 |
| `handoff_save` | 판단 상태 넷의 모양을 검사해 자기 Run 우편함에 Orca `handoff` 메시지로 남기기(sqlite 에 쓰지 않음) | `{next, waiting, open_questions, reply_to}` | U13 |
| `review_ask_record` | 리뷰 의뢰·리마인드 한 건을 `review_ask_sent` 로, 설정에 없는 리뷰어는 `unmapped_reviewer` 도 | `{pr, reviewer, reminder?}` | U13 |
| `resource_record` | 당사자가 막 만든 Docker id(또는 compose 프로젝트의 id 전부)를 소유자와 함께 `resource` 로 남긴다(REAPER 가 치우는 근거는 이 기록뿐, R-12). CLI `sangsoe resource record` 와 같은 Outcome | `{owner, kind?, ref?, compose?, action?}` | U18 |
| `review_record` | 독립 리뷰 판정 한 건을 `review_verdict` 로(결정 111). land 의 판정 경로가 읽는다(결정 158). 리뷰어가 작성자이거나, 부른 세션의 checkout 이 그 PR 의 head(브랜치나 커밋)를 쥐었거나 읽히지 않으면 거부(결정 162). CLI `sangsoe review record` 와 같은 Outcome | `{pr, head_sha, act_on, reviewer, repo?}` | U31 |
| `evidence_record` | 검증 실행 한 건을 PR 의 현재 head 에 `evidence` 로(결정 171). land 의 `evidence_missing` 이 읽는다. `kind` 는 `test`·`run`·`ui`·`dev`, `not_verified` 는 하나 이상. 기록자가 작성자이거나, head 가 현재 head 가 아니거나, 부른 세션의 checkout 이 그 PR 을 쥐었으면 거부. CLI `sangsoe evidence record` 와 같은 Outcome | `{pr, head_sha, kind, exit_code, not_verified, recorder, repo?, path?, sha256?}` | U36 |
| `stage_record` | 머지된 PR 이 닿은 단계(`merge`·`dev`·`prod`)를 `stage_recorded` 로(결정 171). `deploys_after` 간선과 흐름 틀의 배포 단계가 기다린다. 머지 전이거나 기록자가 작성자이거나 부른 세션이 그 PR 의 브랜치에 있으면 거부. CLI `sangsoe stage record` 와 같은 Outcome | `{pr, stage, sha, recorder, repo?}` | U36 |
| `unit_close` | 끝난 단위의 에이전트 터미널 하나를 handle 로 닫는다(결정 263). Orca 를 읽어 Dispatch 가 `succeeded`·`failed`·`cancelled`, 그 터미널이 아직 agent 와 함께 보이고 agent 가 `done`·`idle` 에 `agentWait` 가 `null`, 호출자의 터미널이 아닐 때만 닫고(`unit_closed` 한 줄), 아니면 틀린 조건을 한 줄로 거부한다. 탭·worktree 는 닫지 않는다. CLI 입구는 없다 | `{dispatch}` | U134 |

설계가 셌던 `item_transition` · `priority_set` · `notify` tool 은 만들지 않았다. 상태 전환은 Orca `task-update` 를 그대로 쓰고, 세션에 알리는 것은 Orca `send` 이고, 감지층의 깨움은 코어 `notify` 를 부르는 함수가 보낸다. 다시 볼 조건은 결정 160·162 에 있다.

## plugin 이 서버를 싣는 줄(제안)

`claude-plugin/.mcp.json`(plugin 루트는 마켓플레이스가 가리키는 `claude-plugin/` 소스 폴더이고, 빌드된 서버는 릴리스 트리의 `dist/claude-plugin/mcp/server.js` 다):

```json
{ "mcpServers": { "sangsoe": { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/../dist/claude-plugin/mcp/server.js"] } } }
```

빌드 결과는 `tools/` 의 파일을 따로 둬야 한다: 서버가 시작할 때 폴더를 읽어 모으므로 진입점 하나로 묶는 번들은 tool 을 찾지 못한다.
