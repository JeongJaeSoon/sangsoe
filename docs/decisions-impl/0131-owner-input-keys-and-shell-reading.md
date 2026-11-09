# 131. 오너 입력의 키와 `!` 명령 읽기

결정 91 ④ 의 `!` 입력 읽기와 대기 풀기를 구현하면서 정한 것이다.

- **키는 타입 접두어로 다시 쓴다.** 저장소는 dedupe 키가 자기 타입 이름으로 시작해야 받는다. 설계의 `owner_act:<uuid>` 는 `owner_action:<session>:<uuid>`(입력), `evidence:<uuid>:owner_act`(표시), `owner_act_unlinked:<uuid>` 로 나눴다. 채팅 입력은 `owner_action:<session>:<prompt_id>`, 대기는 `waiting_human:<session>:<n>`, 풀기는 계약대로 `waiting_released:<seq>` 다.
- **transcript 에는 종료 코드가 없다.** P13: `!` 입력은 내용이 `<bash-input>…</bash-input>` 인 user 기록이고, 그 자식(`parentUuid`)이 `<bash-stdout>…</bash-stdout><bash-stderr>…</bash-stderr>` 를 담는다. 종료 코드는 어디에도 없다. 그래서 결정 91 ④(나)를 쓴다: stderr 가 비어 있지 않으면 `owner_act:failed`, stdout 에 URL 이 있으면 `owner_act:seen`(`observed` 는 그 URL), 둘 다 아니면 표시하지 않는다. 출력이 아직 없는 입력은 다음 hook 에서 다시 본다.
- **읽는 위치를 저장하지 않는다.** UserPromptSubmit·Stop·SessionEnd 마다 transcript 꼬리(256 KiB)를 다시 읽고 키가 중복을 흡수한다. 읽을 수 없는 형식이면 아무 행도 쓰지 않는다.
- **항목 짝짓기.** 열린 항목(마지막 `item_transition` 이 done·cancelled 가 아닌 것)의 마지막 `cmd_hint` 의 모든 단어가 명령에 있고, 입력 시각이 그 hint 가 처음 붙은 시각 이후일 때 맞는다. 정확히 하나가 맞을 때만 표시한다. 하나도 안 맞고 명령이 감시 목록(`gh workflow run` · `gh pr merge` · `gh release` · `sangsoe plugin approve`)이면 `owner_act_unlinked`. 상태는 바꾸지 않는다(오너 입력만으로 상태가 바뀌지 않는다).
- **대기 풀기는 세션이 움직였을 때만.** 오너의 말은 풀지 않는다. 같은 tool 의 PostToolUse → `answered`, Stop → `answered`(근거 `turn_ended`), SessionEnd → `moot`. `by` 는 그 세션에서 대기 뒤에 쓴 `owner_action` 이 있으면 `owner`, 없으면 `unknown`.
- **dNNN 연결.** 채팅 한 줄에 존재하는 `dNNN` 이 정확히 하나면 U8 의 `decisionAnswer` 를 `linked_by: "hook"` 으로 부른다. `iNNN` 만 있으면 연결하지 않는다. Orca 가 넣는 dispatch 머리말은 오너의 말이 아니라 건너뛴다.
- **P12 대체.** Notification(권한 묻기)은 `-p` 모드에서 나오지 않아 재지 못했다. `notification_type` 이 `permission_prompt`·`idle_prompt`·`elicitation_dialog` 이거나 메시지가 권한·입력 대기를 말하면 대기로 본다. 실제 세션에서 다르면 리드 알림(결정 91 의 되돌아갈 곳)이 남는다.
