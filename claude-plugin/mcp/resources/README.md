<!-- layout: slot=③ layer=실행 tokens=free -->
# claude-plugin/mcp/resources — MCP resource 하나 = 파일 하나 · 실행 · 토큰 X

읽기는 tool 이 아니라 resource 다(부록 `#mcp`). `resources/<name>.ts` 하나가 `ResourceDef`(`../contract.ts`)를 default export 하고, 서버가 시작할 때 이 폴더를 모은다.

| resource | uri | 내용 | 단위 |
|---|---|---|---|
| `brief` | `sangsoe://brief` | 현황 1단계 표 글. 코어 `renderMarkdown(buildBrief(...))` 그대로이고 `sangsoe brief` 출력과 같다(결정 89) | U9 |
| `ready` | `sangsoe://ready` | 리드가 시작할 수 있는 🟢 항목(코어 `readiness`, 오너가 시작할 것은 빼고), 이어서 기다리는 항목마다 `renderWhy` 의 "왜 준비되지 않았나" 표. `brief` 와 같은 Run 들을 읽는다(결정 162) | U31 |
| `item_timeline` | `sangsoe://item/{task}/timeline` | 한 항목의 event 를 순서대로(코어 뷰 `item_timeline`, 잡음 제외). `{task}` 는 Orca Task id 나 `iNNN`. JSON `{task, rows}`(결정 162) | U31 |

`uri` 대신 `uriTemplate` 을 둔 resource 는 template 이다. 서버는 `resources/templates/list` 로 따로 내고, `resources/read` 의 uri 를 고정 resource 에서 먼저 찾은 뒤 template 에 맞춘다. `{var}` 하나는 경로 한 칸이다. 현황 2·3단계(`sangsoe brief <묶음> [<항목>]`)는 아직 resource 로 내지 않는다.
