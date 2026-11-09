# 129. 현황의 입력과 세 입구(CLI · MCP resource · 패널)

- **Orca 스냅샷 하나.** `loadBriefInput` 은 store 의 event 전부와, U2 어댑터로 읽은 Run 마다 `task-list --full` · `gate-list` 를 `BriefSnapshot` 으로 옮긴다(`readSnapshot`). 캐시하지 않고 sqlite 에 쓰지 않는다. 제목·담당·게이트 질문은 Orca 가 원본이라 스냅샷에서만 읽는다(`BriefTask = ViewTask & {title, assignee}`). Orca 가 실패하면 `orca_error` 로 거부하고 반쪽 표를 그리지 않는다.
- **어느 Run 을 읽나.** `item_created` 에 Run 이 없고 어댑터에 Run 목록이 없다. 그래서 지금 Run(`run-current`) · event 가 이름을 댄 Run(`decision_joined.run` 등) · `--run` 으로 준 Run 을 읽는다. 다른 Run 의 항목은 이름을 대야 보인다(발견으로 넘긴다).
- **`task-list` 의 `deps`.** U2 의 `TaskRow` 에는 `deps` 가 없어 스냅샷의 `deps` 는 비어 있다. 그래서 실제 Orca 에서는 `depsGraph` 가 `blocks` 간선을 못 보고 2단계 그래프는 `edge_added` 만 보인다. U7 의 GRAPH 가 Orca 간선을 읽는 길을 정하면 `GraphRead` 를 바꿔 끼운다.
- **CLI.** `sangsoe brief [<묶음> [<iNNN>]]` · `sangsoe todo` 는 같은 입력과 같은 모델을 쓴다(`todo` 는 1단계 모델의 맨 위 숫자와 앞 두 절). 사람 터미널·시험·CI 를 위해 `--events <jsonl> --orca <snapshot.json> --now <iso>` 로 store 와 Orca 대신 파일을 읽을 수 있다. 이 옵션은 CLI 어댑터와 `loadBriefInput` 에만 있고 `buildBrief` 는 모른다.
- **MCP resource.** `claude-plugin/mcp/resources/brief.ts` 가 `sangsoe://brief` 로 1단계 글을 준다(tool 은 늘리지 않는다, 결정 89 나). 서버는 uri 를 정확히 맞춰 찾으므로 2·3단계 resource 는 resource template 이 서버에 생긴 뒤에 낸다.
- **패널 · 상태 표시줄(U19).** plugin worker 가 `buildBrief` 를 불러 같은 `Overview` 를 그린다. 상태 표시줄 숫자는 `summary.blocked` · `todo.decisions` · `summary.doing` 이다(결정 92⑤).
