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

## tool 12개 (부록 `#mcp`: 행동 9 + land 1 + 기록 2)

이름과 입력은 자리표시다. 각 단위가 구현하면서 이름·스키마를 확정하고 이 표의 행을 고친다. 단위 칸이 `미정` 인 행은 리드가 배정한다.

| tool | 하는 일 | 입력 스키마(자리표시) | 단위 |
|---|---|---|---|
| `item_create` | 항목 만들기(Orca `task-create --deps` + `item_created`). CLI `sangsoe item new` 와 같은 Outcome | `{runId, spec, who, doneWhen, title?, deps?}` | U10 |
| `item_transition` | 상태 전환(Orca `task-update` + `item_transition`) | `{item, to, reason?}` | 미정 |
| `priority_set` | 우선순위 바꾸기 | `{item, priority}` | 미정 |
| `edge_add` | 부가 간선 더하기(순환·없는 항목 거부) | `{kind, pred, succ}` | U7 |
| `edge_remove` | 부가 간선 빼기 | `{kind, pred, succ}` | U7 |
| `flow_expand` | 흐름 틀 펼치기 | `{template, vars, request_id}` | U7 |
| `decision_open` | 결정 열기(닫힌 같은 결정 키는 기존 dNNN 과 답 반환, 열린 것은 대기자 합류) | `{subject, question, options?, waiters?: [{task, run}], carrier_run?}` | U8 |
| `decision_answer` | 결정 답·게이트 풀기·대기자마다 notify 한 번(다시 불러도 같다) | `{decision, answer, owner_action, linked_by?, run?}` | U8 |
| `notify` | 판단이 필요한 신호로 세션 한 번 깨우기. 코어 함수 `notify` 는 U8 에 있고 tool 은 아직 없다(받는 사슬 id 를 항목에서 읽는 쪽이 필요) | `{item, kind, body}` | 미정 |
| `land` | land 판정 함수 호출(머지 예약 또는 "승인되면 머지"). 이름·입력 확정, CLI `sangsoe land` 와 같은 결과 | `{pr, repo?, head_sha?, dry_run?, main_fix?}` | U11 |
| `handoff_save` | 판단 상태 넷을 Orca `handoff` 메시지로 남기기 | `{next, waiting, open_questions, reply_to}` | U13 |
| `review_ask_record` | 리뷰 의뢰를 `review_ask_sent` 로 남기기 | `{pr, reviewer, channel}` | U13 |

표 밖의 tool 하나: `start_unit`(U10)은 세션을 여는 유일한 길인 코어 시작 함수(결정 94)를 부른다. 입력은 `{role, worktreeId, runId, childRole, taskId?, task 또는 spec, title?, deps?, lateAnswers?, references?, agent?}` 이다.

## plugin 이 서버를 싣는 줄(제안)

`claude-plugin/.mcp.json`(plugin 루트는 마켓플레이스가 가리키는 `claude-plugin/` 소스 폴더이고, 빌드된 서버는 릴리스 트리의 `dist/claude-plugin/mcp/server.js` 다):

```json
{ "mcpServers": { "sangsoe": { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/../dist/claude-plugin/mcp/server.js"] } } }
```

빌드 결과는 `tools/` 의 파일을 따로 둬야 한다: 서버가 시작할 때 폴더를 읽어 모으므로 진입점 하나로 묶는 번들은 tool 을 찾지 못한다.
