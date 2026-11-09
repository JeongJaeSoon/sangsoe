<!-- layout: slot=② layer=감지 tokens=free -->
# orca-plugin/monitors — 감지

비어 있다. 뒤 유닛이 plugin worker 의 타이머와 Orca 이벤트로 도는 monitor 다섯(chat-monitor · queue-monitor · resource-monitor · orca-monitor · pr-monitor)과 타이머 멈춤 감지(`timer_stalled`)를 둔다. 한 번 돌 때 읽고 판정해 event 를 쓸 뿐이고, 깨움은 코어 `notify` 가 한다. Orca 자동화·OS 스케줄러는 쓰지 않는다(결정 75 라).
