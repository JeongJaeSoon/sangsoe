# 108. Claude Code 쪽 등록은 브루 트리를 가리키는 경로 마켓플레이스 하나로 하고, 대체 길은 두지 않는다

결정 90 이 미확인으로 남긴 첫째 항목(경로 마켓플레이스에서 `claude plugin install` 이 되는지)을 T6 에서 실행해 닫았다. `claude plugin marketplace add <트리> --scope user` 와 `claude plugin install sangsoe@sangsoe --scope user` 가 그대로 되고, `claude plugin list --json` 의 항목에 `version`·`readFromFolder`(마켓플레이스가 가리키는 폴더)·`folderVersion` 칸이 있다. 그래서 계획(split §8 Q8)이 실패할 때 쓰려던 대체 — 사용자 쓰기 가능한 로컬 사본 마켓플레이스로 물러나기 — 는 만들지 않았다. 사본은 브루 트리와 같은 사실을 한 번 더 저장하는 길이라 이중 저장 금지(결정 74)와도 부딪친다.

마켓플레이스 이름과 plugin 이름은 둘 다 `sangsoe` 이고 plugin id 는 `sangsoe@sangsoe` 다. `sangsoe install` 은 같은 이름의 마켓플레이스가 다른 경로를 가리키면(개발 체크아웃에서 한 번 깔았던 경우) 지우고 브루 경로로 다시 더한다.

등록은 `CLAUDE_CONFIG_DIR` 마다 따로다: 그 변수가 다른 Claude Code(예: Orca 가 띄운 프로파일)에서 돌린 `sangsoe install` 은 그 설정 디렉터리에만 등록된다. `doctor` 는 검사한 `CLAUDE_CONFIG_DIR` 를 출력에 적는다.

다시 볼 조건: `claude plugin install` 이 경로 마켓플레이스를 거부하거나, `brew upgrade` 뒤 `marketplace update` + `plugin update` 로 새 버전이 오지 않는 것이 관측될 때.
