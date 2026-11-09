<!-- layout: slot=④ layer=실행 tokens=free -->
# core — ④ 공유 코어 · 실행 · 토큰 X

두 plugin·MCP 서버·CLI·plugin worker 가 같이 부르는 TS/Node 판단 함수와 sqlite 다(결정 77 가·78). 다른 칸은 `core/index.ts` 로만 들어온다.

지금 있는 것: `version.ts`(버전 문자열 하나, `package.json` 이 원본).

뒤 유닛이 채울 자리(지금은 비어 있다):

- GRAPH — 간선의 유일한 입구, `ready` 뷰, `capacity`, 크리티컬 패스
- land 판정 함수 · 검증 등급(`verify_tier`) · verify probe 판정
- 결정 함수: `decision_open` · `decision_answer`(Orca `gate-resolve` 를 부른다) · `notify`
- REAPER 의 삭제 전 안전 검사(라운드를 돌리는 타이머는 `orca-plugin/reaper/`)
- `restart_due` · `recover_plan` · 시작 점검(`doctor` 와 같은 함수)
- 흐름 틀 펼치기(저장소에 실린 기본 틀)
- `store/` — sqlite event 표와 뷰
- `orca/` — Orca CLI 어댑터(Orca 가 원본인 값은 id 로만 읽는다)
- `install/` — `sangsoe install`·`update`·`uninstall`(결정 90)
