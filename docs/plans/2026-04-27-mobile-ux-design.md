# Mobile UX Design

## Goal

Improve the perceived smoothness and mobile responsiveness of the authenticated product paths without changing core workflows or adding new feature scope.

## Scope

Focus first on `/jobs`, `/resume`, `/fetch`, and the global authenticated app shell. Marketing pages and lower-frequency utility pages should only receive shared polish if it falls out of the same layout system.

## Recommended Approach

Use a narrow product-path pass: stabilize mobile scrolling, remove brittle viewport-height assumptions, increase touch target consistency, reduce unnecessary motion on small screens, and preserve the existing visual language. This gives the highest user impact with the lowest regression risk.

## Design

The app shell remains a top navigation plus scrollable content frame, but mobile pages should prefer natural document flow over nested fixed-height panels. Jobs keeps the desktop two-pane layout, while mobile list/detail panels get flexible minimum heights and safer viewport bounds. Resume keeps its mobile preview dialog and bottom action bar, but the action bar should wrap cleanly on narrow widths and not hide primary actions behind text overflow. Shared CSS should add mobile-friendly momentum scrolling, overscroll containment for internal panels, and reduced-motion safeguards for decorative animations.

## Validation

Add tests that assert the responsive layout contracts that caused the highest risk: Jobs mobile panel height no longer depends on a single fixed `100dvh - 240px` value, detail actions remain grid-first on mobile, and Resume action bar can wrap while preserving safe-area padding. Then run targeted tests, lint, full tests, and build.

