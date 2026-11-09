# 저장소 배치 — 층 · 칸 · 토큰

설계(`design.html` 2절 네 칸 배치, 3절 "항목의 상태를 누가 바꾸나")를 디렉터리에 옮긴 표다. 각 폴더의 `README.md` 첫 줄이 같은 값을 기계가 읽는 꼴로 갖고(`<!-- layout: slot=… layer=… tokens=… -->`), `test/layout.test.ts` 가 이 표를 집의 유일한 목록으로 읽어, README 가 없거나 표에 없는 README 가 있거나 표지가 표와 다르면 실패한다.

## 층 → 디렉터리 → 토큰 → 칸

| 층 | 디렉터리 | 토큰 | 칸 | 담는 것 |
|---|---|---|---|---|
| 감지 | `orca-plugin/monitors/` | X | ② Orca plugin | monitor 다섯 · 타이머 멈춤 감지 |
| 감지 | `claude-plugin/hooks/` | X | ③ Claude Code plugin | SessionStart · 막는 hook(게이트) · 기록 hook |
| 실행 | `core/` | X | ④ 공유 코어 | 판단 함수(GRAPH · ready · capacity · land · verify_tier · decision_* · notify · restart_due · recover_plan · 시작 점검) |
| 실행 | `core/store/` | X | ④ 공유 코어 | sqlite event 표와 뷰 |
| 실행 | `core/orca/` | X | ④ 공유 코어 | Orca CLI 어댑터(① 을 부르는 유일한 자리) |
| 실행 | `core/install/` | X | ④ 공유 코어 | install · uninstall · doctor |
| 실행 | `cli/` | X | ④ 공유 코어 | 셸 호출자 전용 `sangsoe` |
| 실행 | `orca-plugin/reaper/` | X | ② Orca plugin | REAPER 라운드 타이머 |
| 실행 | `orca-plugin/panel/` | X | ② Orca plugin | 패널 · 상태 표시줄 B · 버튼 |
| 실행 | `claude-plugin/mcp/` | X | ③ Claude Code plugin | MCP 서버(에이전트의 입구) |
| 실행 | `claude-plugin/mcp/tools/` | X | ③ Claude Code plugin | MCP tool 하나 = 파일 하나 |
| 판단 | `claude-plugin/skills/` | O | ③ Claude Code plugin | 판단 절차 skill |
| 판단 | `claude-plugin/agents/` | O | ③ Claude Code plugin | 오케스트레이터 · 리드 · 워커 정의 |
| — | `orca-plugin/` | X | ② Orca plugin | 칸 뿌리(매니페스트 `orca-plugin.json` 자리) |
| — | `claude-plugin/` | 섞임 | ③ Claude Code plugin | 칸 뿌리(매니페스트 `.claude-plugin/plugin.json` 자리) |

① Orca CLI 내장 기능에는 디렉터리가 없다: 만들지 않고 `core/orca/` 가 부른다. 저장소 밖에 두는 것: sqlite 파일(`~/.local/share/sangsoe/`), 설정(`~/.config/sangsoe/`), Homebrew formula(별도 탭 저장소). 그 밖의 폴더: `test/`(저장소 전체에 걸친 시험), `docs/`(설계 사본과 이 문서), `.github/workflows/`(CI 와 릴리스), `.claude-plugin/`(Claude Code 마켓플레이스 파일, 아래 "설치와 릴리스").

## 경계 규칙

- 토큰 O 폴더(`skills/`·`agents/`)에는 코드 파일이 없다. 토큰 X 폴더에는 프롬프트가 없다.
- 다른 칸은 코어를 `core/index.ts` 로만 import 한다. 두 plugin 사이의 연결점은 코어(sqlite)와 Orca CLI 둘뿐이다(결정 78 다).
- 에이전트는 MCP 만 쓰고, CLI 는 셸 호출자 여섯 행만 쓴다. plugin worker 는 코어를 직접 import 한다(결정 75 나).
- Orca 가 원본인 사실은 sqlite 에 복사하지 않는다(결정 74).
- OS 상주 작업·자체 상주 프로세스·포트는 두지 않는다. 주기 감지는 ② 의 worker 타이머다(결정 75 라).

## 빌드 계약

| 명령 | 하는 일 | CI 작업 |
|---|---|---|
| `npm ci` | 의존 설치(잠금 파일 그대로) | 셋 모두 |
| `npm run typecheck` | `tsc --noEmit`, 시험 포함 | `typecheck` |
| `npm run lint` | `biome lint .` | `lint` |
| `npm test` | `node --test` 로 `*.test.ts` 를 소스 그대로 돌림 | `unit` |
| `npm run build` | `tsc -p tsconfig.build.json` → `dist/` | `unit`(뒤이어 `--version` 확인) |

`dist/cli/main.js` 가 `sangsoe` 의 bin 이다. 버전 문자열은 `package.json` 하나가 원본이고 코어가 그것을 import 한다.

## 설계 후보와 고른 것

후보는 둘을 직접 썼다(한 저장소 안의 경계 하나라 compete 를 돌리지 않았다).

- **A. 칸이 최상위인 한 패키지(고름)**: `core/`·`cli/`·`orca-plugin/`·`claude-plugin/` 이 최상위이고 `package.json`·`tsconfig` 는 하나다. 칸이 첫 눈에 보이고, 브루 트리 하나·빌드 하나라 설치(결정 90)가 가장 단순하다. 경계는 패키지 경계 대신 `test/layout.test.ts` 가 지킨다.
- **B. npm workspaces 네 패키지**: `packages/core` 등에 각자 `package.json`·`exports`. 내부 import 를 빌드가 막는 장점이 있으나, 버전 문자열이 네 곳에 생기고(손으로 맞추는 목록), 프로젝트 참조·배포 단위가 늘며, Claude Code plugin 의 `skills/`·`agents/` 관례 위치와 겹쳐 폴더가 한 단계 깊어진다.
- 버린 꼴: 최상위를 `token-free/`·`token-using/` 으로 가르는 안. 토큰 구분은 가장 잘 보이지만 한 plugin(③)이 두 뿌리로 찢어져 매니페스트가 가리킬 폴더가 둘이 된다.

결정 번호와 이유는 `decisions-impl/`(결정 96–101).

## 어댑터 등록 계약 (MCP tool · CLI 명령)

같은 코어 함수를 두 입구가 감싼다. 입구마다 항목 하나가 파일 하나이고, 입구는 시작할 때 자기 폴더를 읽어 모은다. 그래서 단위는 파일 하나를 더하고 공유 목록을 고치지 않는다(결정 110).

| 입구 | 파일 | default export | 호출자 |
|---|---|---|---|
| MCP 서버 `claude-plugin/mcp/server.ts`(stdio) | `claude-plugin/mcp/tools/<name>.ts`, `resources/<name>.ts` | `ToolDef`·`ResourceDef`(`claude-plugin/mcp/contract.ts`) | 에이전트 전부 |
| CLI 라우터 `cli/main.ts` | `cli/commands/<name>.ts`(두 낱말 이름은 `-` 로: `plugin approve` → `plugin-approve.ts`) | `CommandDef`(`cli/contract.ts`) | 셸 호출자 여섯 행 |

- 결과는 `Outcome` 하나: `{ ok: true, value }` 또는 `{ ok: false, refusal: { code, reason, fix } }`. MCP 는 `isError` 와 JSON 본문으로, CLI 는 종료 코드(0 성공 · 1 거부 · 2 사용법 오류)와 `--json` 출력으로 낸다. 사람에게 보고만 하는 CLI 명령(`install`·`uninstall`·`doctor`)은 `Report`(`{ code, lines }`)를 돌려준다. 명령은 호스트(`Host`)를 인자로 받아 시험이 가짜를 넣는다.
- 모르는 명령·인자·tool·입력 칸은 코어 함수에 닿기 전에 입구가 거부하고 맞는 형태(사용법 줄, 입력 칸 목록)를 보인다. `--help` 도 아무것도 부르지 않는다.
- `test/boundaries/both-entrances.ts` 의 `expectSameViaBothEntrances` 가 한 호출을 두 입구로 보내 `Outcome` 이 같은지 본다.

## 설치와 릴리스

최종 릴리스가 그대로 쓰는 계약이다(결정 90·108·109).

- **릴리스 자산.** 태그 `v<package.json 버전>` 을 push 하면 `.github/workflows/release.yml` 이 검사·빌드 뒤 `npm pack` 으로 `sangsoe-<버전>.tar.gz`(+`.sha256`)를 만들어 GitHub 릴리스에 올린다. 압축을 풀면 `package/` 아래 `package.json`·`dist/`·`.claude-plugin/marketplace.json`·`claude-plugin/`·`orca-plugin/`·`README.md` 가 있다. 담는 목록은 `package.json` 의 `files` 하나다. 버전에 `-` 가 있으면 사전 릴리스다.
- **formula.** 탭 저장소의 `Formula/sangsoe.rb`: `url`(릴리스 자산)·`sha256`·`depends_on "node"`·`libexec.install Dir["*"], ".claude-plugin"`(`Dir["*"]` 는 점 폴더를 뺀다)·`bin/sangsoe` sh 래퍼(`SANGSOE_ROOT=<opt_libexec>` 를 두고 브루의 `node` 로 `dist/cli/main.js` 실행)·`test do`(`--version` 과 `doctor --offline`). `post_install` 은 없다.
- **`sangsoe install`(멱등).** 상태를 읽고 고른다: 마켓플레이스 `sangsoe` 가 없으면 `claude plugin marketplace add <트리> --scope user`, 있으면 `update`, 다른 경로를 가리키면 `remove` 뒤 `add` → plugin `sangsoe@sangsoe` 가 없으면 `claude plugin install … --scope user`, 있으면 `update` → `orca-plugin/orca-plugin.json` 이 트리에 있으면 `orca plugin dev load <트리>/orca-plugin --json`(종료 코드 3 은 승인 대기, 지문을 보여 주고 `sangsoe plugin approve` 를 안내), 없으면 한 줄로 건너뛴다 → `doctor`. `<트리>` 는 `$(brew --prefix)/opt/sangsoe/libexec` 이라 `brew upgrade` 뒤에도 같다.
- **`sangsoe uninstall`.** 있는 것만 지운다: `claude plugin uninstall sangsoe@sangsoe --scope user --keep-data` · `claude plugin marketplace remove sangsoe --scope user` · `orca plugin list --json` 에 sangsoe 개발 plugin 이 있으면 `orca plugin dev unload <키>`. 목록을 읽지 못하면 없는 것으로 치지 않고 종료 코드 1 이다. sqlite·설정은 남긴다.
- **`sangsoe doctor [--offline]`.** 항목마다 `ok` · `FAIL … — fix: <명령>` · `not yet`(아직 없는 부분). `FAIL` 이 하나라도 있으면 종료 코드 1. `--offline` 은 트리(매니페스트 버전 일치·Node 하한)만 본다.

고른 꼴과 버린 꼴: (A, 고름) `tsc` 출력 + `npm pack` + 래퍼가 트리 경로를 환경 변수로 건넴. 선언 하나(`files`)가 자산을 정하고 시험이 그것을 읽는다. (B) 진입점별 esbuild 번들 + `packaging/` 의 묶음 스크립트 + 실행 경로의 Cellar→opt 변환. 번들은 런타임 의존이 없는 지금 얻는 것이 없고, 파일을 실행 중에 찾는 라우터·MCP 수집기를 깨며, 경로 변환은 브루 내부 배치에 기대므로 버렸다.
