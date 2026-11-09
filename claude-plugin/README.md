<!-- layout: slot=③ layer=- tokens=mixed -->
# claude-plugin — ③ Claude Code plugin

Orca plugin 이 담지 못하는 것만 싣는다: hook · MCP 서버 · skill · agent 정의(결정 75 다·78). 토큰을 쓰는 쪽과 쓰지 않는 쪽이 하위 폴더로 갈린다.

| 폴더 | 층 | 토큰 |
|---|---|---|
| `hooks/` | 감지(기록 hook) · 막는 hook(게이트) | X |
| `mcp/` | 실행: 에이전트가 코어를 부르는 유일한 입구 | X |
| `skills/` | 판단: 판단 절차 · 오너 전용 현황 입구 | O |
| `agents/` | 판단: 오케스트레이터 · 리드 · 워커 정의 | O |

매니페스트 `.claude-plugin/plugin.json` 과 마켓플레이스 파일은 뒤 유닛이 둔다. hook 은 `sangsoe` CLI 를 부르는 command hook 이고, MCP 서버는 `core/index.ts` 를 import 한다.
