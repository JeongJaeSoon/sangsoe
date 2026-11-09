# 110. MCP tool 과 CLI 명령은 파일 하나씩이고, 입구가 시작할 때 자기 폴더를 읽어 모은다

MCP 서버(`claude-plugin/mcp/server.ts`)는 `tools/`·`resources/` 를, CLI 라우터(`cli/main.ts`)는 `commands/` 를 시작할 때 읽어 각 파일의 default export(`ToolDef`·`ResourceDef`·`CommandDef`)를 모은다. 파일 이름과 선언한 이름이 다르면 시작하지 않는다. 결과는 두 입구 모두 `Outcome`(`{ok, value}` 또는 `{ok: false, refusal: {code, reason, fix}}`)이고, CLI 종료 코드는 0 성공 · 1 거부 · 2 사용법 오류다. 여러 단위가 같은 시각에 tool·명령을 더해도 같은 파일을 고치지 않게 하려는 것이다(split §1.3).

MCP 는 SDK 없이 stdio 의 줄 단위 JSON-RPC 로 `initialize`·`ping`·`tools/list`·`tools/call`·`resources/list`·`resources/read` 여섯 메서드만 직접 낸다. 공식 SDK 는 HTTP 전송용 의존(express·hono 등)을 함께 끌고 오고, 이 서버가 쓰는 것은 메서드 여섯이다. 실제 Claude Code 가 이 서버에 붙는 것은 `claude -p --mcp-config` 의 init 줄(`"status":"connected"`)로 확인했다.

버린 안: (가) 생성한 `tools/index.ts` 목록 — 단위마다 같은 파일을 고쳐 충돌한다. (나) 코어에 행동 하나를 두고 두 입구를 거기서 만들기 — ③ 과 ④ 칸을 한 파일이 가로지르고, tool 이 아닌 명령(`install`·`plugin approve`)과 명령이 아닌 tool 이 있다. (다) MCP SDK — 위 이유.

다시 볼 조건: 진입점 하나로 묶는 번들을 쓰게 되면(폴더를 읽어 모으는 방식이 깨진다) 빌드가 만든 목록 파일로 바꾼다. 서버가 메서드 여섯 밖의 MCP 기능(진행 알림·취소·구독)을 써야 하면 SDK 를 다시 본다. 협상하는 판은 `initialize` 가 있는 2025-11-25·2025-06-18·2025-03-26 이고, `initialize` 를 없애고 `server/discover` 를 둔 2026-07-28 판(설계 부록 `#mcp` 가 가리키는 판)은 아직 내지 않는다. Claude Code 가 그 판만 요청하게 되면 그 판을 더한다.

`brief` 는 13번째 tool 이 되지 않는다(split §8 Q15, 결정 89 의 다시 볼 조건): Claude Code 는 MCP resource 를 모델이 스스로 읽는 내장 tool `ListMcpResourcesTool`·`ReadMcpResourceTool`(승인 불필요)을 준다(code.claude.com/docs/en/mcp.md "Use MCP resources", docs/en/tools-reference.md). 문서에 없는 것: 백그라운드 subagent 의 내장 tool 허용 목록에 두 tool 이 없어, 백그라운드 subagent 는 resource 를 읽지 못할 수 있다.
