# 98. 빌드는 `tsc`, 시험은 `node:test`, 린트는 Biome 이다

시험은 빌드 없이 `.ts` 소스를 Node 가 그대로 돌린다(`erasableSyntaxOnly`·`rewriteRelativeImportExtensions` 로 소스는 `.ts` 확장자로 import 하고 빌드가 `.js` 로 바꾼다). 개발 의존은 `typescript`·`@biomejs/biome`·`@types/node` 셋이고 실행 의존은 없다.

대안: vitest·ESLint(의존이 수십 개 늘고 Node 가 이미 하는 일을 겹쳐 한다). 배포용 묶음(진입점마다 한 파일)은 이 결정에 없다: 설치 유닛이 정한다.
