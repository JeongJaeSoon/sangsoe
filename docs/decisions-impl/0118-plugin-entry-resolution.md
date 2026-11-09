# 118. plugin 의 hook·MCP 서버는 plugin 옆 `dist/` 를 먼저 찾고, 없으면 PATH 의 `sangsoe` 로 브루 트리를 찾는다

U5 가 제안한 `${CLAUDE_PLUGIN_ROOT}/../dist/...` 는 소스 체크아웃(`claude --plugin-dir claude-plugin`)과 브루 트리(`libexec/` 에 `dist/` 와 `claude-plugin/` 이 나란히)에서는 맞다. 그러나 `claude plugin install` 로 설치한 plugin 은 Claude Code 의 plugin 캐시(`~/.claude/plugins/cache/sangsoe/sangsoe/<버전>/`)에 복사되어 `CLAUDE_PLUGIN_ROOT` 가 그 사본을 가리키고, 사본 옆에는 `dist/` 가 없다(이 PC 의 `installed_plugins.json` `installPath` 로 확인).

그래서 두 단계로 찾는다.

- hook: `claude-plugin/hooks/pre-tool-use.sh` 가 `../dist/cli/main.js` 가 있으면 그것을, 없으면 PATH 의 `sangsoe hook pre-tool-use` 를 부른다. hook 은 CLI 를 부른다는 규칙(결정 75 나) 그대로다. 둘 다 없으면 이유를 stderr 에 쓰고 2 로 끝나며 `onFailure: "block"` 이 막는다. hooks.json 은 `sh <경로>` 로 부르므로 스크립트에 실행 비트가 필요 없다(실행 비트를 주는 `chmod` 가 권한 확인에서 거부되어 이 꼴로 정했고, 코디네이터가 동의했다).
- MCP 서버: `.mcp.json` 이 `../dist/claude-plugin/mcp/server.js` 가 있으면 그것을, 없으면 `readlink -f "$(command -v sangsoe)"` 의 `bin/../libexec/dist/claude-plugin/mcp/server.js` 를 node 로 띄운다. 브루 formula 의 bin 은 `libexec/dist/cli/main.js` 를 부르는 래퍼라 이 상대 위치가 formula 의 계약이다.

버린 안: (가) `sangsoe mcp` CLI 명령 — CLI(④)가 `claude-plugin/`(③)의 서버를 import 하게 되어 칸 경계를 넘는다. (나) 캐시 사본만 쓰는 길 — 사본에 빌드 결과를 싣지 않는 한 불가능하고, 빌드 결과를 plugin 폴더에 복사하면 같은 파일을 두 곳에 둔다.

다시 볼 조건: Claude Code 가 경로 마켓플레이스 plugin 을 복사하지 않고 원본 폴더에서 읽게 되거나, formula 의 `bin`·`libexec` 배치가 바뀔 때.
