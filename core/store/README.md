<!-- layout: slot=④ layer=실행 tokens=free -->
# core/store — sqlite event 표와 뷰

`node:sqlite` 로 `~/.local/share/sangsoe/sangsoe.db` 를 연다(PC 마다 하나, 결정 14·88).

- `schema.ts` — append-only `event`, `owner_text`, `counter`·`migration`, 캐시 예외 셋(`pr_ref`·`gh_budget`·`gh_seen`). 뷰 결과를 저장하는 표는 없다.
- `checks.ts` — 시작 점검: SQLite 하한(결정 35)과 네트워크 파일시스템 거부. `doctor` 가 같은 함수를 부른다.
- `store.ts` — 여는 길 하나(`Store.open`), `append`(검증·`dedupe_key`·전이표), `appendOwnerAction`·`redactOwnerText`, 옛 줄을 올려 읽는 `decodeRow`, 번호 발번.
- `views/` — 계약(`core/contract/views.ts`)의 뷰 중 U1 이 몸체까지 둔 것: `decision`, `item_timeline`.

Orca 가 가진 사실(Task·Dispatch·참조·게이트·메시지)은 여기에 복사하지 않고 id 만 적는다(결정 74).
