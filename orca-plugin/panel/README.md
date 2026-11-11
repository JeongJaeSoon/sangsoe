<!-- layout: slot=② layer=실행 tokens=free -->
# orca-plugin/panel — 실행

html 패널 하나(`index.ts` · `view.ts` · `style.ts` · `refresh.ts`)와 worker 쪽 요청 처리(`requests.ts`)다. 모양은 hallmark 시안(`docs/dashboard/hallmark-final/`, 결정 92)이고, 배치와 밀도는 Orca 자신의 패널을 따른다(결정 169): 머리 행, 1단계의 탭 `전체 · 할 일 · 진행 중`, 건수 0 인 절은 한 줄, 색은 Orca 가 주는 `--orca-*` 변수. 상태 표시줄 항목 B 의 글은 코어 `statusBarItem` 이 만든다(결정 170).

패널은 코어의 읽기 뷰를 그리고, 버튼은 패널 → plugin worker → 코어의 같은 함수로 가서 `owner_action` 을 남긴다. 머리 행의 터미널 버튼(`panel.open`)은 worker 가 닫힌 목록에서 만든 `sangsoe brief`·`todo`·`doctor`·`models` 를 `orca terminal create` 로 띄운다. 별도 서버·포트는 없다.

다시 읽기(결정 198, 205, `refresh.ts`): worker 가 코어의 `watchStore` 로 저장소의 새 seq 를 받아 `orca.panels.post("store.changed")` 로 보내면, 패널은 2초 창의 알림을 모아 한 번 읽는다. 30초 주기와 다시 보일 때의 읽기는 Orca 만 바뀐 것을 위해 남는다. `panels.post` 가 없는 Orca 에서는 30초 주기만 돈다.
