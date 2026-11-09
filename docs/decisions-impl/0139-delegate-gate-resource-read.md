# 139. 위임 게이트는 오케스트레이터의 sangsoe resource 읽기를 막지 않는다

**어느 쪽이 틀렸나.** 게이트다. 결정 89 는 "오케스트레이터가 오너에게 현황을 올릴 때는 resource 를 읽어 표를 고치지 않고 그대로 보낸다"고 정했고, 0120 의 표는 `brief` resource 를 `orchestrator` 가 읽는다고 적었으며, 0129 가 그 resource(`sangsoe://brief`)를 냈다. 부록 `#gates` 의 위임 게이트가 막는 것은 "조율(분류·배치·지시·`sangsoe` 명령) 밖의" 호출이고, sangsoe 의 상태를 읽는 것은 조율 안이다. 게이트(U12)는 sangsoe tool 을 `mcp__plugin_sangsoe_` 접두사로 열었지만, resource 는 Claude Code 내장 tool `ListMcpResourcesTool`·`ReadMcpResourceTool`(0110)로 읽고 이 둘은 접두사가 없어 막혔다.

**고친 것.** `ReadMcpResourceTool` 은 `server` 가 `plugin:sangsoe:` 로 시작할 때 통과한다(부록 `#mcp`: plugin 서버의 이름은 `plugin:<plugin>:<키>`). `ListMcpResourcesTool` 은 그 서버이거나 `server` 가 없을 때 통과한다. 에이전트 글은 resource 이름만 적으므로 서버 이름은 서버 없는 목록에서 알게 되고, 목록은 메타데이터만 읽는다. 다른 서버의 resource 읽기는 그대로 막는다. 에이전트 글(`claude-plugin/agents/orchestrator.md`)은 바꾸지 않았다.

**어긋남을 막는 시험.** `test/judgment-layer.test.ts` 가 `orchestrator.md` 에서 ``resource `이름` `` 을 모두 찾아 `claude-plugin/mcp/resources/<이름>.ts` 의 uri 로 바꾸고, 서버 없는 목록과, `plugin.json` 의 이름과 `.mcp.json` 의 서버 키로 만든 서버 이름마다 그 목록·읽기가 게이트에서 막히지 않는지 본다. plugin 이름이 바뀌면 이 시험이 떨어진다. 재생 묶음(`test/fixtures/hook-commands.jsonl`)에 통과 셋·거부 하나를 더했다.
