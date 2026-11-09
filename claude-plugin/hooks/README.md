<!-- layout: slot=③ layer=감지 tokens=free -->
# claude-plugin/hooks — 감지 · 토큰 X

비어 있다. 뒤 유닛이 SessionStart hook, 막는 hook(게이트 4종 · 모양 검사), 기록 hook(`owner_action` · `waiting_human` · `compacted` 등)을 둔다. 모두 `sangsoe` CLI 를 부르는 command hook 이다: SessionStart 때는 MCP 서버가 없고, 실패 시 막기(`onFailure: "block"`)는 command hook 에만 있다(결정 75 나).
