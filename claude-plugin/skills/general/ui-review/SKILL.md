---
name: ui-review
description: "Use before a mockup, screen or UI PR is shown to a person, and after one points out a UI problem: measures layout and consistency and walks the flow — \"UI 리뷰해줘\", \"시안 점검해줘\", \"화면 밸런스 봐줘\", \"보여주기 전에 UI 확인해줘\"."
---

# UI review

A person should not be the first to notice that one row is taller, a button narrower or a step
pointless. This skill is the gate before they look: measure what can be measured, walk the
scenario for what cannot, and show the result with the screen. The rules and the reason for each
are in [references/rules.md](references/rules.md).

## When

- Before a mockup goes to the user for approval.
- Before a PR that changes what people see asks for review, and again when a commit changes the
  rendered output.
- When the user flags a UI problem: fix it, then add the rule (rules.md, "Adding a rule") so the
  next screen is measured for it.

Not for a change with no rendered output, and not instead of running the changed flow: a page
can pass every rule and still not work.

## Procedure

1. **Find the reference.** The product's design system (tokens, components, Storybook) wins over
   every rule here: read its spacing scale, control heights and colors, and use them as the
   thresholds (the grid, the allowed off-grid values). Pick an existing screen of the same kind (a
   list for a list, a settings page for a settings page) as the baseline. No design system and no
   existing screen: the defaults in rules.md apply, and say so in the result.
2. **Measure** each screen and each state the change touches (empty, error, many rows, long
   text), at widths 1280 and 390. Open the page in the browser tool this session has (browser
   automation, or the page's devtools) and read the rendered geometry with page scripts:
   `getBoundingClientRect()` for heights, widths, edges and centers, `getComputedStyle()` for
   padding, gaps, radius, font and color, and `document.documentElement.scrollWidth` against the
   viewport for overflow. Check each rule in rules.md that is marked measured, by its check id,
   on the baseline screen too.
   - Limit the check to the part under review, and leave out a mockup's own control bar. An
     element marked `data-ui-review-ignore` is skipped, with the reason in the result.
   - A page behind a login is measured only where a session already exists (an exported static
     page, a dev fixture); signing in is the human's step.
   - A screen that lives inside a host app (a plugin panel) is measured in the real host with real
     data; a browser render or a plugin screenshot is only a pre-check. When the repository's
     verify-tier config names a surface and measures for its `ui` evidence (decision 238), the
     evidence's `observed` is a JSON object with that surface and a number for each measure.
   - A FAIL is a rule broken past its threshold. A WARN is a judgment call: decide each one and
     write why.
3. **Walk the scenario** with [references/walkthrough.md](references/walkthrough.md): the user's
   task from entry to done, counted in screens, clicks and scrolls, with every step the system
   could do itself and every option that repeats another marked. This catches what no
   measurement does: wrong grouping, system steps shown to people, unclear actions.
4. **Fix and remeasure** until no FAIL is left that is not an accepted exception. An exception
   names the rule and the reason ("the design system's chip padding is 6px").
5. **Report** with the screen, in the PR's evidence comment or next to the mockup link:

   ```markdown
   ### UI 리뷰 (head `abc1234`, 1280·390, 기준 화면: /projects)
   | 규칙 | 판정 | 근거 |
   |---|---|---|
   | row-height | PASS | |
   | control-column | FAIL→수정 | "비활성화" 76px vs 68px, 폭 고정 |
   | walkthrough | PASS | 3화면·4클릭, 시스템 단계 0, 중복 옵션 0 |
   | 예외 | spacing-grid 6px | 디자인 시스템 chip 토큰 |
   ```

   A mockup is not sent to the user while a FAIL stands without its exception. Check that its
   link answers before you send it.

## Verdict

PASS when every measured check is PASS or an accepted exception, every WARN has a decision, and
the walkthrough has no open item. The verdict holds for the head or the mockup version it was
made on.

## Boundaries

- In a repository sangsoe manages, a PR that changes a screen is verification tier V3
  (decision 85), which asks for screenshots or a GIF and a lead's verdict on them. This table is
  where that verdict starts; this skill does not take the screenshots or set the tier. Land
  refuses a `ui` row that lacks the surface or a measure the config asks for.
- Product-specific rules (one product's tokens, a team's layout choice) live in that product's
  repository, not here.
