<!-- 시안 (a): /sangsoe:brief 전체 출력(결정 320). fixture 데이터. 칸은 core/brief/width.ts 의 fit · prLabel 로 잘랐다. -->

현황 · 11/16 21:00 · 오너 차례 4 · 완료 3 · 진행 3 · 대기 2 · 확인·대응 9 · 앞으로 4

🚨 코디네이터 멈춤 · run:run_fixture01 · term_fixture02 · 25m 전 감지 · 그 터미널에 말을 걸어 Run 의 메일을 읽힌다

### 개발 완료 3 · 🔍 1

| 누가 | 무엇 | 링크 | 상태·다음 | 경과 |
|---|---|---|---|---|
| lead:billing | i301 청구서 PDF 생성 | [acme/app#12](https://github.com/acme/app/pull/12) | prod ✓ | 6h |
| lead:billing | i302 환불 웹훅 재시도 | [acme/api#31](https://github.com/acme/api/pull/31) | dev ✓ · prod 대기 | 9h |
| lead:login | i305 로그인 오류 문구 | [acme/app#15](https://github.com/acme/app/pull/15) | 머지 ✓ · 🔍 근거 부족 | 26h |

### 진행 중 3

| 누가 | 무엇 | 링크 | 상태·다음 | 경과 |
|---|---|---|---|---|
| worker | i307 N+1 쿼리 제거 | [acme/api#40](https://github.com/acme/api/pull/40) | 🚨 CI 수정 | 40m |
| worker | i306 세션 만료 처리 | [acme/app#18](https://github.com/acme/app/pull/18) | 시험 작성 중 | 2h |
| lead:billing | i303 결제 모듈 정리 | [acme/api#36](https://github.com/acme/api/pull/36) | CI·머지 대기 | 75m |

### 다른 사람 대응 대기 2

| 누가 | 무엇 | 링크 | 상태·다음 | 경과 |
|---|---|---|---|---|
| 인프라 | i308 스테이징 키 발급 | [ACME-7](https://tracker.example/browse/ACME-7) | 키 도착 확인 | 2d |
| reviewer-a | i304 청구 내역 CSV | [acme/app#14](https://github.com/acme/app/pull/14) | 리뷰 대기 · 독촉 1회 | 30h |

### 확인·대응 필요 9 (오너 4)

| 누가 | 무엇 | 링크 | 상태·다음 | 경과 |
|---|---|---|---|---|
| **오너** | d041 웹훅 재시도 정책 | d041 | 추천: 3회 지수 백오프 | 17h |
| **오너** | d042 feature 머지 방식 | d042 | 추천: merge commit | 12h |
| **오너** | i310 prod 동기화 확인 | [ACME-9](https://tracker.example/browse/ACME-9) | prod 콘솔에서 확인 | 2h |
| **오너** | i309 결제 화면 문구 | [acme/app#16](https://github.com/acme/app/pull/16) | 승인 줄 치기 | 30m |
| lead:billing | i313 결제 대시보드 | [acme/app#9](https://github.com/acme/app/pull/9) | 닫힘: 다시 열기·거두기 | 40h |
| lead:login | i312 소셜 로그인 | [acme/app#11](https://github.com/acme/app/pull/11) | 증거상 끝남 → 닫기 | 5h |
| 오케스트레이터 | d040 로그 보존 기간 | d040 | 대화로 답함 → 기록 | 3h |
| 오케스트레이터 | acme/app#20 직접 머지 | [acme/app#20](https://github.com/acme/app/pull/20) | 오너 직접 친 줄: 연결 | 3h |
| worker | i311 검색 색인 | [acme/api#42](https://github.com/acme/api/pull/42) | 리뷰 변경 요청 반영 | 70m |

원문:

- **d041** 웹훅 재시도 정책을 무엇으로 할까? — 추천: 3회 지수 백오프(1s · 4s · 16s) · 선택지: 3회 지수 백오프 / 고정 간격 5회 / 재시도 없음 · 풀리는 일: i314 웹훅 수신기
- **d042** acme/app 의 feature 브랜치를 어떻게 머지할까? — 추천: merge commit · 선택지: merge commit / squash · 풀리는 일: i320 브랜치 정리
- **i310** prod 동기화 확인 — 할 일: prod 콘솔에서 오늘 동기화가 끝났는지 본다 · 풀리는 일: i302 의 prod 단계
- **i309** acme/app#16 머지 승인 — 할 일: 이 대화에 `승인 acme/app#16 9c1e5b7d2a4f6e8c0b1d3f5a7c9e1b3d5f7a9c1e` 한 줄을 친다

### 앞으로 할 것 4

| 누가 | 무엇 | 링크 | 상태·다음 | 경과 |
|---|---|---|---|---|
| lead:login | i318 2단계 인증 | [ACME-4](https://tracker.example/browse/ACME-4) | ⏸️ i312 닫힌 뒤 | 6d |
| 오케스트레이터 | i317 문서 색인 | — | 조건: 다음 스프린트 | 3d |
| lead:billing | i319 영수증 메일 템플… | — | i303 뒤 | 17h |
| lead:login | i316 비밀번호 재설정 … | [ACME-3](https://tracker.example/browse/ACME-3) | 시작 | 4h |

상세: `sangsoe brief <절>`(done · doing · waiting · action · next) · `sangsoe brief <묶음>`
