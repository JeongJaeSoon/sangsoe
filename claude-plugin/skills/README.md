<!-- layout: slot=③ layer=판단 tokens=using -->
# claude-plugin/skills — 판단 · 토큰 O

판단 절차 skill 을 둔다. 지금은 일반 작업 스킬 14개가 `general/` 에 있다(결정 95). sangsoe 의 역할·상태에 기대는 판단 절차 skill(intake · write-brief · brief · deliver-ticket)은 이 폴더에 있다.

매니페스트(`.claude-plugin/plugin.json`)의 `skills` 가 이 폴더와 `general/` 을 둘 다 가리킨다. 두 폴더의 스킬은 `sangsoe:<name>` 으로 올라온다.

여기에는 프롬프트만 두고 코드는 두지 않는다: 반복 계산은 코어 함수, 강제할 규칙은 hook 이다. `test/layout.test.ts` 가 이 폴더에 코드 파일이 없는지 검사한다.
