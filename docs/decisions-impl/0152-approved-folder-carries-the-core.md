# 152. 릴리스는 worker 가 돌리는 코어를 승인 폴더 안(`orca-plugin/vendor/`)에 싣고, 설치 트리의 worker 는 그 사본만 연다

결정 132 의 남는 틈을 닫는다. 그때까지 설치 트리의 worker 는 폴더 옆의 `../dist/core/index.js` 를 열었고, `approve` 와 doctor 의 `orca-plugin-content`(결정 105·112)가 재는 내용 해시는 `orca-plugin/` 만 덮었다. 그래서 승인 뒤 `libexec/dist/core/` 를 고치면 worker 는 리뷰되지 않은 코어를 돌리고 doctor 는 `ok` 였다.

- **싣는 것.** `npm pack` 의 `prepack`(`scripts/stage-core.ts`)이 `core/`(`*.test.ts` 제외, `graph/flows/*.toml` 같은 비 TS 파일 포함)와 뿌리 `package.json` 을 `orca-plugin/vendor/` 아래로 복사하고, `postpack` 이 지운다. `package.json` 은 `core/version.ts` 가 `../package.json` 을 import 하기 때문이고, 그래서 사본이 폴더 바로 아래가 아니라 `vendor/` 한 단계 아래다(폴더 뿌리에 `package.json` 을 두지 않는다). 컴파일된 `dist/core` 가 아니라 TS 소스를 싣는다: worker 의 Node 가 타입을 지우고(결정 132, T1), 리뷰된 트리에도 같은 소스가 있어 빌드 없이 바이트로 비교된다. `orca-plugin/vendor/` 는 `.gitignore`·`tsconfig`·`biome` 에서 뺀다.
- **비교하는 것.** `approve` 와 doctor 는 리뷰된 커밋의 tarball 을 받은 뒤 같은 함수 `stageCore`(`core/install/stage.ts`)로 그 트리에 사본을 만들고 나서 `orca plugin inspect` 로 잰다. 그래서 승인된 내용 해시는 폴더의 Orca 코드와 worker 가 여는 코어 전부를 덮는다. 사본을 만들지는 빌드의 출처가 정한다: 폴더를 추적하는 git checkout 이면 만들지 않고(Orca 가 dev load 하는 것이 git 트리 그대로다), 아니면(`build-info.json` 의 릴리스) 만든다. 폴더에 `vendor/` 가 있는지로 정하지 않는다: 그것은 승인 뒤에 바뀔 수 있는 바로 그 내용이다. Orca 1.4.250 에서 확인: 중첩 폴더의 파일 하나를 바꾸면 `contentHash` 가 바뀌고, 로컬 `npm pack` 한 폴더와 `git archive HEAD` 를 `stageCore` 한 폴더의 `contentHash` 가 같다.
- **여는 것.** `orca-plugin/core-link.ts` 는 `./vendor/core/index.ts` 가 있으면 그것만 연다. 없으면 폴더 옆에 `.git` 이 있는 checkout 에서만 `../core/index.ts` 를 열고, 그 밖에서는 아무것도 열지 않아 worker 가 monitor 없이 돈다(결정 132 의 실패 꼴 그대로). `../dist/core/index.js` 후보는 지웠다: 설치 트리에서 해시 밖이다. 사본을 지우고 옆에 코어를 심어도 열리지 않고, 그 폴더는 리뷰된(사본이 있는) 트리와 해시가 달라 doctor 가 `FAIL` 이다.
- **시험.** `test/orca-plugin.test.ts` 가 설치 트리 fixture(`build-info.json`, 옆의 `core/`·`dist/core/`, 폴더 안의 사본)에서 사본만 고르고, 사본이 없으면 옆의 코어가 아니라 `null` 임을 본다(고치기 전에는 `dist/core/index.js` 를 골라 실패했다). `core/install/stage.test.ts` 는 실제 `core/` 를 복사한 트리를 `stageCore` 하고 `core-link` 가 고른 사본을 import 해 `openMonitors`·`openPanelCore` 가 있음을 본다. `core/approve/approve.test.ts` 는 릴리스 빌드가 사본을 만든 트리와, checkout 빌드가 그대로의 트리와 비교됨을 본다. 릴리스 워크플로의 smoke 단계가 풀어 놓은 자산에 사본이 있고 그 `package.json` 이 태그의 것과 같으며 checkout 에 사본이 남지 않았음을 확인한다.

버린 안: (가) 두 트리 지문 — `orca-plugin/` 해시에 `dist/core` 해시를 더해 doctor 가 보는 것. 설치된 것은 `tsc` 출력이고 리뷰된 트리는 TS 소스라, 비교하려면 approve·doctor 가 리뷰된 트리를 `npm ci`·빌드해야 하고(같은 컴파일러 버전이어야 바이트가 같다) Orca 가 주는 해시 하나로 끝나지 않는다. 또 Orca 가 승인한 폴더 밖의 코드를 worker 가 여는 구조는 남는다. (나) 폴더 안의 `core` 심볼릭 링크 — `npm pack` 과 Orca 해시가 링크를 어떻게 다루는지에 기대고, 링크 대상은 다시 폴더 밖이다.

남는 틈은 결정 105·122 그대로다: 같은 사용자 권한으로 승인 뒤 Cellar 폴더를 고치면 Orca 는 다시 묻지 않고, doctor 가 그 차이를 `FAIL` 로 드러낼 뿐 이미 돈 코드를 되돌리지 못한다. 이제 그 문장이 worker 가 돌리는 코어까지 포함한다.

다시 볼 조건: 코어가 런타임 의존(`node_modules`)을 갖게 되거나, Orca 가 plugin 폴더를 다른 곳으로 복사해 돌리거나, 번들(결정 109)을 들일 때.
