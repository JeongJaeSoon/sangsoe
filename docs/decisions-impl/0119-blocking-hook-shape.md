# 119. 막는 hook 은 deny·ask 만 쓰고, 시작 가드는 Bash 만 읽으며, 모양 검사의 이름은 `gate_denied.gate` 에 둔다

**allow 를 쓰지 않는다.** 부록 `#gates` 의 합치기는 deny > ask > allow 이고 표 시험(`core/gates/merge.test.ts`)이 그대로 고정한다. 그러나 PreToolUse 출력의 `permissionDecision: "allow"` 는 그 호출을 사람의 권한 규칙보다 먼저 승인한다. 게이트는 "막을 이유가 없다"를 말할 뿐 승인할 근거가 없으므로, 합친 결과가 allow 이거나 의견이 없으면 아무것도 쓰지 않고 0 으로 끝난다.

**실패하면 막는다.** 입력을 읽지 못하면 2 로 끝나고 hooks.json 의 `onFailure: "block"` 이 그 호출을 막는다. 거부를 `gate_denied` 로 남기지 못해도 거부는 그대로이고 사유 끝에 기록 실패를 적는다. 게이트가 물을 사실(열린 PR)을 읽지 못하면 그 게이트는 판정하지 않는다.

**시작 가드(결정 94 마).** 에이전트의 Bash 명령 글만 읽는다. 코어 시작 절차(`start_unit` → `startUnit`, PR #13)가 부르는 Orca 는 MCP 서버 프로세스의 자식이라 PreToolUse 에 보이지 않으므로 표지 없이 통과한다. split §8 Q4 의 "코어 자신의 호출은 환경 표지로 통과" 는 결정 94 (마)가 대체했고 그 문장대로 했다. 스크립트 파일로 감싼 시작은 그 파일을 한 번 읽어 같은 판정을 하고(R-10 의 "다른 경로"), 인터프리터 한 줄(`python3 -c` 등)은 느슨한 패턴으로 본다. 그 너머(변수로 만든 명령, 다른 세션)는 hook 이 못 보며, 단단한 검사는 `unit_lineage_complete` 다.

**거부 메시지의 이름.** 에이전트에게는 MCP tool `start_unit`(`mcp__plugin_sangsoe_sangsoe__start_unit`), 사람에게는 `sangsoe item new`(항목을 만들고 오케스트레이터가 시작한다)를 적는다. 사람이 직접 세션을 여는 `sangsoe` CLI 명령은 설계의 CLI 6행에 없다. 자기 머지 게이트는 설계가 정한 `sangsoe land`·MCP `land`(U11)를 가리킨다.

**`gate_denied` 의 사유.** 용어집은 `report_address` 를 `gate_denied` 의 사유 값이라 하지만 event 정의(`core/contract/events/gate_denied.ts`)에는 `gate`·`command_file` 두 칸뿐이다. 계약은 이 단위의 범위 밖이라 칸을 더하지 않고 `gate` 에 `report-address` 를 쓴다. 다음에 계약을 고치는 단위가 `reason` 칸을 더하면 이 값을 그리로 옮긴다.

**역할.** `agent_type` 이 `sangsoe:orchestrator|lead|worker` 면 그 역할, 아니면 transcript 첫 사용자 메시지가 Orca 의 Dispatch 머리말이면 워커, 그 밖은 일반(사람이 연 세션)이다. 일반 세션에는 시작 가드·모양 검사·sleep-loop·pressure 만 걸린다.

**아직 없는 것.** 압박 게이트의 기다림 순서(대기열)는 없다: 거부는 "부하가 내려가면 다시"만 말한다(U15 와 함께 다시 본다). port-plan 의 위험 명령(`lib/danger`)·스택 게이트는 이 단위에 넣지 않았다.
