# 97. 배치는 칸이 최상위인 한 패키지다

`core/`·`cli/`(④) · `orca-plugin/`(②) · `claude-plugin/`(③) 이 최상위이고, 층과 토큰은 하위 폴더로 가른다. 표는 `../architecture.md`. 각 폴더 README 첫 줄의 표지와 `test/layout.test.ts` 가 표·토큰 구분·`core/index.ts` 외 import 금지를 검사한다.

대안: npm workspaces 네 패키지(버전·설정이 네 벌), 최상위를 토큰으로 가름(③ 이 두 뿌리로 찢어짐).
