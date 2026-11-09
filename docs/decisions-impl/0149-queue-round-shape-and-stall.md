# 149. queue 라운드의 모양, `job_drift` 의 비교, `timer_stalled` 의 판정

**라운드.** `queueRound` 는 U15 의 `MONITORS` 표에 한 줄로 들어가 worker 타이머(2분)와 `sangsoe monitor run queue` 가 같이 부른다. 판정은 순수 함수(`judgeQueue`)이고, 규칙을 가진 함수는 다시 쓰지 않고 부른다. `probeRound`·`recordUnreleased` 는 store 의 `append` 만 받으므로 라운드가 모으는 `append` 를 넘겨 그 줄을 `planned` 로 받고, `runMonitor` 가 쓴다(dry run 이면 쓰지 않고 보여 준다). Store 와 Orca 쓰기가 필요한 함수(`syncGraph`·`notifyReady`·`decisionMoot`·`decisionAnswer`·`notify`)는 `MonitorDeps.core` 가 있을 때만 부르고, dry run 에서는 `calls` 에 `would call …` 한 줄로 남긴다. `item_ready` 는 `notifyReady` 가 그 항목의 리드에게 보냈거나 이미 보낸 뒤에만 쓰고, 키의 해시는 `readyNotifiedKey` 의 것을 그대로 쓴다.

**판정 셋.** `todo_due` 는 오너 항목(`readiness` = `owner_ready`)의 날짜 trigger 가 온 것, 키 `todo_due:<task>:<날짜>`. `trigger_unclear` 는 기다리는 Task(`pending`·`ready`)의 trigger 가 날짜도 PR 도 아닌 것, 항목당 한 번(⚠️ 는 이 뜻 하나). 날짜·PR·글의 구분은 GRAPH 의 `triggerKind` 하나로 `triggerOk` 와 같이 쓴다.

**`job_drift`.** `sangsoe doctor` 의 `orca-plugin-version` 점검과 같은 함수(`orcaPluginDrift`)로 설치된 Orca plugin 을 브루 트리(코어 `VERSION`, 켜져 있음, 재승인 대기 없음)와 맞춘다. 어긋남 하나(`expected`·`actual` 쌍)당 한 줄. 내용 해시 비교는 트리를 내려받아야 하므로 `doctor` 에만 남긴다. `plugin list` 를 못 읽으면 행동 0.

**`timer_stalled`.** REAPER 가 쓰는 `reap_round` 행만 읽는다(결정 83). 마지막 `trigger=timer` 행이 간격(`reaperIntervalMinutes`, 기본 15)의 세 배보다 오래되면 그 행의 seq 에, `roots_ok=false` 가 연속 3회면 그 연속의 첫 행 seq 에 키를 묶어 멈춤 하나당 한 줄이다. 행이 하나도 없으면 모름이라 쓰지 않는다. 판정은 타이머 라운드가 아니라 `orca-plugin/stall.ts` 가 Orca 이벤트와 패널 `probe.report` 에서 부르고(한 번에 하나, 1분에 한 번까지), 오케스트레이터에게 `notify:reaper:stalled:<seq>` 로 한 번 알린다.

**모르는 칸.** worker 가 오케스트레이터 Run 을 아는 길이 없어 `MonitorConfig.orchestratorRun` 이 비면 `timer_stalled`·멈춘 전달은 event 만 쓴다. 화면 20줄 발췌(결정 91①)는 Orca 어댑터에 `terminal read` 가 없어 싣지 않고 `unseen` 에 이름을 남긴다. REAPER 간격 기본값은 U18 의 실제 간격이 정해지면 맞춘다.
