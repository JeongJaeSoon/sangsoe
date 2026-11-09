<!-- layout: slot=④ layer=실행 tokens=free -->
# core/approve — 실행

`sangsoe plugin approve` 의 코어 함수(결정 77 다, 78 가의 ④ 조각). 세 조건을 검사하고 모두 통과할 때만 `orca plugin enable <key> --approve <지문>` 을 부르며 `plugin_approved` 를 남긴다(결정 0104). 저장소에서 이 명령을 부르는 곳은 여기 하나이고 `test/approve-only.test.ts` 가 지킨다.

- `approve.ts` — 판정과 순서. 신뢰 기준(저장소·키)은 여기 상수이고 승인할 폴더에서 읽지 않는다. 읽기 전용 검사가 모두 통과한 뒤에만 Orca 에 손댄다. 호스트(Orca CLI·`gh`·리뷰 증거·event 기록)는 `ApprovePorts` 로 주입한다.
- `ports.ts` — 실제 포트와 빌드 커밋 찾기(그 폴더를 추적하는 깨끗한 git checkout 이면 HEAD, 아니면 plugin 폴더 옆 `build-info.json`(릴리스가 쓴다). 폴더를 무시하는 저장소 안에 있을 뿐이면(Homebrew prefix) git 은 보지 않는다. 읽지 못하면 커밋이 없다고 한다).
- `plugin-approved.ts` — event 타입. U1 의 계약 폴더가 생기면 그리로 옮긴다.

조건 (2) 를 지문이 아니라 폴더 내용 해시로 읽는 이유는 결정 0105.
