# Joblit UI/UX Foundations and Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the shared motion, touch, focus, route, and authenticated-navigation contracts required by every later UI/UX slice.

**Architecture:** Mount the user's motion preference once, add explicit touch-safe primitive variants plus coarse-pointer safeguards, and make the route layer the sole owner of forward-navigation focus. Keep native browser history restoration by removing unconditional scroll resets, then align AppNav and the authenticated atmosphere with these shared contracts.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Framer Motion 12, Tailwind CSS 4, next-intl 4, Radix UI, Vitest 4, Testing Library.

## Global Constraints

- Preserve the existing information architecture, business rules, emerald Aurora identity, and product terminology.
- Use 120/180/260/320 ms interaction timing and `cubic-bezier(0.16, 1, 0.3, 1)` easing.
- All scoped mobile and coarse-pointer controls use a minimum 44 by 44 CSS-pixel hit area.
- Reduced motion removes movement but never removes feedback or content.
- First server-rendered content is visible without waiting for hydration.
- Browser Back and Forward preserve native scroll restoration.
- Add no animation or UI framework dependency.
- Every behavior change follows red-green-refactor.

---

## File Structure

- `app/providers.tsx`: one global Framer Motion preference boundary.
- `components/ui/button.tsx`: explicit touch-safe button variants.
- `components/ui/input.tsx`, `components/ui/select.tsx`, `components/ui/dialog.tsx`: coarse-pointer safeguards and dialog-close sizing.
- `components/ui/skeleton.tsx`: static reduced-motion placeholder.
- `app/RouteTransition.tsx`: first-render visibility and forward-navigation focus only.
- `app/(app)/layout.tsx`: localized skip link, stable main landmark, and reduced workspace atmosphere.
- `components/app-shell/AppNav.tsx`: localized, touch-safe, reduced-motion-aware authenticated navigation.

### Task 1: Global motion preference and static reduced-motion loading states

**Files:**
- Modify: `app/providers.tsx`
- Modify: `components/ui/skeleton.tsx`
- Modify: `app/FetchProgressPanel.tsx`
- Modify: `app/FetchProgressPanel.test.tsx`
- Create: `components/ui/skeleton.test.tsx`

**Interfaces:**
- Produces: root-level `<MotionConfig reducedMotion="user">` covering every Framer Motion consumer.
- Produces: `Skeleton` with `motion-reduce:animate-none`.
- Consumes: existing `useReducedMotion()` behavior in `FetchProgressPanel` and replaces animated width with transform progress.

- [ ] **Step 1: Write failing reduced-motion tests**

```tsx
it("renders skeletons without pulse when reduced motion is requested", () => {
  render(<Skeleton data-testid="skeleton" />);
  expect(screen.getByTestId("skeleton")).toHaveClass("motion-reduce:animate-none");
});

it("uses transform progress and disables decorative repeats", () => {
  renderPanel({ status: "RUNNING", progress: 42 });
  expect(screen.getByTestId("fetch-progress-fill")).toHaveStyle({
    transform: "scaleX(0.42)",
  });
  expect(screen.getByTestId("fetch-progress-panel").className).toContain(
    "motion-reduce:transition-none",
  );
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- components/ui/skeleton.test.tsx app/FetchProgressPanel.test.tsx`

Expected: FAIL because Skeleton has no reduced-motion class and FetchProgressPanel does not expose transform-based progress test ids.

- [ ] **Step 3: Mount MotionConfig and make loading states motion-safe**

```tsx
import { MotionConfig } from "framer-motion";

return (
  <ThemeProvider>
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        {/* existing providers remain in the same order */}
      </QueryClientProvider>
    </MotionConfig>
  </ThemeProvider>
);
```

```tsx
className={cn(
  "animate-pulse rounded-md bg-accent motion-reduce:animate-none",
  className,
)}
```

Give the progress fill `origin-left` and `data-testid="fetch-progress-fill"`, set `style={{ transform: \`scaleX(${progress / 100})\` }}`, and transition `transform` only. Replace decorative `animate-ping` and unbounded Framer repeats with `motion-safe:` CSS animation or a reduced-motion static glyph. Keep the active spinner available as a status indicator, but stop its rotation under reduced motion.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- components/ui/skeleton.test.tsx app/FetchProgressPanel.test.tsx`

Expected: both files pass with no act or jsdom warnings.

- [ ] **Step 5: Commit**

```bash
git add app/providers.tsx app/FetchProgressPanel.tsx app/FetchProgressPanel.test.tsx components/ui/skeleton.tsx components/ui/skeleton.test.tsx
git commit -m "fix(ui): honor global reduced-motion preferences"
```

### Task 2: Touch-safe shared controls

**Files:**
- Modify: `components/ui/button.tsx`
- Modify: `components/ui/input.tsx`
- Modify: `components/ui/select.tsx`
- Modify: `components/ui/dialog.tsx`
- Modify: `app/globals.css`
- Create: `components/ui/interaction-primitives.test.tsx`

**Interfaces:**
- Produces: Button sizes `touch` and `icon-touch`.
- Produces: `data-slot` based coarse-pointer minimums for buttons, inputs, select triggers, items, and dialog close.
- Preserves: existing compact desktop variants and component signatures.

- [ ] **Step 1: Write failing primitive sizing tests**

```tsx
it("provides explicit 44px touch button variants", () => {
  render(
    <>
      <Button size="touch">Continue</Button>
      <Button size="icon-touch" aria-label="Menu">M</Button>
    </>,
  );
  expect(screen.getByRole("button", { name: "Continue" })).toHaveClass("h-11");
  expect(screen.getByRole("button", { name: "Menu" })).toHaveClass("size-11");
});

it("renders the default dialog close with a 44px target", () => {
  render(<Dialog open><DialogContent>Body</DialogContent></Dialog>);
  expect(screen.getByRole("button", { name: /close/i })).toHaveClass("size-11");
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- components/ui/interaction-primitives.test.tsx`

Expected: FAIL because the new sizes do not exist and dialog close is icon-sized.

- [ ] **Step 3: Add explicit variants and coarse-pointer safety**

```ts
size: {
  default: "h-9 px-4 py-2 has-[>svg]:px-3",
  sm: "h-8 rounded-lg gap-1.5 px-3 has-[>svg]:px-2.5",
  lg: "h-10 rounded-lg px-6 has-[>svg]:px-4",
  touch: "h-11 rounded-lg px-4 has-[>svg]:px-3",
  icon: "size-9",
  "icon-sm": "size-8",
  "icon-lg": "size-10",
  "icon-touch": "size-11",
}
```

Set the default dialog close to `absolute right-2 top-2 inline-flex size-11 items-center justify-center rounded-full`. Add this CSS safeguard without changing fine-pointer desktop density:

```css
@media (pointer: coarse) {
  [data-slot="button"],
  [data-slot="input"],
  [data-slot="select-trigger"],
  [data-slot="select-item"],
  [data-slot="dialog-close"] {
    min-height: 44px;
  }

  [data-slot="dialog-close"] {
    min-width: 44px;
  }
}
```

- [ ] **Step 4: Verify GREEN and CSS contract**

Run: `npm test -- components/ui/interaction-primitives.test.tsx test/mobileLayoutStyles.test.ts`

Expected: all tests pass and the CSS contract test detects the coarse-pointer block.

- [ ] **Step 5: Commit**

```bash
git add components/ui/button.tsx components/ui/input.tsx components/ui/select.tsx components/ui/dialog.tsx components/ui/interaction-primitives.test.tsx app/globals.css test/mobileLayoutStyles.test.ts
git commit -m "fix(ui): standardize touch-safe controls"
```

### Task 3: First-render-safe route motion, skip link, and focus management

**Files:**
- Modify: `app/RouteTransition.tsx`
- Modify: `app/RouteTransition.test.tsx`
- Modify: `app/(app)/layout.tsx`
- Create: `app/(app)/layout.test.tsx`
- Modify: `messages/en.json`
- Modify: `messages/zh.json`

**Interfaces:**
- Produces: `RouteTransition` that animates only subsequent forward navigations.
- Produces: `#main-content` with `tabIndex={-1}` in the authenticated shell.
- Produces: localized `nav.skipToContent`.
- Preserves: native history scrolling after a `popstate` navigation.

- [ ] **Step 1: Replace the route test with failing first-render, forward, and history assertions**

```tsx
it("shows the first render immediately", () => {
  render(<RouteTransition><div>Content</div></RouteTransition>);
  expect(capturedMotionProps.at(-1)?.initial).toBe(false);
});

it("animates a later forward route without scaling the page", () => {
  mockPathname = "/jobs";
  const view = render(<RouteTransition><div>Jobs</div></RouteTransition>);
  mockPathname = "/resume";
  view.rerender(<RouteTransition><div>Resume</div></RouteTransition>);
  expect(capturedMotionProps.at(-1)?.initial).toEqual({ opacity: 0, y: 4 });
  expect(capturedMotionProps.at(-1)?.animate).toEqual({ opacity: 1, y: 0 });
});

it("does not focus or scroll after browser history navigation", () => {
  window.dispatchEvent(new PopStateEvent("popstate"));
  mockPathname = "/jobs";
  view.rerender(<RouteTransition><div>Jobs</div></RouteTransition>);
  expect(focusMock).not.toHaveBeenCalled();
  expect(window.scrollTo).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- app/RouteTransition.test.tsx 'app/(app)/layout.test.tsx'`

Expected: FAIL because the initial route is hidden/scaled, scroll is forced, and the app layout has no stable main landmark.

- [ ] **Step 3: Implement navigation intent and forward-focus behavior**

```tsx
const firstRender = useRef(true);
const historyNavigation = useRef(false);
const previousPathname = useRef(pathname);

useEffect(() => {
  const markHistoryNavigation = () => { historyNavigation.current = true; };
  window.addEventListener("popstate", markHistoryNavigation);
  return () => window.removeEventListener("popstate", markHistoryNavigation);
}, []);

useLayoutEffect(() => {
  if (previousPathname.current === pathname) return;
  previousPathname.current = pathname;
  const fromHistory = historyNavigation.current;
  historyNavigation.current = false;
  if (!fromHistory) {
    requestAnimationFrame(() => {
      document.getElementById("main-content")?.focus({ preventScroll: true });
    });
  }
}, [pathname]);

const initial = firstRender.current || reduce ? false : { opacity: 0, y: 4 };
useEffect(() => { firstRender.current = false; }, []);
```

Remove both `window.scrollTo` and `.app-shell.scrollTo` from RouteTransition. In the authenticated layout, use `getTranslations("nav")`, render the skip link before AppNav, and wrap RouteTransition in:

```tsx
<main id="main-content" tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
  <RouteTransition>{children}</RouteTransition>
</main>
```

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- app/RouteTransition.test.tsx 'app/(app)/layout.test.tsx'`

Expected: all route and layout tests pass; no initial opacity gate and no forced history scroll.

- [ ] **Step 5: Commit**

```bash
git add app/RouteTransition.tsx app/RouteTransition.test.tsx 'app/(app)/layout.tsx' 'app/(app)/layout.test.tsx' messages/en.json messages/zh.json
git commit -m "fix(nav): preserve history and manage route focus"
```

### Task 4: Authenticated navigation and lower-cost workspace atmosphere

**Files:**
- Modify: `components/app-shell/AppNav.tsx`
- Modify: `components/app-shell/AppNav.test.tsx`
- Modify: `app/(app)/layout.tsx`
- Modify: `app/globals.css`
- Modify: `messages/en.json`
- Modify: `messages/zh.json`

**Interfaces:**
- Consumes: global MotionConfig, touch-safe Button variants, and app `#main-content` from Tasks 1-3.
- Produces: localized keys `nav.primary`, `nav.home`, `nav.moreOptions`, and `nav.openCommands`.
- Produces: `.workspace-atmosphere` with at most two low-cost layers and no starfield pointer listener.

- [ ] **Step 1: Add failing AppNav behavior tests**

```tsx
it("localizes navigation and exposes touch-safe controls", () => {
  render(<AppNav />);
  expect(screen.getByTestId("app-nav")).toHaveAttribute("aria-label", "primary");
  expect(screen.getByTestId("app-nav-mobile-menu")).toHaveClass("h-11", "w-11");
  expect(screen.getByRole("button", { name: "openCommands" })).toHaveClass("focus-visible:ring-2");
});

it("does not perform a manual scroll reset from links", async () => {
  render(<AppNav />);
  await user.click(desktopScope().getByRole("link", { name: /resume/i }));
  expect(window.scrollTo).not.toHaveBeenCalled();
});

it("prevents duplicate sign-out and exposes pending state", async () => {
  signOutMock.mockReturnValue(new Promise(() => undefined));
  render(<AppNav />);
  const signOut = screen.getAllByRole("button", { name: /signOut/i })[0];
  await user.dblClick(signOut);
  expect(signOutMock).toHaveBeenCalledTimes(1);
  expect(signOut).toBeDisabled();
  expect(signOut).toHaveAttribute("aria-busy", "true");
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- components/app-shell/AppNav.test.tsx`

Expected: FAIL because AppNav uses hard-coded labels, 32-pixel controls, and manual reset handlers.

- [ ] **Step 3: Implement the navigation contract**

Use `useReducedMotion()` for the entrance and set `initial={reduce ? false : { opacity: 0, y: -8 }}` with 180 ms motion. Delete `useResetScrollOnNavigate` and every `onClick={resetScroll}`. Apply `min-h-11` or `h-11 w-11` on mobile/coarse-facing controls, retain `md:h-9` for desktop density, and add the same `focus-visible:ring-2` contract to links and buttons. Add `aria-haspopup="dialog"` plus pressed/active CSS feedback to the command control.

Guard sign-out with local `signingOut` state. Both desktop and overflow actions call one async `handleSignOut`, are disabled while it is running, set `aria-busy`, and render `tc("signingOut")` without changing button width. Add `common.signingOut` as `Signing out...` in English and `正在退出...` in Chinese.

Replace hard-coded labels with:

```tsx
<nav aria-label={t("primary")}>
<Link aria-label={t("home")} href="/">
<button aria-label={t("openCommands")}>
<button aria-label={t("moreOptions")}>
```

Replace the full authenticated Starfield and four blobs with a decorative `.workspace-atmosphere` containing two spans. CSS keeps them static in light mode, uses a 60-second transform/opacity drift in dark mode, and disables animation for coarse pointers and reduced motion.

- [ ] **Step 4: Verify the foundation slice**

Run: `npm test -- components/app-shell/AppNav.test.tsx app/RouteTransition.test.tsx app/FetchProgressPanel.test.tsx components/ui/interaction-primitives.test.tsx`

Expected: all targeted tests pass.

Run: `npm run lint`

Expected: exit 0 with no new lint errors.

- [ ] **Step 5: Commit**

```bash
git add components/app-shell/AppNav.tsx components/app-shell/AppNav.test.tsx 'app/(app)/layout.tsx' app/globals.css messages/en.json messages/zh.json
git commit -m "feat(ui): refine authenticated navigation chrome"
```
