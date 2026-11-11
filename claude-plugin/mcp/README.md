<!-- layout: slot=③ layer=실행 tokens=free -->
# claude-plugin/mcp — 실행 · 토큰 X

MCP stdio 서버(`server.ts`). 에이전트(오케스트레이터 · 리드 · 워커)가 코어를 부르는 유일한 길이고, 상태는 갖지 않는다: 코어 함수를 `core/index.ts` 로 부를 뿐이다. 시작할 때 `tools/`·`resources/` 의 파일을 하나씩 모은다(`collect.ts`). tool 을 더하는 법과 tool 16개 표는 `tools/README.md`, 계약 타입은 `contract.ts`.
