<!-- layout: slot=② layer=감지 tokens=free -->
# orca-plugin/monitors — 감지

monitor 하나 = 파일 하나: 이름 · 주기 · 시간 상한(`orca.ts` · `resource.ts` · `chat.ts`). 무엇을 읽고 무엇을 쓰는지는 코어 `core/detect/` 의 같은 이름 함수이고, `spec.ts` 가 그것을 타이머 `Round` 로 감싼다. 라운드 틀(주기 · 단일 실행 · 힌트 디바운스 · 시간 상한)은 `../timer.ts`, 코어에 닿는 길은 `../core-link.ts` 하나다(결정 132·133). 한 번 돌 때 읽고 판정해 event 를 쓸 뿐이고, 깨움은 코어 `notify` 가 한다. Orca 자동화·OS 스케줄러는 쓰지 않는다(결정 75 라). queue-monitor · pr-monitor 와 타이머 멈춤 감지(`timer_stalled`)는 뒤 유닛 몫이다.
