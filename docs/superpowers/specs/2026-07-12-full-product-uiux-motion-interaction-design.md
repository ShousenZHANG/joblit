# Joblit Full-Product UI/UX, Motion, and Interaction Design

**Date:** 2026-07-12

**Status:** Approved by the user for full implementation

**Baseline:** 82/100 strict UI/UX score; marketing approximately 91/100; authenticated workspace approximately 80/100

**Target:** 92-94/100, subject to automated and real-browser verification

## Context

Joblit already has a distinctive Aurora Deep visual system, bilingual product flows, responsive layouts, dark and light themes, and a meaningful reduced-motion foundation. The remaining gap is not a lack of decoration. It is the difference between a visually polished SaaS product and a top-tier product whose navigation, feedback, keyboard behavior, touch ergonomics, history restoration, animation cost, and error recovery all feel deliberate.

This project is a full-product interaction hardening pass. It covers the marketing surface, login, authenticated navigation, Jobs, Fetch, Resume, Discover, shared dialogs and controls, and the global motion system. It preserves the current information architecture, business rules, emerald Aurora identity, and product terminology. It does not introduce WebGL, a new visual brand, speculative product features, or a dependency-heavy animation framework.

## Approaches Considered

### 1. System-first interaction hardening - selected

Create a small set of shared motion, focus, touch-target, tabs, and route-behavior contracts, then migrate every affected surface to them. This produces consistent behavior, makes accessibility testable, and prevents page-by-page fixes from drifting apart.

### 2. Page-by-page visual redesign

Restyle each page independently and add bespoke transitions. This can create visible novelty quickly, but it does not solve shared failures such as undersized controls, keyboard-event leakage, history restoration, or reduced-motion gaps. It also increases inconsistency and regression risk.

### 3. Motion-first brand amplification

Add richer hero, card, and route animation before repairing interaction semantics. This would improve demo appeal but would add runtime cost while the authenticated workspace still loses context and exposes incomplete keyboard behavior. It is rejected as the primary strategy.

## Product Experience Direction

The guiding principle remains **"the universe moves slowly; the interface responds immediately."** Atmospheric layers may drift over 30-60 seconds. User actions must acknowledge input within one rendered frame and settle quickly. The authenticated workspace favors clarity and speed over spectacle; the marketing surface may retain richer atmosphere.

The experience has one visual signature: a restrained emerald signal that follows important progress, focus, completion, and selection states. It appears as a hairline, compact glow, or short directional movement rather than a large decorative effect. Destructive, warning, and informational states retain semantic colors and never become emerald merely for brand consistency.

## Global Interaction Architecture

### Motion contract

The shared motion contract uses four interaction durations:

- 120 ms for press, hover, and icon-state acknowledgement.
- 180 ms for control, tooltip, and compact popover transitions.
- 260 ms for dialogs, panels, and local content replacement.
- 320 ms maximum for complex but interruptible layout transitions.

The standard easing is `cubic-bezier(0.16, 1, 0.3, 1)`. Continuous atmospheric motion remains between 30 and 60 seconds. Loading indicators may rotate continuously while work is active; decorative UI must not pulse, bounce, or spin indefinitely.

`MotionConfig reducedMotion="user"` is mounted once in the root provider tree. CSS animations, programmatic smooth scrolling, Framer Motion variants, skeletons, progress indicators, and pointer effects must all provide a static or immediate reduced-motion state. Reduced motion removes movement but does not remove state feedback.

Only `transform` and `opacity` are animated for high-frequency interaction. Progress bars use `scaleX` rather than animated width. Pointer-driven effects cache geometry on pointer entry or resize and coalesce reads and writes through one animation frame.

### Touch and pointer contract

Primary and compact interactive controls have at least a 44 by 44 CSS-pixel hit area on mobile and coarse-pointer devices. Desktop data-dense controls may retain a 32-40 pixel visual shape when their hit area is expanded without creating overlap. Icon size remains visually restrained.

Hover effects are enhancements for fine pointers. Touch devices receive the same content and clear pressed, selected, loading, and completion states without relying on hover. Magnetic, tilt, spotlight, parallax, and full atmospheric motion are disabled for coarse pointers and reduced motion.

### Focus and keyboard contract

Every application route exposes a stable `main` landmark with `id="main-content"` and `tabIndex={-1}`. The authenticated shell gains a localized skip link matching the marketing shell. Forward navigation focuses the new main landmark without a visible scroll jump. Browser history navigation preserves the browser's restored scroll and does not force focus or scroll to the top.

Focus rings remain visible in both themes and use the brand ring token only when it meets contrast requirements. Global keyboard handlers run only while their owning widget is active and never intercept input, textarea, select, button, link, contenteditable, dialog, menu, listbox, or combobox behavior.

### Async and feedback contract

Every operation longer than 300 ms exposes a loading state. Buttons prevent duplicate submission, keep their width stable, and use `aria-busy` when they own the operation. Success, warning, and error feedback is announced through an appropriate live region. Errors appear near the failing control and include a recovery action when recovery is possible.

Skeletons preserve final layout dimensions. Under reduced motion they render as static tonal placeholders. Empty states and failed states are distinct; a network failure must not masquerade as an empty collection.

## Route and Navigation Design

### Route transitions

Server-rendered content is visible immediately. The first document render never starts at zero opacity and never scales the entire page. Client-side forward navigation may use a 180-220 ms opacity and 4 px translate entrance, but page-scale transitions are removed because they soften text and increase perceived latency.

The route layer owns route-change focus behavior. It no longer performs unconditional scroll resets. The AppNav no longer performs a second scroll reset. Explicit forward navigation to a different top-level destination may scroll to the beginning; browser Back and Forward preserve native history position.

### Authenticated navigation

AppNav keeps its current sticky Aurora-aligned pill and information hierarchy. The following changes are required:

- All desktop and mobile actions receive visible focus treatment.
- The mobile overflow trigger and dialog/menu actions receive 44-pixel hit areas.
- AppNav entrance follows the global reduced-motion contract.
- Primary, home, command-palette, and overflow labels are localized.
- The active route remains indicated by both color and `aria-current`.
- Command-palette and sign-out controls expose pressed, pending, and disabled feedback without layout shift.

The workspace atmosphere is reduced to one or two low-cost static or slow layers. The full starfield and four-layer Aurora remain available to the marketing and login surfaces, where they support brand storytelling. This preserves visual continuity while reducing persistent compositor work in the product workspace.

## Shared Accessible Components

### Accessible tabs

A shared tabs primitive provides:

- `tablist`, `tab`, and `tabpanel` roles.
- Stable ids with `aria-controls` and `aria-labelledby` relationships.
- Roving `tabIndex` so only the active tab is in the normal tab order.
- Left and Right arrows, Home, and End keyboard behavior.
- Optional manual or automatic activation; Joblit uses automatic activation for small local views and manual activation when switching triggers network or expensive work.
- A minimum 44-pixel mobile target with compact desktop presentation.

Jobs list/detail modes, Discover categories, and Resume mobile sections use this primitive instead of separate partial implementations.

### Search suggestion combobox

Fetch job-title and location suggestions use one shared combobox behavior:

- Input owns `role="combobox"`, `aria-expanded`, `aria-controls`, and `aria-activedescendant`.
- Suggestions render in a labelled listbox with stable option ids.
- Arrow keys move the active option; Enter accepts; Escape closes; Tab preserves normal focus order.
- Pointer and keyboard selection produce the same value and feedback.
- Loading, no-results, and failure states are announced without replacing the user's typed text.

No new combobox dependency is required; the behavior is isolated in a focused hook and presentation component and covered by interaction tests.

### Control sizing

Shared Button, Input, Select, Dialog close, icon button, and chip styles gain a touch-safe variant or coarse-pointer minimum. Existing dense desktop layouts are not globally inflated. Consumers that are inherently desktop data tools may request the compact visual variant while preserving an expanded hit target.

## Jobs Experience

### Keyboard navigation

Jobs keyboard navigation is scoped to the list widget. The list itself becomes focusable and publishes the active item. Arrow or `j`/`k` movement runs only when focus is within the jobs list and no nested interactive element owns the event. Selection state, visual highlight, and assistive-technology focus remain synchronized.

### List semantics and virtualization

Both standard and virtual job lists expose a real list/listitem relationship. Virtual rows publish `aria-setsize` and `aria-posinset`. Rows are dynamically measured instead of relying on a fixed 88-pixel estimate, preventing overlap and scroll jumps when job cards contain longer metadata. An automated regression uses at least 81 heterogeneous jobs to force the virtualized path.

### Search and history restoration

Search text, filters, sort, list/detail mode, and selected job are serialized into stable URL parameters. Initial component state is derived from the URL. Updates replace or push history according to intent: transient filter changes replace the current entry, while opening a detail or tailor destination creates a navigable entry. Returning to Jobs restores the same filters, selected item, and native scroll context.

No database schema changes are required. URL parsing ignores unknown values and falls back to existing defaults.

## Fetch Experience

Job title and location labels are programmatically associated with their inputs. Missing required values set `aria-invalid`, reference field-level error text, and move focus to the first invalid field after submission. A compact top summary may remain, but it does not replace field-level guidance.

Filter chips expose `aria-pressed`, a visible selected state, and a 44-pixel coarse-pointer target. Custom-term removal uses a labelled icon button rather than a bare character target.

History loading has three distinct states: loading, successful empty, and non-blocking failure. A failed history request shows a Retry action and does not block a new fetch. Fetch progress respects reduced motion, uses transform-based progress, pauses decorative pulses, and keeps textual status available throughout the operation.

## Resume Experience

Resume section navigation adopts the shared tabs contract on mobile and preserves the existing desktop structure. Preview, save, zoom, and section actions receive touch-safe hit areas, consistent focus rings, stable loading labels, and reduced-motion-safe scrolling. Programmatic section scrolling becomes immediate when reduced motion is requested.

The current editing, autosave, preview, version, and PDF generation flows remain unchanged. This pass does not redesign resume information architecture or modify generated resume content.

## Discover Experience

Discover categories and content modes adopt shared accessible tabs. All visible labels, ARIA labels, badges, tooltips, empty states, and retry messages move into the English and Chinese message catalogs.

Deployment diagnostics such as missing environment variables are not shown to normal users. Normal users receive an actionable content-unavailable message and Retry where applicable. Detailed configuration guidance is reserved for server logs or an administrator-only surface.

Video and repository cards preserve existing information density. Interactive thumbnail controls, filters, and retry actions meet the touch and focus contracts. Decorative thumbnail scaling remains fine-pointer-only and reduced-motion-safe.

## Marketing and Login Experience

The landing page retains its full Aurora identity, editorial layout, starfield, and product-demo narrative. Improvements are performance and behavior focused:

- The Hero product-demo interval pauses when the Hero leaves the viewport or the document becomes hidden.
- The changing demo subtree is isolated so the entire Hero does not re-render on every interval.
- Spotlight, magnetic, and tilt effects cache geometry and update at most once per frame.
- Marketing route content is visible on the server and does not wait for hydration to fade in.
- Legal table-of-contents scrolling respects reduced motion.

Login keeps its current focused card. Authentication errors use alert/live semantics. The Suspense boundary renders a stable card-shaped loading fallback rather than a blank subtree. Provider buttons retain immediate connecting feedback, prevent duplicate submission, and preserve their size.

## Error Handling and Recovery

- Field validation errors stay next to their inputs and are referenced with `aria-describedby`.
- Route restoration ignores malformed URL state instead of crashing or showing an error page.
- Virtual measurement falls back to a conservative estimated size before the first measurement.
- Async list failures retain the user's filters and typed input.
- Failed retries remain available and never clear previously rendered successful data.
- Login and authorization errors are announced once and do not trap focus.
- Motion or pointer capability checks fail toward static content, never missing content.

## Performance Budget

- No new animation or UI framework dependency is added.
- No WebGL, canvas trail, or per-row entrance animation is introduced.
- Pointer interactions perform no uncoalesced layout reads during pointer movement.
- Hidden Hero demos and hidden-document timers do not update state.
- Authenticated pages do not run the full four-layer animated marketing atmosphere.
- Long lists retain virtualization and `content-visibility` where already appropriate.
- Route animation never delays server content visibility or data fetching.

## Testing Strategy

Behavior changes follow red-green-refactor. Tests are grouped by independently reviewable behavior:

- Route tests cover first-render visibility, forward-navigation focus, reduced motion, and history-friendly scrolling.
- AppNav tests cover localization, focus styles, touch targets, reduced motion, and command/sign-out pending behavior.
- Shared tabs tests cover roles, relationships, roving focus, arrows, Home, End, pointer activation, and reduced motion.
- Combobox tests cover expansion semantics, active descendant, keyboard selection, Escape, no results, and failure recovery.
- Jobs tests cover interactive-element exclusions, focus-scoped shortcuts, list semantics, dynamic virtualization with at least 81 varied rows, URL serialization, malformed parameters, and Back restoration.
- Fetch tests cover labels, inline validation, focus-to-error, pressed filters, history failure, Retry, and reduced motion.
- Resume and Discover tests cover shared tabs, touch targets, translated labels, and reduced-motion scrolling.
- Landing and login tests cover Hero pause/resume, pointer scheduling, immediate SSR visibility, error announcements, and non-empty Suspense fallback.

Final verification includes root formatting, lint, type checks, dependency policy, dead-code audit, complete Vitest coverage, production build, Python tests, extension tests and build, and real-browser checks at 375, 768, 1024, and 1440 CSS pixels in light, dark, keyboard-only, coarse-pointer-equivalent, and reduced-motion modes.

## Rollout and Commit Strategy

Implementation is split into independently testable vertical slices:

1. Global motion, focus, touch, and route foundations.
2. Authenticated navigation and workspace atmosphere.
3. Jobs keyboard, list semantics, virtualization, and URL restoration.
4. Shared tabs and migration of Jobs, Resume, and Discover.
5. Fetch combobox, validation, filter, progress, and retry behavior.
6. Discover localization and user-safe failure states.
7. Landing and login performance and accessibility.
8. Full regression, browser validation, independent review, scoring, and final commit.

Each slice has a failing test before implementation and a focused commit after its verification passes. If a slice exposes a pre-existing unrelated failure, that failure is documented and isolated rather than hidden by weakening a gate.

## Explicit Non-goals

- No visual rebrand, new color palette, or typography replacement.
- No change to invite-only authentication or product authorization rules.
- No new job sources, AI provider, resume content model, or extension capability.
- No database migration solely for UI state.
- No speculative analytics, haptics, WebGL, or animation dependency.
- No broad refactor of unrelated backend or extension code.

## Acceptance Criteria

- Current business flows and Aurora Deep identity remain recognizable and intact.
- First server-rendered content is visible without waiting for hydration.
- Browser Back restores Jobs context instead of forcing a reset.
- Jobs shortcuts never intercept nested interactive widgets.
- Virtualized lists do not overlap or jump with 81 or more varied rows.
- All scoped mobile and coarse-pointer actions meet the 44-pixel hit-area floor.
- App routes provide a skip link, stable main landmark, and deterministic focus behavior.
- Jobs, Resume, and Discover tabs pass the WAI-ARIA keyboard and relationship model.
- Fetch suggestions expose a complete combobox model and preserve typed input through failures.
- Form errors identify and focus the exact field that needs correction.
- Every Framer Motion, CSS, and programmatic scroll path respects reduced motion.
- Hidden marketing demos and hidden-document timers stop updating.
- Authenticated pages use a lower-cost atmosphere than marketing pages.
- User-visible Discover copy is localized and contains no deployment instructions.
- Automated verification and production builds pass without suppressing failures.
- Browser validation passes at 375, 768, 1024, and 1440 pixels in both themes.
- Final strict UI/UX score is recalculated from evidence; 92-94/100 is the target, not a guaranteed claim.
