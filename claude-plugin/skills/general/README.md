<!-- layout: slot=③ layer=판단 tokens=using -->
# claude-plugin/skills/general — 일반 작업 스킬 · 판단 · 토큰 O

sangsoe 의 역할·상태에 기대지 않는 일반 작업 스킬을 둔다(`docs/decisions.md` 결정 95). 한 스킬이 한 폴더이고, 폴더마다 `SKILL.md`, 필요하면 `references/`, 발동 평가 `evals/` 가 있다. 코드 파일은 두지 않는다: 원본의 스크립트가 하던 확인은 본문의 점검 목록이나 명령 한 줄로 옮겼다.

평가는 스킬 폴더를 plugin 대상으로 삼아 돌린다(`claude plugin eval --eval-dir` 는 `skills/` 아래를 거부한다):

```bash
claude plugin eval claude-plugin/skills/general/<name> --ablation none --no-publish --trust-plugin \
  --runs 3 --output-dir "$TMPDIR/<scratch>/<name>" --report "$TMPDIR/<scratch>/<name>.html"
```

`--output-dir` 를 빼면 결과가 `<name>/evals/results/` 에 쌓인다. 저장소에는 넣지 않는다.

| 스킬 | 언제 |
|---|---|
| `principles` | 설계·리팩터·검증·위임에서 이름 붙은 원칙이 필요할 때 |
| `write-plainly` | 남는 글(PR 본문·커밋·문서·보고·스킬 본문)을 쓰거나 고칠 때 |
| `tdd` | 싼 시험 대상이 있는 버그를 고칠 때, 실패하는 시험을 먼저 요청받았을 때 |
| `write-skill` | 스킬·agent 정의·CLAUDE.md 꼴 파일을 쓰거나 고칠 때 |
| `prune-comments` | diff 의 주석을 코드가 말하지 못하는 것만 남길 때 |
| `verification-skill` | 앱을 사용자처럼 돌리는 `verify-*` 스킬을 만들거나 손볼 때 |
| `ui-review` | 화면·시안·UI PR 을 사람에게 보이기 전에 |
| `architect` | 코드 전에 타입·시그니처·모듈 구조를 스케치하고 설계안을 둘 이상 비교할 때 |
| `challenge` | 변경이 diff 밖에서 깨뜨릴 것을 실행으로 증명할 때, 설계·계획을 독립 리뷰어에게 따져 물을 때 |
| `explain-code` | 읽지 않은 코드를 바꾸기 전에: 어떻게 동작하나·왜 이렇게 됐나·배우기·기능 지도 |
| `fan-out` | 병렬 작업자로 한 질문을 나눠 훑거나(sweep) 같은 일을 경쟁시켜 하나로 합칠 때(compete) |
| `figure-it-out` | 큰 이주·여러 부분 변경을 코드 전에 감사 가능한 단계로 설계할 때 |
| `show-me-your-work` | 길거나 자리 비운 동안 도는 일의 결정 기록(무엇·왜·증거·결과)을 남길 때 |
| `recall` | 지난 세션·sangsoe 기록·저장소 이력에서 어디까지 했는지 되살릴 때 |
