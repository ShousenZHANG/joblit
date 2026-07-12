# Joblit Jobs Interaction and Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Jobs keyboard-safe, semantically complete, stable with large variable-height lists, and restorative across filters, detail selection, and browser history.

**Architecture:** Introduce one tested tabs hook and one pure URL-state codec, then keep JobsClient as the workflow coordinator. Scope keyboard events to the actual list, synchronize row focus and selection, and let TanStack Virtual measure real row heights instead of relying on a fixed estimate.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, TanStack Query 5, TanStack Virtual 3, Framer Motion 12, Vitest 4, Testing Library.

## Global Constraints

- Preserve Jobs search, triage, batch, detail, generation, and deletion business behavior.
- Browser Back restores filters, selected job, view, and native scroll context.
- Jobs shortcuts never intercept nested interactive controls, dialogs, menus, comboboxes, or editable elements.
- Virtualization remains enabled only above 80 items and supports variable row heights.
- Mobile tabs meet the WAI-ARIA relationship and keyboard model.
- Mobile and coarse-pointer actions use at least a 44-pixel hit area.
- Reduced motion removes row movement without hiding state changes.
- Every behavior change follows red-green-refactor.

---

## File Structure

- `components/ui/useAccessibleTabs.ts`: framework-light tab roles, ids, roving focus, and keyboard behavior.
- `app/(app)/jobs/utils/jobsUrlState.ts`: pure parse/serialize logic for filter, selection, and mobile view state.
- `app/(app)/jobs/hooks/useKeyboardNavigation.ts`: list-scoped navigation and focus synchronization.
- `app/(app)/jobs/components/VirtualJobList.tsx`: measured variable-height rows and virtual list semantics.
- `app/(app)/jobs/components/JobListItem.tsx`: active-row focus, set position, and listitem semantics.
- `app/(app)/jobs/JobsClient.tsx`: integrates refs, URL state, tabs, and standard/virtual list contracts.

### Task 1: Shared accessible-tabs behavior

**Files:**
- Create: `components/ui/useAccessibleTabs.ts`
- Create: `components/ui/useAccessibleTabs.test.tsx`

**Interfaces:**
- Produces: `useAccessibleTabs<T extends string>(options)`.
- Produces: `tabListProps`, `getTabProps(value)`, and `getPanelProps(value)`.
- Supports: `activationMode: "automatic" | "manual"`, defaulting to `automatic`.

- [ ] **Step 1: Write the failing keyboard and relationship tests**

```tsx
function Harness() {
  const [value, setValue] = useState<"list" | "detail">("list");
  const tabs = useAccessibleTabs({
    id: "jobs-mobile",
    value,
    values: ["list", "detail"] as const,
    onValueChange: setValue,
  });
  return (
    <>
      <div aria-label="Job views" {...tabs.tabListProps}>
        <button {...tabs.getTabProps("list")}>List</button>
        <button {...tabs.getTabProps("detail")}>Detail</button>
      </div>
      <section {...tabs.getPanelProps("list")}>List panel</section>
      <section {...tabs.getPanelProps("detail")}>Detail panel</section>
    </>
  );
}

it("links tabs to panels and roves focus with arrows, Home, and End", async () => {
  render(<Harness />);
  const list = screen.getByRole("tab", { name: "List" });
  const detail = screen.getByRole("tab", { name: "Detail" });
  expect(list).toHaveAttribute("aria-controls", "jobs-mobile-panel-list");
  expect(detail).toHaveAttribute("tabindex", "-1");
  await user.click(list);
  await user.keyboard("{ArrowRight}");
  expect(detail).toHaveFocus();
  expect(detail).toHaveAttribute("aria-selected", "true");
  await user.keyboard("{Home}");
  expect(list).toHaveFocus();
});

it("moves focus without activation in manual mode until Enter", async () => {
  render(<ManualHarness />);
  const first = screen.getByRole("tab", { name: "First" });
  const second = screen.getByRole("tab", { name: "Second" });
  first.focus();
  await user.keyboard("{ArrowRight}");
  expect(second).toHaveFocus();
  expect(first).toHaveAttribute("aria-selected", "true");
  await user.keyboard("{Enter}");
  expect(second).toHaveAttribute("aria-selected", "true");
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- components/ui/useAccessibleTabs.test.tsx`

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement the hook**

```tsx
export function useAccessibleTabs<T extends string>({
  id,
  value,
  values,
  onValueChange,
  activationMode = "automatic",
}: {
  id: string;
  value: T;
  values: readonly T[];
  onValueChange: (value: T) => void;
  activationMode?: "automatic" | "manual";
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const move = (next: T) => {
    refs.current.get(next)?.focus();
    if (activationMode === "automatic") onValueChange(next);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const current = event.currentTarget.dataset.value as T;
    if (activationMode === "manual" && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onValueChange(current);
      return;
    }
    const index = values.indexOf(current);
    let next: T | undefined;
    if (event.key === "ArrowRight") next = values[(index + 1) % values.length];
    if (event.key === "ArrowLeft") next = values[(index - 1 + values.length) % values.length];
    if (event.key === "Home") next = values[0];
    if (event.key === "End") next = values.at(-1);
    if (!next) return;
    event.preventDefault();
    move(next);
  };
  return {
    tabListProps: { role: "tablist" as const },
    getTabProps: (tab: T) => ({
      id: `${id}-tab-${tab}`,
      role: "tab" as const,
      "data-value": tab,
      "aria-selected": value === tab,
      "aria-controls": `${id}-panel-${tab}`,
      tabIndex: value === tab ? 0 : -1,
      ref: (node: HTMLButtonElement | null) => {
        if (node) refs.current.set(tab, node);
        else refs.current.delete(tab);
      },
      onClick: () => onValueChange(tab),
      onKeyDown,
    }),
    getPanelProps: (tab: T) => ({
      id: `${id}-panel-${tab}`,
      role: "tabpanel" as const,
      "aria-labelledby": `${id}-tab-${tab}`,
      hidden: value !== tab,
      tabIndex: 0,
    }),
  };
}
```

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- components/ui/useAccessibleTabs.test.tsx`

Expected: all tab relationship, wraparound, Home, End, click, and manual-activation tests pass.

- [ ] **Step 5: Commit**

```bash
git add components/ui/useAccessibleTabs.ts components/ui/useAccessibleTabs.test.tsx
git commit -m "feat(a11y): add reusable keyboard tabs"
```

### Task 2: Scope Jobs shortcuts and synchronize list focus

**Files:**
- Modify: `app/(app)/jobs/hooks/useKeyboardNavigation.ts`
- Create: `app/(app)/jobs/hooks/useKeyboardNavigation.test.tsx`
- Modify: `app/(app)/jobs/components/JobListItem.tsx`
- Modify: `app/(app)/jobs/JobsClient.tsx`
- Modify: `app/(app)/jobs/JobsClient.test.tsx`

**Interfaces:**
- Changes: `UseKeyboardNavigationOptions` adds `containerRef: RefObject<HTMLElement | null>`.
- Produces: row buttons with `tabIndex={isActive ? 0 : -1}` and `aria-current`.
- Preserves: `j`, `k`, ArrowUp, ArrowDown, and Escape while list focus owns the event.

- [ ] **Step 1: Write failing shortcut-isolation tests**

```tsx
it.each(["button", "select", "[role=combobox]", "[contenteditable=true]"])(
  "does not intercept %s keyboard behavior",
  async (selector) => {
    render(<JobsKeyboardHarness />);
    const target = document.querySelector<HTMLElement>(selector)!;
    target.focus();
    fireEvent.keyDown(target, { key: "ArrowDown" });
    expect(onSelect).not.toHaveBeenCalled();
  },
);

it("moves selection and focus only inside the jobs list", async () => {
  render(<JobsKeyboardHarness />);
  const first = screen.getByRole("button", { name: /first role/i });
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowDown" });
  await waitFor(() => expect(screen.getByRole("button", { name: /second role/i })).toHaveFocus());
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- 'app/(app)/jobs/hooks/useKeyboardNavigation.test.tsx' 'app/(app)/jobs/JobsClient.test.tsx'`

Expected: FAIL because the document listener intercepts unrelated controls and selection does not move focus.

- [ ] **Step 3: Attach the listener to the list and exclude nested widgets**

```ts
const BLOCKING_TARGET = [
  "input", "textarea", "select", "a[href]", "[contenteditable='true']",
  "[role='dialog']", "[role='menu']", "[role='listbox']", "[role='combobox']",
].join(",");

function isOwnedRowTarget(target: EventTarget | null) {
  const element = target instanceof Element ? target : null;
  if (!element) return false;
  return Boolean(element.closest("[data-job-id]")) || !element.closest(BLOCKING_TARGET);
}
```

Inside the effect, add the listener to `containerRef.current`, reject targets outside that element, and call neither `preventDefault` nor `onSelect` for blocked targets. After selection, query `[data-job-id="..."]`, call `focus({ preventScroll: true })`, then `scrollIntoView({ block: "nearest" })`.

In JobsClient, create `const jobListRef = useRef<HTMLDivElement>(null)`, pass it to the hook, add `role="list"` and the ref to both standard and virtual list roots, and ensure the active row button is the single row in the tab order. Give the batch-selection checkbox `min-h-11 min-w-11` while keeping its 18-pixel icon.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- 'app/(app)/jobs/hooks/useKeyboardNavigation.test.tsx' 'app/(app)/jobs/JobsClient.test.tsx'`

Expected: scoped shortcuts, focus movement, Escape, boundary behavior, and existing Jobs tests pass.

- [ ] **Step 5: Commit**

```bash
git add 'app/(app)/jobs/hooks/useKeyboardNavigation.ts' 'app/(app)/jobs/hooks/useKeyboardNavigation.test.tsx' 'app/(app)/jobs/components/JobListItem.tsx' 'app/(app)/jobs/JobsClient.tsx' 'app/(app)/jobs/JobsClient.test.tsx'
git commit -m "fix(jobs): scope keyboard navigation to the list"
```

### Task 3: Measure virtual rows and publish list position

**Files:**
- Modify: `app/(app)/jobs/components/VirtualJobList.tsx`
- Modify: `app/(app)/jobs/components/JobListItem.tsx`
- Create: `app/(app)/jobs/components/VirtualJobList.test.tsx`
- Modify: `app/(app)/jobs/JobsClient.test.tsx`

**Interfaces:**
- Adds: `setSize?: number` and `positionInSet?: number` to JobListItem.
- Produces: measured virtual wrappers with `data-index` and `virtualizer.measureElement`.
- Uses: conservative 132-pixel pre-measure estimate and 12-pixel measured row gap.

- [ ] **Step 1: Write the failing 81-row virtualization regression**

```tsx
it("measures variable rows and publishes virtual list position", () => {
  const items = makeJobs(81, (index) => ({
    title: index % 2 ? `Short ${index}` : `A deliberately long title ${index} with wrapped metadata`,
  }));
  render(<VirtualJobList items={items} {...requiredProps} />);
  expect(measureElement).toHaveBeenCalled();
  const first = screen.getByRole("listitem", { name: /deliberately long/i });
  expect(first).toHaveAttribute("aria-setsize", "81");
  expect(first).toHaveAttribute("aria-posinset", "1");
  expect(first.parentElement).not.toHaveStyle({ height: "88px" });
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- 'app/(app)/jobs/components/VirtualJobList.test.tsx'`

Expected: FAIL because rows are fixed to the estimate, are never measured, and expose no set position.

- [ ] **Step 3: Implement dynamic measurement**

```tsx
const virtualizer = useVirtualizer({
  count: items.length,
  getScrollElement: () => scrollElement,
  estimateSize: () => 132,
  measureElement: (element) => element.getBoundingClientRect().height,
  overscan: 5,
});
```

Each absolute wrapper receives `ref={virtualizer.measureElement}`, `data-index={virtualRow.index}`, and `className="absolute left-0 top-0 w-full pb-3"`. Remove the inline fixed height. Keep the translate transform and disable its transition while scrolling or reduced motion is active. Pass `setSize={items.length}` and `positionInSet={virtualRow.index + 1}` to JobListItem, which sets `aria-setsize` and `aria-posinset` on the listitem wrapper.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- 'app/(app)/jobs/components/VirtualJobList.test.tsx' 'app/(app)/jobs/JobsClient.test.tsx'`

Expected: the 81-row path, measurement, semantics, selection, batch mode, and reduced-motion tests pass.

- [ ] **Step 5: Commit**

```bash
git add 'app/(app)/jobs/components/VirtualJobList.tsx' 'app/(app)/jobs/components/VirtualJobList.test.tsx' 'app/(app)/jobs/components/JobListItem.tsx' 'app/(app)/jobs/JobsClient.test.tsx'
git commit -m "fix(jobs): measure variable-height virtual rows"
```

### Task 4: Persist Jobs filters, selection, and mobile view in the URL

**Files:**
- Create: `app/(app)/jobs/utils/jobsUrlState.ts`
- Create: `app/(app)/jobs/utils/jobsUrlState.test.ts`
- Modify: `app/(app)/jobs/hooks/useJobFilters.ts`
- Modify: `app/(app)/jobs/JobsClient.tsx`
- Modify: `app/(app)/jobs/JobsClient.test.tsx`

**Interfaces:**
- Produces: `parseJobsUrlState(params: URLSearchParams): JobsUrlState`.
- Produces: `writeJobsUrlState(params: URLSearchParams, patch: Partial<JobsUrlState>): URLSearchParams`.
- URL keys: `q`, `status`, `location`, `level`, `job`, and `view`.
- Valid values: status `NEW | APPLIED | REJECTED`; view `list | detail`.

- [ ] **Step 1: Write failing pure codec tests**

```ts
expect(parseJobsUrlState(new URLSearchParams("q=react&status=APPLIED&job=j2&view=detail"))).toEqual({
  q: "react",
  statusFilter: "APPLIED",
  locationFilter: "ALL",
  jobLevelFilter: "ALL",
  selectedId: "j2",
  view: "detail",
});

expect(parseJobsUrlState(new URLSearchParams("status=broken&view=grid"))).toMatchObject({
  statusFilter: "NEW",
  view: "list",
});

expect(writeJobsUrlState(new URLSearchParams("utm=x"), {
  q: "",
  statusFilter: "NEW",
  selectedId: null,
}).toString()).toBe("utm=x");
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- 'app/(app)/jobs/utils/jobsUrlState.test.ts'`

Expected: FAIL because the codec does not exist.

- [ ] **Step 3: Implement the pure codec and initialize filters from it**

```ts
export type JobsUrlState = {
  q: string;
  statusFilter: JobStatus;
  locationFilter: string;
  jobLevelFilter: string;
  selectedId: string | null;
  view: "list" | "detail";
};

export function parseJobsUrlState(params: URLSearchParams): JobsUrlState {
  const status = params.get("status");
  const view = params.get("view");
  return {
    q: params.get("q") ?? "",
    statusFilter: status === "APPLIED" || status === "REJECTED" ? status : "NEW",
    locationFilter: params.get("location") || "ALL",
    jobLevelFilter: params.get("level") || "ALL",
    selectedId: params.get("job"),
    view: view === "detail" ? "detail" : "list",
  };
}
```

`writeJobsUrlState` preserves unrelated parameters, removes values equal to defaults, and encodes non-default values. `useJobFilters` reads the initial state from `useSearchParams`, updates the URL with `router.replace(..., { scroll: false })` after debouncing, and keeps existing query-string construction for the API.

- [ ] **Step 4: Integrate selection and shared mobile tabs**

Initialize `selectedId` and `mobileTab` from the parsed URL. When a user selects a row, replace the `job` value and, below 1024 pixels, set `view=detail`. Use `useAccessibleTabs` for list/detail triggers and apply `getPanelProps` to the result and detail panels while preserving the desktop two-column display. Clearing filters removes their URL keys. A malformed or missing selected id falls back to the first visible item without throwing.

- [ ] **Step 5: Verify restoration GREEN**

Run: `npm test -- 'app/(app)/jobs/utils/jobsUrlState.test.ts' 'app/(app)/jobs/JobsClient.test.tsx'`

Expected: filter serialization, malformed-state fallback, selected-row restoration, mobile tabs keyboard behavior, and existing mutations pass.

Run: `npm run lint`

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add 'app/(app)/jobs/utils/jobsUrlState.ts' 'app/(app)/jobs/utils/jobsUrlState.test.ts' 'app/(app)/jobs/hooks/useJobFilters.ts' 'app/(app)/jobs/JobsClient.tsx' 'app/(app)/jobs/JobsClient.test.tsx'
git commit -m "feat(jobs): restore workspace state from the URL"
```
