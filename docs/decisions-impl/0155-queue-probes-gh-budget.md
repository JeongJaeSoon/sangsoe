# 155. queue-monitor 의 probe 도 `gh_budget` 을 따른다

**규칙.** queue 라운드는 runner 의 `ghBudget()`(pr-monitor 와 같은 클라이언트 캐시, 결정 143)을 `probeRound` 의 `budget` 으로 넘긴다. 한도 판정은 `core/gh` 의 `budgetLevel` 하나다: 10% 아래(`essential`)면 gh 를 읽는 probe(`pr_merged`·`run_ok`·`pr_found`)는 읽지 않고 `skipped` 로 센다. Orca 를 읽는 probe(`orca_field`·`plugin_approved`)는 그대로 읽는다.

**30% 아래(`slow`)는 줄이지 않는다.** pr-monitor 의 `slow` 는 다시 매기기(diff·라벨 이벤트)를 건너뛰지만, queue 의 gh probe 는 결정 91②·92(가)가 이미 "표지가 달린 항목에 한해 라운드마다 항목당 한 번" 으로 좁힌 읽기라 더 건너뛸 것이 없다. 건너뛰면 오너가 한 일의 확인이 늦어질 뿐 한도는 거의 그대로다.

**왜.** U16 이 만든 한도는 pr 라운드만 보았고 queue 라운드는 `budget` 을 넘기지 않아, 한도가 바닥이어도 probe 가 gh 를 읽었다. `probeRound` 에 판정이 이미 있었으므로 값을 넘기는 것으로 끝냈다(규칙의 두 번째 사본을 쓰지 않는다).

**REAPER 간격.** `reaperIntervalMinutes` 기본값은 U18(REAPER)의 실제 라운드 간격(`orca-plugin/reaper/round.ts` 의 10 분, 결정 144)에 맞춰 10 이다. 두 값이 같다는 것은 `test/orca-plugin.test.ts` 가 확인한다.
