# Foundations Task 2 Report: Touch-safe shared controls

## Status

Implemented the shared touch-target contract without changing business flow,
Aurora styling, component signatures, or fine-pointer desktop density.

## RED / GREEN evidence

1. Button and dialog sizing RED
   - Command: `npm test -- components/ui/interaction-primitives.test.tsx`
   - Result: 2 tests failed for the expected missing classes: `h-11` on the
     `touch` button and `size-11` on the default dialog close.
   - GREEN: the same command passed 2/2 after adding the two explicit button
     variants and the 44px dialog close target.
2. Coarse-pointer height RED
   - Command: `npm test -- test/mobileLayoutStyles.test.ts`
   - Result: 1 test failed because the shared `data-slot` coarse-pointer rule
     did not exist.
   - GREEN: the focused primitive + mobile suite passed after adding the
     44px minimum-height rule.
3. Compact icon-button width RED
   - Command: `npm test -- test/mobileLayoutStyles.test.ts`
   - Result: 1 test failed because coarse-pointer buttons did not yet have a
     44px minimum width.
   - GREEN: the focused suite passed after applying `min-width: 44px` to
     buttons and dialog close controls. A preservation assertion confirms
     `icon-sm` remains `size-8` on fine pointers and exposes
     `data-slot="button"` for the coarse-pointer override.

Final focused result:

- `npm test -- components/ui/interaction-primitives.test.tsx test/mobileLayoutStyles.test.ts`
- 2 files passed, 6 tests passed.

## Files

- `components/ui/button.tsx`
  - Added `touch` (`h-11`) and `icon-touch` (`size-11`) variants.
- `components/ui/dialog.tsx`
  - Made the default close control an explicit `size-11` circular target at
    `right-2 top-2`, preserving its existing hover/focus feedback.
- `app/globals.css`
  - Added coarse-pointer minimum heights for buttons, inputs, select triggers,
    select items, and dialog close controls.
  - Added coarse-pointer minimum widths for buttons and dialog close controls.
- `components/ui/interaction-primitives.test.tsx`
  - Covers explicit touch variants, compact desktop icon density/data slot,
    and the default dialog close target.
- `test/mobileLayoutStyles.test.ts`
  - Covers the shared coarse-pointer 44px height and width contracts.
- `.superpowers/sdd/2026-07-12-foundations-task-2-report.md`
  - This report.

`components/ui/input.tsx` and `components/ui/select.tsx` required no source
change: the existing input, select trigger, and select item primitives already
emit the exact `data-slot` hooks consumed by the new CSS contract.

## Verification

- Focused primitive + mobile CSS regression: 6/6 passed.
- Limited ESLint on changed TypeScript/TSX files: exit 0, no findings.
- Full root Vitest: 136 files passed, 945 tests passed.
- CRLF-aware staged diff check
  (`git -c core.whitespace=cr-at-eol diff --cached --check`): clean.

## Self-review

- Existing `default`, `sm`, `lg`, `icon`, `icon-sm`, and `icon-lg` classes are
  unchanged, so fine-pointer desktop density remains compact.
- Coarse-pointer rules are scoped to `@media (pointer: coarse)` and therefore
  do not globally enlarge desktop controls.
- The `icon-sm` contract is 32px on fine pointers but at least 44x44 on coarse
  pointers through its stable `data-slot="button"` hook.
- Reduced-motion behavior was not broadened or used to remove hover/focus/color
  feedback.
- No dependency, API, information-architecture, or business-flow changes.

## Concerns

None. The repository stores `app/globals.css` with CRLF line endings; the file
was staged while preserving that format, so the commit contains only the 15
intended CSS lines.

## Review follow-up: test integrity

Formal review identified two gaps in the tests, not in the production touch
contract. Both were addressed with mutation evidence before the final GREEN.

### Balanced coarse-pointer block extraction

- RED: a synthetic mutation moved the button/dialog `min-width: 44px` rule
  immediately outside `@media (pointer: coarse)`. The old `[\s\S]*?`
  cross-block regex still matched it, so the new mutation regression failed for
  the expected reason.
- GREEN: `test/mobileLayoutStyles.test.ts` now extracts each coarse-pointer
  media body with balanced-brace scanning before evaluating its rule bodies.
  The scanner ignores braces inside CSS comments, quoted values, and escaped
  characters. The outside-media mutation is rejected, while the real contract
  is accepted.

### Real primitive slot binding

- RED: after adding a real render of Button, Input, open Radix Select
  (trigger + item), and the default Dialog close, the four existing production
  slots were temporarily changed to `*-mutant`. The test failed with the exact
  received array `input-mutant`, `select-trigger-mutant`,
  `select-item-mutant`, and `dialog-close-mutant`.
- GREEN: restoring the production slots made the test pass. The final test
  binds every coarse-pointer CSS selector to the actual rendered DOM:
  `button`, `input`, `select-trigger`, `select-item`, and `dialog-close`.
- The temporary production mutations were fully restored; the follow-up has no
  production-code diff.

### Follow-up verification

- Focused tests:
  `npm test -- components/ui/interaction-primitives.test.tsx test/mobileLayoutStyles.test.ts`
  — 2 files passed, 8 tests passed.
- Limited ESLint on both changed test files: exit 0, no findings.
- `git diff --check`: clean.
- Full Vitest was not repeated because the review task explicitly limited
  verification to the two focused files.

### Follow-up concerns

None. The stricter CSS test cannot accept a matching width rule after the
balanced coarse-pointer block closes, and the slot test exercises real Radix
portal output rather than mocked primitives.
