# 109. 릴리스 자산은 `tsc` 출력을 `npm pack` 으로 묶은 트리이고, 번들러는 아직 두지 않는다

split §8 Q10 은 진입점마다 esbuild 번들을 추천했다. 지금은 두지 않는다: 런타임 의존이 없어 `node_modules` 없이 `dist/` 만으로 돌고, CLI 라우터와 MCP 서버는 `cli/commands/`·`claude-plugin/mcp/tools/` 의 파일을 실행 중에 찾아 import 하므로 한 파일로 묶으면 찾을 것이 없어진다(번들을 들일 때는 진입점 여럿으로 묶어야 한다).

- **자산.** 태그 `vX.Y.Z[-rc.N]` 에서 `.github/workflows/release.yml` 이 typecheck·lint·test·build 뒤 `npm pack` 을 돌려 `sangsoe-X.Y.Z.tar.gz` 와 그 `.sha256` 을 GitHub 릴리스에 올린다. 담는 것은 `package.json` 의 `files` 목록 하나가 정한다: `dist/`, `.claude-plugin/marketplace.json`, `claude-plugin/`, `orca-plugin/`, `README.md`, `package.json`. 태그가 `package.json` 의 버전과 다르면 워크플로가 멈춘다(결정 99 의 원본 하나). 버전에 `-` 가 있으면 사전 릴리스로 낸다.
- **`claude-plugin/agents/` 에는 agent 정의만 둔다.** Claude Code 가 `agents/` 의 모든 `.md` 를 agent 로 읽으므로 README 를 두면 `README` 라는 agent 가 생긴다(`claude plugin details` 로 확인). 배치 표지는 `agents/.layout` 이다(`test/layout.test.ts`).
- **formula.** 탭의 `Formula/sangsoe.rb` 는 `libexec.install Dir["*"], ".claude-plugin"` 로 트리를 깔고(Ruby 의 `Dir["*"]` 는 점으로 시작하는 폴더를 빼므로 마켓플레이스 폴더를 따로 적는다), `bin/sangsoe` 는 `SANGSOE_ROOT=<opt_libexec>` 를 둔 채 브루의 `node` 로 `dist/cli/main.js` 를 돌리는 sh 래퍼다. 실행 비트에 기대지 않는다(`npm pack` 은 파일을 0644 로 담는다). `SANGSOE_ROOT` 가 `opt/sangsoe/libexec` 이라 `brew upgrade` 가 Cellar 폴더를 바꿔도 Claude Code·Orca 에 등록된 경로는 그대로다(결정 90). 변수가 없으면 실행 파일에서 위로 올라가 `.claude-plugin/marketplace.json` 이 있는 폴더를 트리로 본다(개발 체크아웃).

다시 볼 조건: 런타임 의존이 생기거나 Orca worker 가 한 파일 진입점을 요구할 때.
