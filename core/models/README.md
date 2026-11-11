<!-- layout: slot=④ layer=실행 tokens=free -->
# core/models — 모델 선택 표 하나 · 실행 · 토큰 X

sangsoe 가 모델을 고르는 곳은 이 폴더의 `table.ts` 하나다(결정 164). 두 층이 한 파일에 있다.

- **카탈로그(`CATALOG`)**: tier 마다 Claude Code alias · 지금 alias 가 가리키는 ID · 가이드가 적은 역할 · 가격 · context/output · API 기본 effort · 출처 · 확인 날짜 · 선택적 `pin`. 새 모델이 나오면 이 행만 바뀐다.
- **정책(`POLICY`)**: 일의 종류(`Kind`) → tier · effort · effort 사다리 · 다음 tier · 승격 조건 · 인용한 가이드 문장. 가이드 문구가 바뀌면 이 행만 바뀐다. 정책 행은 tier 만 적고 모델 이름이나 버전을 적지 않는다.
- **변경 이력(`CHANGELOG`)**: 날짜 · 무엇이 바뀌었나 · 출처 · 결정 번호. git 없이 읽힌다.

정책 행은 advisor tier(`advisor`, 다음 tier 로 옮긴 뒤는 `thenAdvisor`)와, advisor 를 붙일 수 없을 때의 본 tier(`withoutAdvisor`)도 적는다(결정 187). `pairing` 이 짝을 본다: advisor tier 는 본 tier 와 같거나 위이고, fast tier 는 advisor 가 되지 않는다. 워커 단위의 class(`UNIT_CLASSES`)는 `CLASS_KIND` 로 행 하나를 가리키고, 서브에이전트가 쓸 tier 는 `SUBAGENTS` 다(결정 188).

정책 행은 한국어 이름(`label`), 한 줄 이유(`why`), advisor 호출 예산(`budget`, 단위마다 또는 하루)도 적는다(결정 200).

`index.ts` 의 `resolve(kind, raise?)` 가 표를 `--model`·`--effort`·advisor 로 풀고, `launch` 가 그 advisor 가 닿는 길(Orca 의 옵션 → 새 worktree 의 `.claude/settings.local.json` → 오너 설정 `advisorModel` → 없음)에 맞춰 시작 인자와 worktree 에 쓸 설정을 정한다. advisor 가 없는 행과 예산을 다 쓴 단위는 그 파일에 advisor 를 끄는 env 를 쓰고, 구현 행은 바닥 tier 로 간다(결정 202). `rowLines` 가 SessionStart 에 넣을 예산 줄과 "일 전체를 끝까지 한다" 줄을 만든다. `spend.ts` 가 transcript 의 advisor 호출을 세고(`advisor_used`) 카탈로그 가격으로 비용을 계산하고, `view.ts` 가 `sangsoe models` 보기와 `docs/models.md` 를 만든다. effort 를 사다리대로 먼저 올리고, 사다리 끝에서도 모자랄 때만 이유를 적고 다음 tier 로 간다. 옮긴 tier 는 카탈로그의 API 기본 effort 에서 시작한다(frontier 는 `high`, 결정 172).

## 읽는 곳

| 읽는 곳 | 무엇을 | 어떻게 |
|---|---|---|
| `core/start/start.ts` (`start_unit`) | 정책 + 카탈로그 | `resolve` → `worker-start --model <alias> --effort <level>`, 승격은 `model_changed` 로 기록 |
| MCP resource `models` | 표 전체 | 판단 층(skill·agent)은 이 resource 로만 읽는다. 표를 본문에 옮겨 적지 않는다 |
| `core/checks/model-table.ts` (`doctor`) | 카탈로그 | 확인 날짜 60일 초과 warn, 더 새 Claude Code notice, 고정(pin·환경변수·`modelSettings`) notice, `advisorModel` 키가 없거나 advisor 가 꺼져 있으면 notice(정하는 것은 오너), 오늘의 advisor 호출 수와 추정 비용 |
| `cli/commands/models.ts` (`sangsoe models`) | 표 전체 | 토큰 X 한국어 보기. `--markdown` 의 출력이 `docs/models.md` 다 |
| `core/brief/build.ts` | 정책 + `unit_started`·`advisor_used` | 항목 상세의 "모델:" 줄, 현황의 오늘 advisor 사용 |
| `claude-plugin/agents/*.md` frontmatter `model:`·`effort:` | 정책의 역할 행 | `test/model-table.test.ts` 가 표의 alias·effort 와 같은지 본다 |

## 갱신 절차

세션이 한다. 타이머가 이 파일을 쓰는 일은 없다. `doctor` 의 `model-table` 행이 warn·notice 를 내면 시작한다.

1. 다시 읽을 쪽: `SOURCES` 의 URL(Choosing a model · Models overview · Claude Code model-config · sub-agents · effort · Claude Code advisor · API advisor tool).
2. 고칠 곳을 고른다.
   - alias 가 새 버전을 가리킬 뿐이면: 카탈로그 행의 `currentId`·가격·`verified` 만 고친다. 코드와 정책은 그대로다.
   - 새 tier, 역할·가격 변화: 카탈로그 행을 고치거나 더한다(`TIERS` 도).
   - 가이드의 권고 문구가 바뀌면: 정책 행과 그 `quote` 를 고친다.
   - 모두 `VERIFIED_WITH_CLAUDE_CODE` 를 지금 `claude --version` 으로 고친다.
3. `CHANGELOG` 맨 위에 한 줄(날짜 · 무엇 · 출처 · 결정 번호)을 더하고, `docs/decisions.md` 에 같은 번호의 결정을 날짜와 URL 과 함께 적는다.
4. `node cli/main.ts models --markdown` 의 출력으로 `docs/models.md` 를 바꾼다(`test/models-view.test.ts` 가 어긋나면 실패한다).
5. `npm test` — `test/model-table.test.ts` 가 역할마다 행이 있는지, 표의 사본이나 버전 번호가 다른 곳에 없는지, agent frontmatter 가 표와 같은지 본다.

## 고정(pin)

alias 는 바깥에서 고정될 수 있다: `ANTHROPIC_DEFAULT_*_MODEL` 이 alias 의 대상을, `modelSettings` 가 모델별 effort 를 바꾼다. 그래서 `--model opus` 를 넘긴 쪽은 alias 가 아니라 실제로 풀린 모델(상태 줄이나 stream-json 의 init event)을 확인한다. `doctor` 는 이 고정을 읽기만 하고(설정을 고치지 않는다) 있는 동안 매번 보인다. sangsoe 가 버전을 고정해야 하면(안정 릴리스의 리뷰 등) 카탈로그 행의 `pin` 한 곳에 dated ID·이유·날짜를 적는다.
