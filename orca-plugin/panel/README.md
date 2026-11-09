<!-- layout: slot=② layer=실행 tokens=free -->
# orca-plugin/panel — 실행

지금은 첫 빌드 시험 T3 의 `probe.ts`(html 패널: 인라인 SVG DAG 시안과 worker 프로브 보고)만 있다. 뒤 유닛이 hallmark 시안(`docs/dashboard/hallmark-final/`)대로 패널 세 화면과 상태 표시줄 항목 B 를 둔다(결정 92). 패널은 코어의 읽기 뷰를 그리고, 버튼은 패널 → plugin worker → 코어의 같은 함수로 가서 `owner_action` 을 남긴다. 별도 서버·포트는 없다.
