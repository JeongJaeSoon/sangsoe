<!-- layout: slot=④ layer=실행 tokens=free -->
# core/store — sqlite event 표와 뷰

`node:sqlite` 로 `~/.local/share/sangsoe/sangsoe.db` 를 연다(PC 마다 하나, 결정 14·88).

- `schema.ts` — append-only `event`, `owner_text`, `counter`·`migration`, 캐시 예외 셋(`pr_ref`·`gh_budget`·`gh_seen`, 만들기만 하고 쓰는 쪽이 없는 예약 표다. 결정 186), 보존 기간 표 `load_sample`(결정 241). 뷰 결과를 저장하는 표는 없다.
- `samples.ts` — resource-monitor 의 라운드 부하 표본: 한 행을 넣고 24시간 된 행을 지운다. `Store.recordLoadSample` 이 같은 트랜잭션에서 부른다. 사본(`facts.jsonl`)에 들지 않는다(결정 241).
- `backup.ts` — sangsoe 만 가진 사실의 사본(결정 183·184): 어느 event type 이 sangsoe 의 것이고(`OWN_TYPES`) 어느 것이 호스트 reader 가 다시 쓰는지(`HOST_TYPES`), `<db>.facts.jsonl` 읽기·쓰기. `Store.open` 이 잃은 파일을 이 사본으로 다시 세우고, 사본이 없던 빌드가 쓴 행을 따라 덧붙인다(결정 192).
- `held.ts` — `holdStore`: 오래 사는 runner(monitor·REAPER)가 쥔 store. 쓸 때마다 파일이 바뀌었는지 보고 다시 연다(결정 191).
- `checks.ts` — 시작 점검: SQLite 하한(결정 35)과 네트워크 파일시스템 거부. `doctor` 가 같은 함수를 부른다.
- `store.ts` — 여는 길 하나(`Store.open`), `append`(검증·`dedupe_key`·전이표), `appendOwnerAction`·`redactOwnerText`, 옛 줄을 올려 읽는 `decodeRow`, 번호 발번.
- `views/` — 계약(`core/contract/views.ts`)의 뷰 중 U1 이 몸체까지 둔 것: `decision`, `item_timeline`.

Orca 가 가진 사실(Task·Dispatch·참조·게이트·메시지)은 여기에 복사하지 않고 id 만 적는다(결정 74).
