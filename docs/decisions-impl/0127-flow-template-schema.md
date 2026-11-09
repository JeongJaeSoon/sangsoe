# 127. 흐름 틀은 TOML 부분집합 하나, 한 번에 펼친다

부록 "흐름 틀 형식"을 U7 에서 코드로 옮기며 정한 것이다.

- **파서는 직접 쓴 부분집합이다.** 런타임 의존을 두지 않는다(결정 원칙). 받는 것: `key = value`, `[table]`·`[a.b]`·`[[steps]]` 머리, 큰따옴표 문자열·정수·`true`/`false`·한 줄 배열·한 줄 인라인 표, `#` 주석. 여러 줄 문자열·날짜·점 찍힌 키 대입·같은 키 두 번은 줄 번호와 함께 `bad_template` 으로 거부한다.
- **스키마.**

  ```toml
  name = "ship-change"          # 소문자·숫자·-
  version = 1                   # 정수
  title = "… {repo}"            # 루트 항목 제목, {var} 치환

  [vars.<name>]
  required = true               # 없으면 거부
  default = "…"                 # 선택
  enum = ["a", "b"]             # 선택, 밖의 값 거부

  [[steps]]
  id = "impl"                   # 틀 안에서 유일
  title = "…"                   # 기본은 id
  done_when = "…"               # 필수
  needs = [{ step = "<id>", kind = "blocks|after|stacked_on|deploys_after" }]
  stage = "merge|dev|prod"      # deploys_after 가 기다리는 단계 기록
  gate = "owner|timer|ci|pr"    # owner 는 who = "owner" 와 why_owner 필수, timer·pr 는 trigger 필수
  trigger = "<ISO 날짜>|<owner/repo#N>"
  blocks_on_var = "<var>"       # 쉼표로 나눈 기존 항목들을 blocks 로 받는다(ship-batch 의 members)
  ```

  모르는 var 를 넘기거나, 쓰인 var 가 없거나, `needs` 가 없는 단계를 가리키거나 순환을 이루면 거부한다.
- **찾는 곳.** `~/.config/sangsoe/flows/<name>.toml` 이 기본 틀(`core/graph/flows/`)보다 앞선다.
- **한 번에 펼친다.** `needs` 의 `blocks` 와 `blocks_on_var` 항목은 만들 때 Orca `--deps` 로, 나머지 종류는 단계를 다 만든 뒤 `graph add` 와 같은 길(`addEdgeTo`)로 쓴다. 단계는 위상 순서(같으면 틀 순서)로 만든다. 펼친 결과는 다시 펼치지 않는다(단계 안에 틀이 없다).
- **`--dry-run`** 은 `planFlow` 결과(단계·dep·간선·오너 단계)만 돌려주고 아무것도 쓰지 않는다. CLI 와 MCP `flow_expand` 가 같은 결과를 낸다.
- **이어 펼치기와 `flow_gap`.** 요청 id 가 필수다. 같은 요청 id 로 다시 부르면 이미 만든 루트·단계를 찾아 이어서 만든다. `flow_expanded` 를 단계보다 먼저 쓰므로(결정 126) 끊긴 펼치기는 `flowGap` 이 빠진 단계를 돌려주고, `doneBlockers` 가 그 루트를 `flow_gap: <step>` 으로 ✅ 에서 막는다.
