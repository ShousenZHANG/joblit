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

## Review follow-up: controlled sync and safe relationship IDs

Formal review identified one controlled-state bug and one ID-hardening gap.
Both were closed with separate RED to GREEN cycles.

### External controlled-value sync

- RED: a real manual-mode harness added an external button that calls the
  parent `setValue("second")`. Selection and panel visibility moved to Second,
  but First incorrectly remained the sole `tabIndex=0` tab. The focused suite
  failed on the expected `tabindex="-1"` assertion for First.
- GREEN: roving state now records the selected-value snapshot. When the
  controlled value changes, the hook conditionally resets the tab stop to the
  new selected value before commit. Manual arrow navigation still changes only
  focus/tab stop until Enter or Space activates it.
- The regression verifies Second is selected, its panel is visible, it is the
  unique `tabIndex=0` tab, and pressing Tab from the preceding external control
  enters Second directly.

### Whitespace-free value tokens

- RED: a harness using the tab value `"cover letter"` received the raw ID
  `documents-tab-cover letter`; the exact encoded-ID assertion failed.
- GREEN: tab and panel IDs now derive their value token with
  `encodeURIComponent`. The test binds both sides of `aria-controls` and
  `aria-labelledby` to the encoded IDs and confirms every relationship string
  is whitespace-free.

### Follow-up verification

- Focused Vitest:
  `npm test -- components/ui/useAccessibleTabs.test.tsx` — 1 file passed,
  5 tests passed.
- Limited ESLint on the hook and test: exit 0, no findings.
- Scoped TypeScript check on the hook and test: exit 0.
- CRLF-aware unstaged diff check on both product paths: clean.
- Full Vitest was not repeated, per the formal-review instruction.

### Follow-up concerns

None. The optional repository-wide TypeScript baseline note above is unchanged.
