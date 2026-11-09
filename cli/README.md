<!-- layout: slot=④ layer=실행 tokens=free -->
# cli — ④ 셸 호출자 전용 `sangsoe` 명령 · 실행 · 토큰 X

코어의 얇은 진입점이다(결정 75 나). 에이전트는 MCP 만 쓰고 이 CLI 를 부르지 않는다. 호출자는 여섯 행뿐이다: SessionStart hook · 막는 hook · 기록 hook · 오너 전용 skill 의 상태 주입 줄 · 사람 터미널·시험·CI · `sangsoe plugin approve`.

`main.ts` 는 라우터다: 시작할 때 `commands/<name>.ts` 를 하나씩 모은다. 하위 명령을 더하는 단위는 `CommandDef`(`contract.ts`)를 default export 하는 파일 하나만 만들고 라우터는 고치지 않는다. 두 낱말 명령은 파일 이름에 `-` 를 쓴다(`plugin approve` → `commands/plugin-approve.ts`). 옵션은 `options` 에 적고 라우터가 엄격히 읽으므로, 적지 않은 옵션·남는 인자·`--help` 에서는 `run` 이 불리지 않는다. 종료 코드는 0 성공 · 1 거부 · 2 사용법 오류이고, `--json` 이면 값이나 거부(`{code, reason, fix}`)를 JSON 으로 낸다. 지금 있는 명령: `version`(`--version`·`-v`).
