# 135. `verify` probe 다섯의 읽기 · `waiting_released` 신호 · 완료 버튼

결정 91①②⑥·92 바로잡는 것 (가)(라) 를 `core/owner/` 로 옮기며 정한 것이다.

- **probe 시그니처.** `readProbe(spec, {orca, gh, budget?}, {run?}) → {kind: true|false|unreadable, observed|why}`. Orca 는 U2 어댑터, GitHub 은 `core/gh` 클라이언트로만 읽는다(값을 읽으므로 ETag 조건부 읽기는 쓰지 않는다).

| kind | 읽는 것 | 참 |
|---|---|---|
| `pr_merged{pr}` | `GET repos/<repo>/pulls/<n>` | `merged: true` |
| `orca_field{target, field, value}` | `task-list --run <Run> --full` 의 그 Task 행 | `status`·`dispatchId`·`assignee`·`result` 중 그 칸이 값과 같음. 다른 칸은 읽지 않음(unreadable) |
| `plugin_approved{key}` | `orca plugin list --json` | 그 키가 `enabled` 이고 `needsReconsent` 가 아님 |
| `run_ok{repo, run}` | `GET repos/<repo>/actions/runs/<run>` | `conclusion: success`. `run` 이 아직 없으면 unreadable |
| `pr_found{repo, search}` | `GET search/issues?q=repo:<repo> is:pr created:>=<항목 생성 시각> <search>` | 한 건 이상. 하한은 표지 시각이 아니다: 훅은 `!` 줄을 다음 턴에야 읽어 표지가 줄보다 몇 분 늦다 |

- **라운드(`probeRound`, 부르는 쪽은 U17 queue-monitor).** 대상은 `verify` 가 있고 probe 가 아직 참이 아닌 오너 항목, 열려 있거나 닫힌 지 `verify.grace_hours` 안인 것. `run_ok`·`pr_found` 는 표지(verifying·unverified)가 있을 때만. `gh_budget` 이 10% 아래(`essential`)면 GitHub 쪽 셋은 읽지 않고 아무것도 쓰지 않는다. 참이면 `evidence{probe:<kind>, observed}` 를 쓰고, 열린 항목이면 `close_suggested{verified}` 를 더한다. 항목은 닫지 않는다(결정 76 의 6번). 거짓·못 읽음은 쓰지 않는다: 못 읽음을 거짓으로 치지 않는다. 표지가 `검증 안 됨` 이 된 항목은 표지마다 한 번 `escalation_stale{verify_unconfirmed}` 를 쓴다.
- **`waiting_released` 신호(`releasesFor`).** 버튼(그 `waiting_human` seq 를 정확히 가리킴, by=button) · `turn_ended` · 도구 이름이 같은 `PostToolUse`(대기 알림에 도구 이름이 없으면 도구 신호는 풀지 않는다) · `agentWait` 해제 · 세션 끝(outcome=moot, evidence `session_ended`|`worker_dead`). `by` 는 대기 뒤 같은 세션(`owner_action.cc_session` = `waiting_human.session`)에 오너의 말이 있으면 owner, 아니면 unknown. 오너의 말 자체는 신호가 아니고 `awaitingResume` 이 `입력 확인됨 · 재개 대기` 를 보일 뿐이다. 신호에 `hostId` 가 있고 `local` 이 아니면 아무것도 쓰지 않는다(92 (라)). `waiting.lead_minutes` 판정(`unreleasedWaits`)은 부르는 쪽이 준 `isLocal(session)` 이 참인 대기만 본다.
- **완료 버튼(`ownerDone`).** 🟢 오너 항목만 받는다. `owner_action{origin: button}`(원문 `완료 iNNN`) → Orca `task-update --status completed` → `item_transition{ready→done, reason: owner_done}` 순서다. Orca 가 실패하면 전이를 쓰지 않고 거부한다. `verify` 가 없으면 `evidence{owner_done}` 가 증거이고, 있는데 probe 가 아직이면 ✅ 🔍(`evidenceShort: true`)이다.
- **`item_create` 의 입력 칸.** MCP `verify`(객체)·`cmdHint`, CLI `--verify <json>`·`--cmd-hint`. Task 를 만들기 전에 계약의 `verifySpec` 으로 검사하고(다섯 밖·필요한 칸 없음 → `invalid_verify`), 만든 뒤 `item_extra_set` 한 줄을 쓴다. 두 입구는 같은 Outcome 이다.
- **설정.** 기본값 `wait_minutes` 30 · `grace_hours` 24 · `lead_minutes` 10 · `show_hours` 24 · `watch_commands` 넷(`OWNER_DEFAULTS`). 설정 파일 읽기는 아직 없어 기본값을 쓴다.
