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
| 판단 | `claude-plugin/skills/` | O | ③ Claude Code plugin | 판단 절차 skill |
| 판단 | `claude-plugin/agents/` | O | ③ Claude Code plugin | 오케스트레이터 · 리드 · 워커 정의 |
| — | `orca-plugin/` | X | ② Orca plugin | 칸 뿌리(매니페스트 `orca-plugin.json` 자리) |
| — | `claude-plugin/` | 섞임 | ③ Claude Code plugin | 칸 뿌리(매니페스트 `.claude-plugin/plugin.json` 자리) |

① Orca CLI 내장 기능에는 디렉터리가 없다: 만들지 않고 `core/orca/` 가 부른다. 저장소 밖에 두는 것: sqlite 파일(`~/.local/share/sangsoe/`), 설정(`~/.config/sangsoe/`), Homebrew formula(별도 탭 저장소). 그 밖의 폴더: `test/`(저장소 전체에 걸친 시험), `docs/`(설계 사본과 이 문서), `.github/workflows/`(CI).

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
