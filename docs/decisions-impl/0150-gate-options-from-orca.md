# 150. 게이트의 선택지는 Orca 의 gate-list 에서 매번 읽는다

**어긋났던 것.** 결정 91 의 "추천대로 답" 버튼(0136)은 결정 행의 `추천` 칸이 비어 있지 않을 때만 켜진다. 그 칸은 게이트 선택지의 첫째다. 그런데 `readSnapshot`(core/brief/load.ts)과 `GateRow`(core/contract/orca.ts)는 선택지를 싣지 않아서, 실제 Orca 에서는 버튼이 늘 꺼져 있었다. `--orca` 스냅샷 파일로만 켜졌다.

**Orca 가 주는 모양.** `orchestration gate-list --run <id> --json` 의 `result.gates[]` 한 행은 `id` · `taskId` · `status` · `question` · `options` 를 가진다. `options` 는 배열이 아니라 `gate-create --options` 에 준 JSON 배열을 그대로 담은 문자열이다(`--full` 도 같다). 추천을 따로 가리키는 필드는 없다.

**정한 것.**
- 어댑터(`gateList`)가 `options` 문자열을 JSON 으로 읽어 `GateRow.options: string[]` 로 넘긴다. 문자열 배열이 아니거나 읽히지 않으면 필드를 두지 않는다(모름).
- `readSnapshot` 은 첫째 선택지가 비어 있지 않을 때만 `BriefGate.options` 를 싣는다. 추천은 지금처럼 첫째 선택지다.
- 버튼은 추천이 있을 때만 켜진다. 선택지가 없음 · 빈 배열 · 읽히지 않음 · 첫째가 빈 글이면 꺼지고, 눌러도 `no_recommendation` 으로 거절된다.
- 선택지는 Orca 의 것이다(결정 74). sangsoe 는 브리프를 그릴 때마다 읽고 store 에 사본을 두지 않는다.

**시험.** `core/orca/adapter.test.ts` 가 문자열·빈 배열·JSON 아님·문자열 아닌 원소·null 을, `test/panel/panel.test.ts` PN4 live 가 가짜 Orca(`test/decision/world.ts`, gate-list 가 실제처럼 문자열을 돌려준다)로 켜짐 · 선택지 없음 · 읽히지 않음을 본다.
