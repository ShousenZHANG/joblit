# Mobile UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve mobile responsiveness and interaction smoothness on the core authenticated product paths.

**Architecture:** Keep the current Next.js app router and component boundaries. Make targeted changes in the app shell, Jobs panels, and Resume action bar, backed by responsive layout tests and existing page tests.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS v4, Vitest, Testing Library.

---

### Task 1: Jobs Mobile Panel Contract

**Files:**
- Modify: `app/(app)/jobs/JobsClient.test.tsx`
- Modify: `app/(app)/jobs/JobsClient.tsx`
- Modify: `app/(app)/jobs/components/JobDetailPanel.tsx`

**Steps:**
1. Add a failing test that renders `JobsClient` and asserts results/details panels use a flexible mobile height contract instead of only `h-[calc(100dvh-240px)]`.
2. Run `npm test -- "app/(app)/jobs/JobsClient.test.tsx"` and confirm the test fails.
3. Replace brittle mobile panel height classes with a reusable mobile-friendly class using `min-h`, `max-h`, and `lg:h-auto`.
4. Re-run the targeted test and confirm it passes.

### Task 2: Resume Mobile Action Bar

**Files:**
- Modify: `app/(app)/resume/ResumeForm.test.tsx`
- Modify: `components/resume/ResumeActionBar.tsx`

**Steps:**
1. Add a failing test asserting the action row can wrap and keeps safe-area padding.
2. Run `npm test -- "app/(app)/resume/ResumeForm.test.tsx"` and confirm the test fails.
3. Update the action bar layout so status and actions do not overflow on narrow screens.
4. Re-run the targeted test and confirm it passes.

### Task 3: Shared Mobile Scroll Polish

**Files:**
- Modify: `app/globals.css`

**Steps:**
1. Add or update CSS tests only if an existing test covers the relevant class contract; otherwise keep the CSS change minimal.
2. Add mobile scroll polish for `.app-shell`, `.jobs-scroll-area`, and card scroll regions: momentum scrolling, overscroll containment, and reduced-motion protection for decorative transitions.
3. Run `npm run lint`, `npm test`, and `npm run build`.

