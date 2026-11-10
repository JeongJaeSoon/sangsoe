<!-- layout: slot=④ layer=실행 tokens=free -->
# core — ④ 공유 코어 · 실행 · 토큰 X

두 plugin·MCP 서버·CLI·plugin worker 가 같이 부르는 TS/Node 판단 함수와 sqlite 다(결정 77 가·78). 다른 칸은 `core/index.ts` 로만 들어온다.

지금 있는 것:

- `version.ts` — 버전 문자열 하나(`package.json` 이 원본)
- `contract/` — event type·뷰 시그니처·`dedupe_key` 규칙·전이표·시계. `orca.ts` 는 Orca 어댑터 계약
- `store/` — sqlite event 표와 뷰, DB 시작 점검
- `orca/`·`gh/` — Orca·GitHub 을 부르는 유일한 자리(Orca 가 원본인 값은 id 로만 읽는다)
- `checks/` — 시작 점검과 `doctor` 의 점검 함수
- `graph/` — GRAPH: 간선의 유일한 입구, `ready` 뷰, 크리티컬 패스, 흐름 틀(`graph/flows/`)
- `capacity/` — 자리 수 판정
- `land/`·`verify/`·`approve/` — land 판정 함수, 검증 등급(`verify_tier`)과 증거, 리뷰 판정·plugin 승인
- `decision/`·`notify/` — `decision_open` · `decision_answer`(Orca `gate-resolve` 를 부른다) · 알림
- `owner/` — 오너 할 일과 완료 버튼, verify probe 판정
- `brief/` — 현황 뷰(`sangsoe brief`·패널·상태 표시줄이 같은 수를 읽는다)
- `detect/` — monitor 다섯(orca·pr·queue·resource·chat)의 라운드
- `reaper/` — REAPER 라운드와 삭제 전 안전 검사(라운드를 돌리는 타이머는 `orca-plugin/`)
- `session/` — Claude Code hook 의 기록과 `restart_due`·인계
- `recover/` — `recover_plan`(읽기 전용 복구 표)
- `start/` — 세션을 여는 하나의 길(`start_unit`)
- `gates/` — 막는 hook 의 판정 함수
- `migrate/` — 스키마 이행
- `models/` — 역할별 모델 표(결정 164)
- `install/` — `sangsoe install`·`update`·`uninstall`(결정 90)
