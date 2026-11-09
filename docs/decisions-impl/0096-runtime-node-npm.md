# 96. 런타임은 Node 24.2 이상, 패키지 관리자는 npm 이다

설계가 정한 것: 코어는 TS/Node 하나(결정 77 가), sqlite 는 Node 내장 `node:sqlite`, Orca plugin worker 는 `.js`·`.ts` 를 돌린다. 설계가 정하지 않은 것을 여기서 정한다.

24.2 는 `node:sqlite` · 소스 `.ts` 의 타입 제거 실행 · `import.meta.main` 이 모두 기본으로 되는 첫 줄이고, Homebrew 의 `node` formula 가 이를 채운다. npm 은 Node 와 함께 오므로 formula 의 의존이 `node` 하나로 끝난다.

대안: pnpm(속도는 낫지만 formula 가 의존을 하나 더 갖는다) · Bun(`bun:sqlite` 는 설계의 `node:sqlite` 와 다르고 Orca worker 가 돌리는 런타임과 갈린다) · 한 파일 실행본(Node SEA·`bun build --compile`). 한 파일 실행본은 버렸다: 브루가 깔아야 하는 것은 실행 파일 하나가 아니라 매니페스트 둘·skill·패널 파일이 든 트리이고(결정 90), worker 가 코어를 JS 로 import 해야 하므로 실행본이 트리를 줄이지 못한다. 22.x 를 하한으로 두는 안은 `import.meta.main` 과 기본 타입 제거가 없어(또는 늦은 패치에만 있어) 시험이 소스를 그대로 돌리지 못한다.
