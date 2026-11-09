# 142. pr-monitor 의 Task 닫기 길, PR↔Task 연결, 라운드의 Orca 쓰기

**PR↔Task 는 Orca 참조에서 읽는다.** `reference find <PR URL> --json` 의 `matches[]` 가운데 로컬(`workspace.hostId` 가 `local` 이거나 없음)이고 보관되지 않은 워크스페이스가 있으면 "연결됨"이다(결정 80 N7, `linked_only`). 그 워크스페이스의 `agents[].mailbox` 가 `dispatch:<id>` 이면 `worker-show` 로 `taskId`·`runId` 를 얻는다. 실제 Orca 의 읽기로 꼴을 확인했다(PR 하나에 워크스페이스 하나, `origins.kind: observed` — Orca 가 터미널 출력에서 PR 을 스스로 붙인다). sqlite 에는 연결 사본이 없고 `pr_opened.task` 만 남는다(결정 33·64 의 `pr_ref`).

**PR 항목의 Task.** `pr_opened` 가 처음 기록한 `task` 가 우선이고(뒤에 다른 워크스페이스가 유일한 연결이 되어도 넘기지 않는다), 없으면 연결된 Task 가 정확히 하나일 때 그것이다. 둘 이상이면 아무것도 닫지 않고 `unseen` 에 남긴다(모르면 행동 0). `pr_opened` 는 연결된 Task 가 하나로 정해질 때 그 `task` 를 담아 쓰고(`pr_opened:<pr>:<task>`), 범위 안이지만 Task 를 모를 때는 `task` 없이 한 번(`pr_opened:<pr>`) 쓴다. 이미 머지된 채 처음 본 연결된 PR 에도 `pr_opened` 를 쓴다: land 의 stack 점검과 brief 의 PR 행이 이 줄로 PR 과 Task 를 잇기 때문이다. `pr_opened` 에 선택 칸 `base`·`head_sha` 를 더했다(처음 본 PR 상태, `pr_base_changed` 의 비교 기준). GitHub 의 사실이고 Orca 가 가진 사실이 아니다.

**Task 닫기 길(T5).** 시험 T5 의 "머지 대기 보고(`merge_ready`)로 끝낸 Task 가 열린 채 남는가"는 미실행으로 기록돼 있다(`docs/test-outcomes.md`, 워커 세션은 Run 을 쓰지 못함). 설계의 기본 가정(Auto-close 는 받아들여진 `worker_done` 에만 걸린다, design 흐름 3)을 따라 **하위 Task 를 만들지 않고 PR 항목의 Task 를 직접 닫는다.** 닫기 전에 `task-list --run` 으로 상태를 읽어 이미 `completed`·`failed` 이면 쓰지 않으므로, T5 가 "Orca 가 먼저 닫는다"로 나와도 이 길은 행동 0 이 될 뿐 잘못 쓰지 않는다. 다시 볼 조건: T5 를 Run 을 쥔 세션에서 재서 `merge_ready` 뒤 Task 가 닫힌다고 나오면(✅ 가 머지 전에 뜬다) 머지 확인 하위 Task 길로 바꾼다.

**같은 라운드, 순서.** `merge_confirm` 이 참이면 `pr_merged` 를 쓰고, 그 다음 `task-update <task> --status completed --run <run>`, 그 다음 `item_transition`(읽은 상태 → `done`, 전이표가 허락할 때만)이다. 라운드는 Orca 쓰기를 `Reading.acts` 로 돌려주고 `runMonitor` 가 계획한 event 를 쓴 뒤 순서대로 실행한다. `append` 가 없는 dry run 과 시간 상한을 넘긴 라운드는 실행하지 않고 보고에 `ok: null` 로만 남긴다. 다른 monitor 는 `acts` 를 쓰지 않아 그대로다. `task-update` 가 실패하면 다음 라운드가 그 PR 이 최근 닫힌 목록(30)에 있는 동안 다시 읽고 시도한다.

**그 밖의 Orca 쓰기.** (1) `reference add`: 열린 PR 의 head 브랜치가 로컬 워크스페이스 하나와 같은데(Orca 는 `refs/heads/x`, GitHub 은 `x` 로 적는다. Orca 의 repo id 는 GitHub 저장소를 말하지 않으므로 fork 의 head 와 base 와 같은 이름의 head 는 맞추지 않는다) Orca 가 아직 연결하지 않았을 때만 그 워크스페이스(`id:<worktreeId>`)에 붙인다. `linked_only` 에서는 이 경우도 범위 안으로 친다(붙이면 다음 라운드부터 Orca 연결로 읽힌다). (2) `pr_ready_to_merge` 의 깨움: notify 로 그 Task 의 Run(`run:<runId>`, 소유 리드)에 한 번. 작성자는 이미 `merge_ready` 로 끝났으므로 사슬에 Dispatch 를 넣지 않는다. Run 을 모르면 `unseen` 이다.

**오너 직접 머지(결정 92 (나)).** `merged_by` 가 설정 `owners` 에 있고 그 PR 에 `land_requested` 가 없으면 `pr_merged.actor = owner:<login>` 이고, 연결된 Task 가 없으면 `owner_act_unlinked{act: "merged <pr>"}`(키 `owner_act_unlinked:<pr>:merged`, hook 의 `owner_act:<uuid>` 와 다른 키)를 쓴다. `decision_answered{linked_by: observed}` 는 그 `pr_merged` 의 seq 를 `owner_action` 으로 받는 U8 의 `decision_answer` 몫이다.

**범위 밖에 둔 것.** design 의 pr-monitor 행 가운데 `pr_review_requested` · `pr_changes_requested` · `review_commented` · `review_replied` 와 GitHub 알림 읽기는 이 유닛 수락(1–7)에 없어 만들지 않았다.
