<!-- layout: slot=③ layer=실행 tokens=free -->
# claude-plugin/mcp/resources — MCP resource 하나 = 파일 하나 · 실행 · 토큰 X

읽기는 tool 이 아니라 resource 다(부록 `#mcp`). `resources/<name>.ts` 하나가 `ResourceDef`(`../contract.ts`)를 default export 하고, 서버가 시작할 때 이 폴더를 모은다.

| resource | uri | 내용 | 단위 |
|---|---|---|---|
| `brief` | `sangsoe://brief` | 현황 1단계 표 글. 코어 `renderMarkdown(buildBrief(...))` 그대로이고 `sangsoe brief` 출력과 같다(결정 89) | U9 |

2·3단계(`sangsoe brief <묶음> [<항목>]`)는 아직 resource 로 내지 않는다: 서버가 uri 를 정확히 맞춰 찾으므로 묶음·항목을 받으려면 resource template(`resources/templates/list`)이 서버에 먼저 있어야 한다.
