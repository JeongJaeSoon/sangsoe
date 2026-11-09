<!-- layout: slot=③ layer=감지 tokens=free -->
# claude-plugin/hooks — 감지 · 토큰 X

`hooks.json` 이 등록 목록이다. 막는 hook `pre-tool-use.sh`(모든 tool 의 PreToolUse 한 줄, `onFailure: "block"`) → `sangsoe hook pre-tool-use`. 판정은 `core/gates/` 에 있고 이 스크립트는 CLI 를 찾아 부를 뿐이다(찾는 순서는 결정 118). 기록 hook 일곱(SessionStart · UserPromptSubmit · Stop · Notification · PostToolUse · PostCompact · SessionEnd)은 `record.sh <event>` → `sangsoe hook <event>` 이고 판정은 `core/session/` 에 있다. 기록 hook 은 막지 않는다: CLI 가 없거나 무엇이 실패해도 0 으로 끝나고, SessionStart 만 주입할 줄을 출력한다. 모두 `sangsoe` CLI 를 부르는 command hook 이다: SessionStart 때는 MCP 서버가 없고, 실패 시 막기(`onFailure: "block"`)는 command hook 에만 있다(결정 75 나).
