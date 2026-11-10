<!-- layout: slot=② layer=실행 tokens=free -->
# orca-plugin/panel — 실행

html 패널 하나(`index.ts` · `view.ts` · `style.ts`)와 worker 쪽 요청 처리(`requests.ts`)다. 모양은 hallmark 시안(`docs/dashboard/hallmark-final/`, 결정 92)이고, 배치와 밀도는 Orca 자신의 패널을 따른다(결정 169): 머리 행, 1단계의 탭 `전체 · 할 일 · 진행 중`, 건수 0 인 절은 한 줄, 색은 Orca 가 주는 `--orca-*` 변수. 상태 표시줄 항목 B 의 글은 코어 `statusBarItem` 이 만든다(결정 170).

패널은 코어의 읽기 뷰를 그리고, 버튼은 패널 → plugin worker → 코어의 같은 함수로 가서 `owner_action` 을 남긴다. 머리 행의 터미널 버튼(`panel.open`)은 worker 가 닫힌 목록에서 만든 `sangsoe brief`·`todo`·`doctor` 를 `orca terminal create` 로 띄운다. 별도 서버·포트는 없다.
