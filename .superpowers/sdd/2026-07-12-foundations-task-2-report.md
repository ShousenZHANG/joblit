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
