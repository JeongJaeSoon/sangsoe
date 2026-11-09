# 100. CI 는 작업 셋(`typecheck`·`lint`·`unit`)이고 PR 과 main push 에서 돈다

`unit` 이 시험 뒤 빌드와 `dist/cli/main.js --version` 까지 돌리고, 선언한 최소 버전(Node 24.2.0)에서 돈다. 그래서 그보다 새 API 를 쓰면 `unit` 이 깨진다. `typecheck`·`lint` 는 Node 24 최신에서 돈다.

금지어 검사는 CI 에 넣지 않는다: 금지어 목록은 전환 직전에 저장소 밖에 둔다(결정 74 의 O-4).
