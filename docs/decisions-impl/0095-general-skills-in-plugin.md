# 95. 일반 작업 스킬은 sangsoe 의 Claude Code plugin 안 `claude-plugin/skills/general/` 에 둔다

sangsoe 의 역할·상태에 기대지 않는 일반 작업 스킬 14개(`principles`·`write-plainly`·`tdd`·`write-skill`·`prune-comments`·`verification-skill`·`ui-review`·`architect`·`challenge`·`explain-code`·`fan-out`·`figure-it-out`·`show-me-your-work`·`recall`)를 별도 저장소가 아니라 ③ Claude Code plugin 의 `claude-plugin/skills/general/<name>/` 에 둔다. 한 스킬이 한 폴더이고, 폴더마다 `SKILL.md`·`references/`·`evals/` 가 있다.

## 대체하는 것

- 결정 18 의 "일반 스킬은 별도 작은 플러그인으로" 추천.
- 결정 74 O-6 을 D-1 에 적용한 부분, 곧 port-plan 1절 D-1 과 2.3 의 "general-skills 별도 저장소". 다시 만든다는 O-6 의 뜻은 그대로다: 옛 본문은 참고만 하고 sangsoe 에 맞게 새로 썼다.
- `design.html` 1·2절, `glossary.md`, build-order 도식의 "일반 스킬 저장소" 표기. 이 문서들은 이 단위가 고치지 않고 설계 대 코드 대조(U25)가 이 결정을 접는다.

## 이유

프로그램 술어 2 가 일반 작업 스킬을 sangsoe 의 Claude Code plugin 안에 두라고 정했고, 오너가 2026-11-09 에 같은 방향을 다시 말했다. 설계의 "별도 저장소"보다 이 말이 나중이다.

설치 쪽도 이 배치가 단순하다. 결정 90 은 Homebrew 트리 하나를 `sangsoe install` 이 Claude Code 와 Orca 에 등록하는 길 하나만 둔다. 별도 저장소면 그 스킬만 따로 설치하는 두 번째 길이 생긴다. Claude Code plugin 의 skill 은 plugin 의 기본 기능이라 따로 만들 것이 없다.

스킬은 판단 층이고 토큰을 쓴다. 그래서 `docs/architecture.md` 표에 `claude-plugin/skills/general/` 을 판단·토큰 O·③ 으로 올렸고, `test/layout.test.ts` 가 이 폴더에 코드 파일이 없는지 검사한다.

## 이식하며 정한 것

**스크립트는 가져오지 않았다.** 토큰 O 폴더에는 코드가 없다(경계 규칙). 원본 스크립트가 하던 확인은 본문으로 옮겼다.

| 원본 스크립트 | 옮긴 곳 |
|---|---|
| `verification-skill` 의 정적 린트와 그 시험 | `verification-skill/references/lint-rules.md`: 규칙 id 여덟과 판정 기준을 읽고 확인하는 점검표 |
| `ui-review` 의 측정 스크립트(헤드리스 Chrome)·페이지 측정 JS·시험 페이지 | `ui-review/SKILL.md` 2단계: 세션의 브라우저 도구로 `getBoundingClientRect()`·`getComputedStyle()` 를 읽어 `rules.md` 의 check id 별로 판정한다. 기본 임계값은 `rules.md` 머리에 적었다 |
| `write-skill` 의 전체 점검 스크립트·설명 평가 스크립트와 그 시험 | `write-skill/SKILL.md` 5절: `npm test`, `claude plugin validate`, 아래 평가 명령을 직접 부른다 |

**평가는 스킬 폴더를 plugin 대상으로 돌린다.** `claude plugin eval --eval-dir` 는 plugin 의 `skills/` 아래 폴더를 거부한다(`--eval-dir must not be inside the plugin's skills/ directory`). 스킬 폴더 자체를 대상으로 주면 그 폴더가 skill 하나짜리 plugin 으로 풀리고 `<name>/evals/` 가 평가 폴더가 된다:

```bash
claude plugin eval claude-plugin/skills/general/<name> --ablation none --no-publish --trust-plugin \
  --runs 3 --output-dir "$TMPDIR/<scratch>/<name>" --report "$TMPDIR/<scratch>/<name>.html"
```

이때는 그 스킬 하나만 올라오므로 "이웃 스킬이 발동하지 않았다" 채점은 아무것도 증명하지 않는다. 그래서 스킬마다 발동해야 하는 사례 하나 이상과 발동하면 안 되는 사례 하나(`min: 0`·`max: 0`)를 두었다. `--output-dir` 를 빼면 결과가 저장소 안 `evals/results/` 에 쌓인다.

**`prose_check` hook 은 이번에 넣지 않았다.** 결정적 패턴은 이미 `write-plainly/references/korean.md`·`english.md` 에 있다. `claude-plugin/hooks/README.md` 가 정한 꼴은 `sangsoe` CLI 를 부르는 command hook 이고, 그 CLI 라우터와 hook 등록(`hooks.json`)은 다른 단위의 몫이다. hook 은 코어의 순수 함수 + `sangsoe` 하위 명령 + 막지 않는 command hook 으로, 라우터와 hook 등록이 main 에 들어온 뒤 만든다.

**매니페스트가 이 폴더를 가리켜야 한다.** 스킬 폴더 하나를 plugin 으로 읽는 것은 확인했다. plugin 전체를 올릴 때 Claude Code 가 `skills/general/<name>/` 처럼 한 단계 깊은 스킬을 찾는지는 확인하지 않았다. 매니페스트(`.claude-plugin/plugin.json`)를 두는 단위가 skill 경로에 `skills/general/` 을 넣거나 실제로 올려 확인한다.

## 나눔

U6a 가 `principles`·`write-plainly`·`tdd`·`write-skill`·`prune-comments`·`verification-skill`·`ui-review` 일곱을, U6b 가 나머지 일곱을 옮긴다. 폴더가 스킬마다 따로라 겹치는 파일은 `claude-plugin/skills/general/README.md` 의 표 하나다.
