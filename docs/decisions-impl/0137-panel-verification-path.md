# 137. 패널을 재는 길(T3 2차, U19)

- **그리는 함수는 순수하다.** `orca-plugin/panel/view.ts` 의 `renderStage(view, crumbs)` 가 HTML 글을 돌려주고, entry(`panel/index.ts`)는 그것을 `#root` 에 넣고 클릭을 `plugin.request` 로 바꿀 뿐이다. 그래서 세 단계 내려가기 · 뒤로 · 버튼 · 행 ID 는 node 시험으로 잰다(`test/panel/panel.test.ts`).
- **`orca plugin test` 는 저장소 뿌리에서.** 이 명령은 준 폴더 밖 import 를 막는다(`test/panel` 에서 돌리면 `cannot import "../../core/index.ts": it is outside the plugin`). 시험 파일을 `orca-plugin/` 에 두면 설치본(`*.test.ts` 를 뺀 tarball)과 내용 해시가 어긋나므로 두지 않는다. 그래서 `orca plugin test .`(저장소 뿌리, Orca 가 싣는 그대로 transpile 해 전체 시험)를 돌린다.
- **Orca 안 화면은 재지 않았다.** `orca plugin shot --act` 는 html 패널을 거부하고, 이 Mac 의 `local.sangsoe` 는 오너의 개발 폴더가 돌고 있어 이 작업 트리를 올리면 그것을 바꿔 끼운다(승인 범위 밖). 같은 `STYLE` 과 `renderStage` 를 360px · 1280px 페이지로 써서 headless Chrome 으로 찍고 행 높이를 잰다(`PANEL_PREVIEW_DIR=<dir> node --test --test-name-pattern preview test/panel/panel.test.ts`). html 패널에서 인라인 SVG 가 그려지는 것은 T3 1차(U3)가 Orca 안에서 보였다.
- **대비.** 색 토큰은 hallmark-final 시안의 값을 그대로 옮겼다(라이트·다크 모두). 그래서 시안 README 의 대비 표(가장 낮은 값 라이트 paper-3 위 accent 4.69, 모두 4.5 이상)가 그대로 맞는다. 행 배경은 보통 배경(`--paper`, hover `--paper-2`, 묶음 머리 줄 `--paper-2`/`--paper-3`)만 쓴다.
