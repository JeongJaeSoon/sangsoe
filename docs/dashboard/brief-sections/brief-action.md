<!-- 시안 (b): /sangsoe:brief:action(= /sangsoe:brief action) 한 절 출력(결정 320). brief.md 와 같은 모델에서 그 절만 그린다. 머리 줄 · 멈춤 줄 · 꼬리 줄은 전체와 같다. -->

현황 · 11/16 21:00 · 오너 차례 4 · 완료 3 · 진행 3 · 대기 2 · 확인·대응 9 · 앞으로 4

🚨 코디네이터 멈춤 · run:run_fixture01 · term_fixture02 · 25m 전 감지 · 그 터미널에 말을 걸어 Run 의 메일을 읽힌다

### 확인·대응 필요 9 (오너 4)

| 누가 | 무엇 | 링크 | 상태·다음 | 경과 |
|---|---|---|---|---|
| **오너** | d041 웹훅 재시도 정책 | d041 | 추천: 3회 지수 백오프 | 17h |
| **오너** | d042 feature 머지 방식 | d042 | 추천: merge commit | 12h |
| **오너** | i310 prod 동기화 확인 | [ACME-9](https://tracker.example/browse/ACME-9) | prod 콘솔에서 확인 | 2h |
| **오너** | i309 결제 화면 문구 | [acme/app#16](https://github.com/acme/app/pull/16) | 승인 줄 치기 | 30m |
| lead:billing | i313 결제 대시보드 | [acme/app#9](https://github.com/acme/app/pull/9) | 닫힘: 다시 열기·거두기 | 1d |
| lead:login | i312 소셜 로그인 | [acme/app#11](https://github.com/acme/app/pull/11) | 증거상 끝남 → 닫기 | 5h |
| 오케스트레이터 | d040 로그 보존 기간 | d040 | 대화로 답함 → 기록 | 3h |
| 오케스트레이터 | acme/app#20 직접 머지 | [acme/app#20](https://github.com/acme/app/pull/20) | 오너 직접 친 줄: 연결 | 3h |
| worker | i311 검색 색인 | [acme/api#42](https://github.com/acme/api/pull/42) | 리뷰 변경 요청 반영 | 1h |

원문:

- **d041** 웹훅 재시도 정책을 무엇으로 할까? — 추천: 3회 지수 백오프(1s · 4s · 16s) · 선택지: 3회 지수 백오프 / 고정 간격 5회 / 재시도 없음 · 풀리는 일: i314 웹훅 수신기
- **d042** acme/app 의 feature 브랜치를 어떻게 머지할까? — 추천: merge commit · 선택지: merge commit / squash · 풀리는 일: i306 세션 만료 처리의 머지 방식
- **i310** prod 동기화 확인 — 할 일: prod 콘솔에서 오늘 동기화가 끝났는지 본다 · 풀리는 일: i302 의 prod 단계
- **i309** acme/app#16 머지 승인 — 할 일: 이 대화에 `승인 acme/app#16 9c1e5b7d2a4f6e8c0b1d3f5a7c9e1b3d5f7a9c1e` 한 줄을 친다

PR 상태: pr-monitor 마지막 라운드 20:58 · 절 하나: `/sangsoe:brief:<절>` (done · doing · waiting · action · next) · 묶음 상세: `sangsoe brief <묶음>`
