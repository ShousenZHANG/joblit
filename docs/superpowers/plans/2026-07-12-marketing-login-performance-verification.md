# Joblit Marketing, Login, Performance, and Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove hidden rendering and event-loop costs from the premium marketing/login experience, then verify and score the complete full-product UI/UX release.

**Architecture:** Isolate the Hero's changing product demo so only that subtree updates, pause it when invisible, and make pointer effects geometry-cached and frame-coalesced. Replace high-frequency global activity work, make login and legal interactions fully accessible, then run every repository and browser gate before publishing an evidence-based score.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Framer Motion 12, next-intl 4, Vitest 4, Testing Library, Next production build, Python pytest, Chrome extension Vite build, in-app browser verification.

## Global Constraints

- Preserve the Aurora Deep brand, landing information architecture, and login provider flow.
- The marketing surface may keep full atmosphere; hidden or offscreen demos do no state work.
- Pointer movement performs no uncoalesced layout reads.
- First server-rendered content remains visible before hydration.
- Reduced motion disables programmatic smooth scrolling and decorative motion.
- Login errors are announced once and the Suspense boundary never renders a blank fallback.
- Add no animation framework, WebGL, canvas trail, or per-row entrance system.
- Do not weaken lint, tests, coverage, dependency, dead-code, build, or extension gates.
- Final scoring is evidence-based; 92-94/100 is a target rather than a guaranteed claim.
- Every behavior change follows red-green-refactor.

---

## File Structure

- `components/landing/HeroProductDemo.tsx`: isolated active-row timer and product mock subtree.
- `components/landing/Hero.tsx`: static headline/CTA orchestration and demo container.
- `components/landing/lib/interactive.tsx`: cached geometry and animation-frame pointer updates.
- `app/(app)/jobs/[id]/tailor/PdfPreview.tsx`: low-churn idle refresh activity.
- `app/(marketing)/LegalTableOfContents.tsx`: reduced-motion-aware scrolling.
- `app/(auth)/login/page.tsx`: stable Suspense fallback and announced authentication errors.
- `docs/audits/2026-07-12-uiux-final.md`: final evidence, scores, residual risks, and commit references.

### Task 1: Isolate and pause the Hero product demo

**Files:**
- Create: `components/landing/HeroProductDemo.tsx`
- Create: `components/landing/HeroProductDemo.test.tsx`
- Modify: `components/landing/Hero.tsx`
- Modify: `app/(marketing)/page.test.tsx`

**Interfaces:**
- Produces: `HeroProductDemo({ mounted, reduced }: { mounted: boolean; reduced: boolean | null })`.
- Owns: `activeRow`, viewport state, document visibility state, and the 2.6-second interval.
- Preserves: existing mock copy, layout, row styling, stagger timing, and accessibility-hidden decoration.

- [ ] **Step 1: Write failing interval lifecycle tests**

```tsx
it("advances only while the demo is visible", () => {
  vi.useFakeTimers();
  inView = true;
  render(<HeroProductDemo mounted reduced={false} />);
  expect(screen.getByTestId("hero-demo-row-0")).toHaveAttribute("data-active", "true");
  act(() => vi.advanceTimersByTime(2600));
  expect(screen.getByTestId("hero-demo-row-1")).toHaveAttribute("data-active", "true");
  inView = false;
  rerender(<HeroProductDemo mounted reduced={false} />);
  act(() => vi.advanceTimersByTime(5200));
  expect(screen.getByTestId("hero-demo-row-1")).toHaveAttribute("data-active", "true");
});

it("pauses while the document is hidden and for reduced motion", () => {
  setDocumentVisibility("hidden");
  render(<HeroProductDemo mounted reduced={false} />);
  act(() => vi.advanceTimersByTime(5200));
  expect(screen.getByTestId("hero-demo-row-0")).toHaveAttribute("data-active", "true");
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- components/landing/HeroProductDemo.test.tsx 'app/(marketing)/page.test.tsx'`

Expected: FAIL because the demo is embedded in Hero and its interval runs whenever reduced motion is false.

- [ ] **Step 3: Extract the changing subtree and pause its clock**

```tsx
export function HeroProductDemo({ mounted, reduced }: HeroProductDemoProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { amount: 0.15, margin: "120px 0px" });
  const [documentVisible, setDocumentVisible] = useState(true);
  const [activeRow, setActiveRow] = useState(0);

  useEffect(() => {
    const sync = () => setDocumentVisible(document.visibilityState === "visible");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  useEffect(() => {
    if (reduced || !inView || !documentVisible) return;
    const id = window.setInterval(
      () => setActiveRow((index) => (index + 1) % JOB_ROWS.length),
      2600,
    );
    return () => window.clearInterval(id);
  }, [documentVisible, inView, reduced]);

  return <div ref={rootRef}>{/* existing product mock markup */}</div>;
}
```

Move `JOB_ROWS`, sidebar mock constants, and the complete changing mock tree into the new component. Keep the headline, CTA, meta copy, scroll transform, TiltCard, and outer canvas in Hero. Remove `activeRow` and its interval from Hero so interval updates cannot rerender the headline tree.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- components/landing/HeroProductDemo.test.tsx 'app/(marketing)/page.test.tsx'`

Expected: interval start, pause, resume, hidden document, reduced motion, and landing structure tests pass.

- [ ] **Step 5: Commit**

```bash
git add components/landing/Hero.tsx components/landing/HeroProductDemo.tsx components/landing/HeroProductDemo.test.tsx 'app/(marketing)/page.test.tsx'
git commit -m "perf(landing): pause and isolate the hero demo"
```

### Task 2: Cache pointer geometry and coalesce pointer updates

**Files:**
- Modify: `components/landing/lib/interactive.tsx`
- Create: `components/landing/lib/interactive.test.tsx`

**Interfaces:**
- Produces: internal `useCachedRect<T extends HTMLElement>()` returning `ref`, `readRect`, and `clearRect`.
- Preserves: Magnetic, TiltCard, and Spotlight public props and visual strength.
- Guarantees: pointermove handlers never call `getBoundingClientRect()` directly.

- [ ] **Step 1: Write failing layout-read tests**

```tsx
it("reads geometry on entry, not on every spotlight move", () => {
  const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
  render(<SpotlightHarness />);
  const card = screen.getByTestId("spotlight");
  fireEvent.pointerEnter(card, { clientX: 10, clientY: 10 });
  for (let index = 0; index < 20; index += 1) {
    fireEvent.pointerMove(card, { clientX: 20 + index, clientY: 30 + index });
  }
  act(() => runAnimationFrame());
  expect(rect).toHaveBeenCalledTimes(1);
});

it.each(["magnetic", "tilt"])("coalesces %s pointer writes", (kind) => {
  renderInteraction(kind);
  fireTwentyPointerMoves();
  expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- components/landing/lib/interactive.test.tsx`

Expected: FAIL because every pointermove currently reads layout and Magnetic/Tilt write motion values immediately.

- [ ] **Step 3: Implement cached geometry**

```tsx
function useCachedRect<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const rect = useRef<DOMRect | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => { rect.current = element.getBoundingClientRect(); };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return {
    ref,
    readRect: () => rect.current,
    refreshRect: () => {
      if (ref.current) rect.current = ref.current.getBoundingClientRect();
    },
    clearRect: () => { rect.current = null; },
  };
}
```

On `pointerenter`, refresh once. On `pointermove`, store only the latest client coordinates and schedule one animation frame. That frame uses the cached rect and writes CSS variables or motion values. On leave, cancel the frame, clear geometry, and spring values back to zero. Retain fine-pointer and reduced-motion no-op branches.

- [ ] **Step 4: Verify GREEN and cleanup**

Run: `npm test -- components/landing/lib/interactive.test.tsx components/landing/Starfield.test.tsx`

Expected: layout reads, rAF coalescing, leave cleanup, coarse pointer, reduced motion, and Starfield tests pass.

- [ ] **Step 5: Commit**

```bash
git add components/landing/lib/interactive.tsx components/landing/lib/interactive.test.tsx
git commit -m "perf(landing): coalesce pointer interactions"
```

### Task 3: Remove global activity churn and respect legal-page motion preference

**Files:**
- Modify: `app/(app)/jobs/[id]/tailor/PdfPreview.tsx`
- Modify: `app/(app)/jobs/[id]/tailor/tailorA11y.test.tsx`
- Modify: `app/(marketing)/LegalTableOfContents.tsx`
- Modify: `app/(marketing)/LegalTableOfContents.test.tsx`

**Interfaces:**
- Changes: PDF idle refresh listens to `pointerdown`, `keydown`, `focus`, and `visibilitychange`, not `pointermove`.
- Consumes: `useReducedMotion()` for legal table-of-contents behavior.
- Preserves: one refresh after 30 seconds of inactivity and re-arm after later activity.

- [ ] **Step 1: Write failing timer and reduced-scroll tests**

```tsx
it("does not rebuild the idle timer during pointer movement", () => {
  renderPdfPreview({ autoRefresh: true });
  const clearSpy = vi.spyOn(window, "clearTimeout");
  for (let index = 0; index < 30; index += 1) fireEvent.pointerMove(window);
  expect(clearSpy).not.toHaveBeenCalled();
  fireEvent.pointerDown(window);
  expect(clearSpy).toHaveBeenCalledTimes(1);
});

it("uses immediate legal scrolling for reduced motion", () => {
  reducedMotion = true;
  render(<LegalTableOfContents items={MOCK_ITEMS} />);
  fireEvent.click(screen.getAllByRole("button", { name: "1. First Section" })[0]);
  expect(mockScrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- 'app/(app)/jobs/[id]/tailor/tailorA11y.test.tsx' 'app/(marketing)/LegalTableOfContents.test.tsx'`

Expected: FAIL because pointermove rebuilds the timeout and legal scrolling is always smooth.

- [ ] **Step 3: Replace activity signals and add motion-aware scrolling**

Keep `arm()` idempotent, set `idleTimerRef.current = null` after refresh fires, and listen to meaningful activity only:

```tsx
window.addEventListener("keydown", arm);
window.addEventListener("pointerdown", arm, { passive: true });
window.addEventListener("focus", arm);
document.addEventListener("visibilitychange", arm);
```

Remove all four listeners during cleanup. In LegalTableOfContents, use `const reduced = useReducedMotion()` and call `scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" })`.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm test -- 'app/(app)/jobs/[id]/tailor/tailorA11y.test.tsx' 'app/(marketing)/LegalTableOfContents.test.tsx'`

Expected: timer lifecycle, refresh, cleanup, standard scrolling, and reduced scrolling tests pass.

```bash
git add 'app/(app)/jobs/[id]/tailor/PdfPreview.tsx' 'app/(app)/jobs/[id]/tailor/tailorA11y.test.tsx' 'app/(marketing)/LegalTableOfContents.tsx' 'app/(marketing)/LegalTableOfContents.test.tsx'
git commit -m "perf(ui): reduce global activity and scroll motion"
```

### Task 4: Stable login fallback and announced authentication errors

**Files:**
- Modify: `app/(auth)/login/page.tsx`
- Create: `app/(auth)/login/page.test.tsx`
- Modify: `messages/en.json`
- Modify: `messages/zh.json`

**Interfaces:**
- Produces: `LoginCardFallback` with the same max width and minimum card height as the loaded card.
- Produces: `role="alert"` for access-denied and generic authentication failures.
- Preserves: OAuth callback URL, duplicate-submit prevention, provider branding, and entrance sequence.

- [ ] **Step 1: Write failing login state tests**

```tsx
it("renders a stable card while search params suspend", () => {
  render(<LoginPage />);
  expect(screen.getByTestId("login-card-fallback")).toHaveClass("max-w-md", "min-h-[420px]");
});

it.each(["AccessDenied", "OAuthCallback"])("announces %s errors", (error) => {
  mockSearchParams.set("error", error);
  render(<LoginPage />);
  expect(screen.getByRole("alert")).toBeInTheDocument();
});

it("keeps provider width stable and blocks duplicate sign-in", async () => {
  render(<LoginPage />);
  const google = screen.getByRole("button", { name: messages.loginPage.continueGoogle });
  await user.dblClick(google);
  expect(signIn).toHaveBeenCalledTimes(1);
  expect(google).toHaveAttribute("aria-busy", "true");
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- 'app/(auth)/login/page.test.tsx'`

Expected: FAIL because Suspense fallback is null and error surfaces lack alert semantics.

- [ ] **Step 3: Implement the stable fallback and error announcements**

```tsx
function LoginCardFallback() {
  const t = useTranslations("loginPage");
  return (
    <main className="relative min-h-screen overflow-hidden px-6 pb-16 pt-8">
      <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-5xl items-center justify-center">
        <div
          data-testid="login-card-fallback"
          role="status"
          aria-label={t("loading")}
          className="min-h-[420px] w-full max-w-md animate-pulse rounded-3xl border border-border/60 bg-card/70 motion-reduce:animate-none"
        />
      </div>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense fallback={<LoginCardFallback />}><LoginPageInner /></Suspense>;
}
```

Wrap the access-denied explanatory block and generic error block in one `role="alert"` region per rendered error. Do not add an assertive live region to provider loading; `aria-busy` and the changed button text already expose it.

Add `loginPage.loading` as `Loading sign in` in English and `正在加载登录页面` in Chinese.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm test -- 'app/(auth)/login/page.test.tsx'`

Expected: fallback, errors, callback, provider loading, and duplicate-click tests pass.

```bash
git add 'app/(auth)/login/page.tsx' 'app/(auth)/login/page.test.tsx' messages/en.json messages/zh.json
git commit -m "fix(auth): stabilize and announce login states"
```

### Task 5: Complete regression, browser validation, independent review, and scoring

**Files:**
- Create: `docs/audits/2026-07-12-uiux-final.md`
- Modify only if required by verified failures: files changed by Plans 1-4 and their tests.

**Interfaces:**
- Consumes: every commit from the four approved implementation plans.
- Produces: clean verification evidence, browser screenshots/notes, residual-risk list, and final UI/UX score.
- Produces: one final quality commit only when verification or review requires a corrective patch.

- [ ] **Step 1: Run targeted UI/UX regressions**

Run:

```bash
npm test -- app/RouteTransition.test.tsx components/app-shell/AppNav.test.tsx components/ui/interaction-primitives.test.tsx components/ui/useAccessibleTabs.test.tsx components/ui/useAccessibleCombobox.test.tsx 'app/(app)/jobs/JobsClient.test.tsx' 'app/(app)/fetch/FetchClient.test.tsx' 'app/(app)/resume/ResumeForm.test.tsx' 'app/(app)/discover/DiscoverClient.test.tsx' 'app/(app)/discover/components/VideoList.test.tsx' components/landing/HeroProductDemo.test.tsx components/landing/lib/interactive.test.tsx 'app/(auth)/login/page.test.tsx'
```

Expected: all targeted tests pass without console, act, hydration, or jsdom warnings.

- [ ] **Step 2: Run complete repository gates**

Run each command separately and preserve its exit code:

```bash
npm run lint
npm run deps:policy
npm run deps:audit
npm run deadcode
npm run test:coverage
npm run build
python -m pytest tools/fetcher -q
npm --prefix chrome-extension run test:coverage
npm --prefix chrome-extension run deps:audit
npm --prefix chrome-extension run build
```

Expected: every command exits 0; dependency audits report no high-severity production vulnerability; builds finish without suppressed errors.

- [ ] **Step 3: Run real-browser responsive and interaction checks**

Start the verified production build with `npm run start`. Use the in-app browser and its existing authenticated session where available. Check `/`, `/login`, `/jobs`, `/fetch`, `/resume`, and `/discover` at widths 375, 768, 1024, and 1440. For every route:

- Verify no horizontal overflow, clipped dialog, hidden primary action, or layout jump.
- Verify light and dark theme contrast and focus visibility.
- Navigate keyboard-only through skip link, AppNav, tabs, comboboxes, lists, dialogs, and actions.
- Emulate reduced motion and confirm no route scale, smooth programmatic scroll, pulsing skeleton, or decorative repeat remains.
- Confirm Jobs Back restores filter, selection, and scroll context.
- Confirm the 81-row Jobs fixture has no overlap or jump.
- Confirm touch targets measure at least 44 by 44 pixels on the mobile/coarse-pointer checks.
- Confirm Discover never exposes `YOUTUBE_API_KEY` or Vercel instructions.

Expected: all checks pass; capture a screenshot and concise evidence note for each width and theme combination that changes layout.

- [ ] **Step 4: Request independent code and UX review**

Dispatch separate reviewers for: (1) route/motion/performance, (2) Jobs state/virtualization/keyboard, and (3) Fetch/Resume/Discover accessibility/localization. Reviewers inspect the actual diff and tests. Fix every verified P0/P1 issue, add a regression test first, rerun the affected targeted suite, and commit the correction with a focused `fix(ui): ...` message.

Expected: no open P0 or P1 review finding; any accepted P2 residual risk is documented with evidence and rationale.

- [ ] **Step 5: Write the final score audit**

`docs/audits/2026-07-12-uiux-final.md` records:

- commit range and clean working-tree status;
- exact commands and pass/fail results;
- browser matrix and screenshots/notes;
- before/after findings for touch, keyboard/ARIA, motion/performance, state restoration, localization, and responsive layout;
- sub-scores for visual consistency, information hierarchy, navigation/CTA, forms/status, motion/perceived performance, responsive/touch, accessibility, themes, and internationalization;
- weighted overall score and residual risks.

Do not claim 92-94 unless the recorded evidence supports it.

- [ ] **Step 6: Commit the audit and verify repository cleanliness**

```bash
git add docs/audits/2026-07-12-uiux-final.md
git commit -m "docs: publish final UIUX verification score"
git status --short
git log -12 --oneline --decorate
```

Expected: the audit commit succeeds, `git status --short` is empty, and the log contains all focused implementation commits plus the final audit.
