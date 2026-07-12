# Jobs Task 1 Report: Shared accessible-tabs behavior

## Status

Implemented the reusable, generic `useAccessibleTabs<T extends string>` hook
without changing any page consumer, dependency, business flow, or Aurora
styling.

## RED / GREEN evidence

1. Initial keyboard and relationship RED
   - Command: `npm test -- components/ui/useAccessibleTabs.test.tsx`
   - Result: the suite failed for the expected reason: Vite could not resolve
     the not-yet-created `./useAccessibleTabs` module.
   - GREEN: after the minimal hook implementation, the same focused command
     passed 3/3 tests.
2. Review regression RED
   - Added an explicit tablist ID assertion and a manual-mode regression where
     ArrowRight moves the roving tab stop to the second tab, then the user
     clicks the already-selected first tab.
   - Command: `npm test -- components/ui/useAccessibleTabs.test.tsx`
   - Result: 2 expected failures: the tablist had no ID, and the clicked first
     tab incorrectly remained `tabIndex=-1` while the second remained `0`.
   - GREEN: the hook now gives the tablist `${id}-tablist` and maintains the
     roving tab stop declaratively, including click and manual activation
     paths. The focused command again passed 3/3.

## Behavior delivered

- Complete tablist, tab, and tabpanel roles, IDs, `aria-controls`, and
  `aria-labelledby` relationships.
- One roving tab stop, with the selected tab initially at `tabIndex=0`.
- ArrowLeft and ArrowRight navigation with wraparound plus Home and End.
- Automatic activation by default: keyboard focus movement selects the tab and
  reveals its panel.
- Manual activation: navigation moves focus/tab stop without changing
  selection; Enter or Space activates the focused tab.
- Click activation in both modes, including the same-value controlled-state
  edge case found during review.
- Generic string-union typing for values, callbacks, and prop getters.

## Files

- `components/ui/useAccessibleTabs.ts`
  - New shared accessible-tabs behavior hook.
- `components/ui/useAccessibleTabs.test.tsx`
  - Real DOM coverage for relationships, click, automatic keyboard behavior,
    wraparound, Home/End, manual activation, and roving tabindex.
- `.superpowers/sdd/2026-07-12-jobs-task-1-report.md`
  - This report.

## Verification

- Focused Vitest:
  `npm test -- components/ui/useAccessibleTabs.test.tsx` — 1 file passed,
  3 tests passed.
- Limited ESLint:
  `npx eslint components/ui/useAccessibleTabs.ts components/ui/useAccessibleTabs.test.tsx`
  — exit 0, no findings.
- Scoped TypeScript check for both changed TS/TSX files — exit 0.
- Full root Vitest: 138 files passed, 972 tests passed.
- CRLF-aware staged diff check for all three task paths: clean.

## Self-review

- Production behavior is independent of Jobs/Resume/Discover consumers; no
  consumer was touched.
- No dependency was added.
- Manual focus and controlled selection remain separate until activation.
- Panel visibility is controlled only through the supplied selected value.
- The implementation does not alter styling, information architecture, or
  business behavior.

## Concerns

None in Task 1. An optional repository-wide `tsc --noEmit` probe still reports
pre-existing type errors in unrelated test files; neither changed file appears
in that output, and the scoped TypeScript check for this task is clean.
