# Joblit Workspace Accessibility and Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Fetch, Resume, and Discover to the shared keyboard, touch, localization, error-recovery, and reduced-motion standard.

**Architecture:** Add one focused combobox hook for external-input suggestion lists, then migrate Fetch title and location suggestions to it. Reuse the accessible-tabs hook from the Jobs plan for Resume and Discover, and move all remaining Discover operational copy into the message catalogs without changing page information architecture.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, next-intl 4, TanStack Query 5, Radix Popover/Select, cmdk 1, Framer Motion 12, Vitest 4, Testing Library.

## Global Constraints

- Preserve Fetch pipelines, Resume editing/autosave/PDF behavior, and Discover ranking behavior.
- Inputs retain typed text through suggestion, empty, and error states.
- Form errors identify and focus the exact invalid field.
- Empty and failed async states remain visually and semantically distinct.
- All visible English and Chinese copy comes from message catalogs.
- Deployment instructions are never shown to ordinary Discover users.
- Mobile and coarse-pointer actions use at least a 44-pixel hit area.
- Programmatic scrolling and decorative interaction respect reduced motion.
- Add no combobox or tabs dependency.
- Every behavior change follows red-green-refactor.

---

## File Structure

- `components/ui/useAccessibleCombobox.ts`: active option, input/listbox relationships, and keyboard behavior.
- `app/(app)/fetch/FetchClient.tsx`: Fetch validation, comboboxes, filters, history states, and retry.
- `components/resume/SectionNav.tsx`: accessible mobile section tabs and touch-safe actions.
- `app/(app)/discover/DiscoverClient.tsx`: accessible primary Discover tabs.
- `app/(app)/discover/components/VideoList.tsx`: accessible category tabs and user-safe states.
- `app/(app)/discover/components/VideoCard.tsx`: localized labels, quality signals, and touch-safe actions.
- `messages/en.json`, `messages/zh.json`: exact user-facing copy for all three workflows.

### Task 1: Shared external-input combobox behavior

**Files:**
- Create: `components/ui/useAccessibleCombobox.ts`
- Create: `components/ui/useAccessibleCombobox.test.tsx`

**Interfaces:**
- Produces: `useAccessibleCombobox<T>(options)`.
- Produces: `inputProps`, `listboxProps`, `getOptionProps(item, index)`, `activeIndex`, and `setActiveIndex`.
- Consumes: caller-owned `open`, filtered `items`, and `onSelect`.

- [ ] **Step 1: Write failing combobox semantics and keyboard tests**

```tsx
function Harness() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const items = ["Sydney", "Melbourne"];
  const box = useAccessibleCombobox({
    id: "location",
    open,
    setOpen,
    items,
    onSelect: (item) => { setValue(item); setOpen(false); },
  });
  return (
    <>
      <input value={value} onChange={(e) => setValue(e.target.value)} {...box.inputProps} />
      {open ? <ul {...box.listboxProps}>{items.map((item, index) => (
        <li key={item} {...box.getOptionProps(item, index)}>{item}</li>
      ))}</ul> : null}
    </>
  );
}

it("supports expanded state, active descendant, arrows, Enter, and Escape", async () => {
  render(<Harness />);
  const input = screen.getByRole("combobox");
  input.focus();
  await user.keyboard("{ArrowDown}");
  expect(input).toHaveAttribute("aria-expanded", "true");
  expect(input).toHaveAttribute("aria-activedescendant", "location-option-0");
  await user.keyboard("{Enter}");
  expect(input).toHaveValue("Sydney");
  await user.keyboard("{ArrowDown}{Escape}");
  expect(input).toHaveAttribute("aria-expanded", "false");
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- components/ui/useAccessibleCombobox.test.tsx`

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement the hook**

```tsx
export function useAccessibleCombobox<T>({
  id, open, setOpen, items, onSelect,
}: {
  id: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  items: readonly T[];
  onSelect: (item: T) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(-1);
  useEffect(() => {
    setActiveIndex((index) => index < items.length ? index : -1);
  }, [items.length]);
  const optionId = (index: number) => `${id}-option-${index}`;
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => {
        const start = index < 0 ? (delta > 0 ? -1 : 0) : index;
        return (start + delta + items.length) % items.length;
      });
    } else if (event.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault();
      onSelect(items[activeIndex]!);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
    }
  };
  return {
    activeIndex,
    setActiveIndex,
    inputProps: {
      role: "combobox" as const,
      "aria-autocomplete": "list" as const,
      "aria-expanded": open,
      "aria-controls": `${id}-listbox`,
      "aria-activedescendant": open && activeIndex >= 0
        ? optionId(activeIndex)
        : undefined,
      onKeyDown,
    },
    listboxProps: { id: `${id}-listbox`, role: "listbox" as const },
    getOptionProps: (item: T, index: number) => ({
      id: optionId(index),
      role: "option" as const,
      "aria-selected": activeIndex === index,
      onMouseEnter: () => setActiveIndex(index),
      onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
      onClick: () => onSelect(item),
    }),
  };
}
```

Guard the modulo calculation when `items.length === 0`; Arrow keys open the list but leave `activeIndex=-1`. Tab is not intercepted.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- components/ui/useAccessibleCombobox.test.tsx`

Expected: expanded, controls, active-descendant, wraparound, Enter, Escape, pointer selection, zero-item, and Tab tests pass.

- [ ] **Step 5: Commit**

```bash
git add components/ui/useAccessibleCombobox.ts components/ui/useAccessibleCombobox.test.tsx
git commit -m "feat(a11y): add reusable suggestion combobox"
```

### Task 2: Fetch comboboxes and field-level validation

**Files:**
- Modify: `app/(app)/fetch/FetchClient.tsx`
- Modify: `app/(app)/fetch/FetchClient.test.tsx`
- Modify: `messages/en.json`
- Modify: `messages/zh.json`

**Interfaces:**
- Consumes: `useAccessibleCombobox` from Task 1.
- Produces: stable ids `fetch-job-title`, `fetch-location`, `fetch-cn-location`, and `fetch-cn-exclude-keywords`.
- Produces: `fetch-job-title-error` referenced by `aria-describedby` when invalid.

- [ ] **Step 1: Write failing Fetch semantics and error-focus tests**

```tsx
it("exposes job-title suggestions as a complete combobox", async () => {
  renderFetch();
  const title = screen.getByLabelText(messages.fetch.jobTitle);
  expect(title).toHaveAttribute("role", "combobox");
  await user.click(title);
  await user.keyboard("{ArrowDown}");
  expect(title).toHaveAttribute("aria-expanded", "true");
  expect(title).toHaveAttribute("aria-activedescendant");
  expect(screen.getByRole("listbox")).toBeInTheDocument();
});

it("focuses and describes an empty required title", async () => {
  renderFetch();
  const title = screen.getByLabelText(messages.fetch.jobTitle);
  await user.clear(title);
  await user.click(screen.getByRole("button", { name: messages.fetch.startFetch }));
  expect(title).toHaveFocus();
  expect(title).toHaveAttribute("aria-invalid", "true");
  expect(title).toHaveAttribute("aria-describedby", "fetch-job-title-error");
  expect(screen.getByText(messages.fetch.jobTitleRequired)).toHaveAttribute("role", "alert");
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- 'app/(app)/fetch/FetchClient.test.tsx'`

Expected: FAIL because the inputs do not expose the full combobox model and empty submission only creates a top error.

- [ ] **Step 3: Migrate both title inputs and LocationCombobox**

Instantiate the shared hook for filtered title suggestions and AU locations. Spread `inputProps` onto each external input, `listboxProps` onto the CommandList, and `getOptionProps` onto each CommandItem through supported DOM props. Keep `onPointerDown` prevention so long touch presses do not blur before selection. Use localized headings and no-results copy.

For both AU and CN title inputs, keep one `titleInputRef`. On invalid submission:

```tsx
setTitleError(t("jobTitleRequired"));
setLocalError(null);
requestAnimationFrame(() => titleInputRef.current?.focus());
return;
```

Set `aria-invalid={Boolean(titleError)}` and `aria-describedby={titleError ? "fetch-job-title-error" : undefined}`. Clear the field error when a non-empty title is entered. Add `htmlFor` and matching ids to CN labels and inputs.

- [ ] **Step 4: Add exact localized copy**

```json
// messages/en.json, inside fetch
"jobTitleRequired": "Enter at least one job title.",
"titleSuggestions": "Job title suggestions",
"popularTitles": "Popular roles",
"noTitleSuggestions": "No matching roles. You can keep your custom title.",
"locationSuggestions": "Location suggestions",
"customLocationHint": "No preset match. Your custom location will be used."
```

```json
// messages/zh.json, inside fetch
"jobTitleRequired": "请至少输入一个职位名称。",
"titleSuggestions": "职位名称建议",
"popularTitles": "热门职位",
"noTitleSuggestions": "没有匹配职位，你可以继续使用自定义名称。",
"locationSuggestions": "地点建议",
"customLocationHint": "没有匹配的预设地点，将使用你输入的地点。"
```

- [ ] **Step 5: Verify GREEN**

Run: `npm test -- 'app/(app)/fetch/FetchClient.test.tsx' components/ui/useAccessibleCombobox.test.tsx`

Expected: Fetch and shared combobox tests pass in English and Chinese fixtures.

- [ ] **Step 6: Commit**

```bash
git add 'app/(app)/fetch/FetchClient.tsx' 'app/(app)/fetch/FetchClient.test.tsx' messages/en.json messages/zh.json
git commit -m "fix(fetch): add accessible suggestions and inline errors"
```

### Task 3: Fetch filters, history recovery, and reduced-motion feedback

**Files:**
- Modify: `app/(app)/fetch/FetchClient.tsx`
- Modify: `app/(app)/fetch/FetchClient.test.tsx`
- Modify: `messages/en.json`
- Modify: `messages/zh.json`

**Interfaces:**
- Produces: `aria-pressed` smart-expand and exclusion chips.
- Produces: Fetch history states `loading | success | error` plus Retry.
- Preserves: already-loaded history rows if a later refresh fails.

- [ ] **Step 1: Write failing state and recovery tests**

```tsx
it("announces filter-chip state and provides touch-safe custom-term removal", async () => {
  renderFetch();
  expect(screen.getByRole("button", { name: messages.fetch.smartExpand })).toHaveAttribute("aria-pressed", "true");
  await addCustomTerm("intern");
  expect(screen.getByRole("button", { name: /remove intern/i })).toHaveClass("min-h-11", "min-w-11");
});

it("distinguishes failed history from an empty history and retries", async () => {
  fetchMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(okRunsResponse);
  renderFetch();
  expect(await screen.findByText(messages.fetch.historyLoadError)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: messages.fetch.retryHistory }));
  expect(await screen.findByText("Frontend Engineer")).toBeInTheDocument();
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- 'app/(app)/fetch/FetchClient.test.tsx'`

Expected: FAIL because chips omit pressed state, custom removal is undersized, and history failures collapse into empty UI.

- [ ] **Step 3: Implement recoverable history and touch-safe filters**

Add `historyState` and a memoized `loadHistory()` callback. Set loading only when no successful rows exist. On failure, retain existing rows, set error state, and render a non-blocking status with a Retry button. The Retry button calls `loadHistory` and is disabled only while its request is active.

Add `aria-pressed={smartExpand}` and `aria-pressed={applyExcludes}`. Replace the custom term's character button with a Lucide `X`, localized label, and `min-h-11 min-w-11 sm:min-h-8 sm:min-w-8`. `handleRerun` reads `useReducedMotion()` and calls `scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })`.

- [ ] **Step 4: Add exact localized recovery copy**

```json
// en fetch
"historyLoadError": "Recent fetches could not be loaded. You can still start a new fetch.",
"retryHistory": "Retry recent fetches",
"removeCustomTerm": "Remove {term}",
"rerunSearch": "Run {title} again"
```

```json
// zh fetch
"historyLoadError": "暂时无法加载最近的抓取记录，你仍然可以开始新的抓取。",
"retryHistory": "重新加载最近记录",
"removeCustomTerm": "移除 {term}",
"rerunSearch": "再次运行 {title}"
```

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- 'app/(app)/fetch/FetchClient.test.tsx' app/FetchProgressPanel.test.tsx`

Expected: Fetch filters, history Retry, retained rows, reduced motion, and existing submit flows pass.

```bash
git add 'app/(app)/fetch/FetchClient.tsx' 'app/(app)/fetch/FetchClient.test.tsx' messages/en.json messages/zh.json
git commit -m "fix(fetch): make filters and history recoverable"
```

### Task 4: Resume mobile tabs, touch targets, and reduced-motion scrolling

**Files:**
- Modify: `components/resume/SectionNav.tsx`
- Modify: `components/resume/ResumePageLayout.tsx`
- Modify: `components/resume/PreviewPanel.tsx`
- Modify: `app/(app)/jobs/[id]/tailor/PdfPreview.tsx`
- Modify: `components/resume/ResumePdfPreview.test.tsx`
- Modify: `app/(app)/resume/ResumeForm.test.tsx`

**Interfaces:**
- Consumes: `useAccessibleTabs` from the Jobs plan.
- Produces: `resume-sections-tab-*` and `resume-sections-panel-*` relationships.
- Preserves: locale-specific section ordering and desktop icon rail.

- [ ] **Step 1: Write failing Resume navigation tests**

```tsx
it("roves mobile section tabs and links them to panels", async () => {
  renderResume();
  const personal = screen.getByRole("tab", { name: messages.resume.personalInfo });
  const summary = screen.getByRole("tab", { name: messages.resume.summary });
  expect(personal).toHaveAttribute("aria-controls", "resume-sections-panel-personal");
  personal.focus();
  await user.keyboard("{ArrowRight}");
  expect(summary).toHaveFocus();
  expect(summary).toHaveAttribute("aria-selected", "true");
});

it("uses touch-safe preview and save actions", () => {
  renderResume();
  expect(screen.getByRole("button", { name: messages.resume.preview })).toHaveClass("h-11", "w-11");
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- 'app/(app)/resume/ResumeForm.test.tsx'`

Expected: FAIL because section tabs have no relationships or roving keys and mobile actions are 36 pixels.

- [ ] **Step 3: Apply the shared tabs and motion contract**

Create `tabs = useAccessibleTabs({ id: "resume-sections", value: activeSection, values: visibleSections.map(section => section.id), onValueChange: setActiveSection })`. Spread tab props on mobile section buttons. Add the matching active panel id and `aria-labelledby` relationship to the section-content wrapper in `ResumePageLayout.tsx`; keep the desktop section layout visible and preserve existing locale ordering.

Use `useReducedMotion()` and change active-section scrolling to `behavior: reduced ? "auto" : "smooth"`. Remove unconditional `scroll-smooth`. Make mobile Preview and Save `h-11 w-11`, retain 16-pixel icons, and add the shared focus-visible ring. In both Resume PreviewPanel and the tailor PdfPreview toolbar, make zoom, fit, download, and refresh controls `h-11 min-w-11 sm:h-7 sm:min-w-7`; preserve icon size and add visible focus rings. The toolbar header grows only on mobile so the document canvas does not lose desktop space.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm test -- 'app/(app)/resume/ResumeForm.test.tsx' components/resume/ResumePdfPreview.test.tsx`

Expected: Resume navigation, save, preview, PDF, ordering, and reduced-motion tests pass.

```bash
git add components/resume/SectionNav.tsx components/resume/ResumePageLayout.tsx components/resume/PreviewPanel.tsx components/resume/ResumePdfPreview.test.tsx 'app/(app)/jobs/[id]/tailor/PdfPreview.tsx' 'app/(app)/resume/ResumeForm.test.tsx'
git commit -m "fix(resume): make section navigation fully accessible"
```

### Task 5: Discover tabs, localization, and user-safe failure states

**Files:**
- Modify: `app/(app)/discover/DiscoverClient.tsx`
- Modify: `app/(app)/discover/components/VideoList.tsx`
- Modify: `app/(app)/discover/components/VideoList.test.tsx`
- Modify: `app/(app)/discover/components/VideoCard.tsx`
- Create: `app/(app)/discover/DiscoverClient.test.tsx`
- Modify: `messages/en.json`
- Modify: `messages/zh.json`

**Interfaces:**
- Consumes: `useAccessibleTabs` with automatic activation for primary content and manual activation for network-backed categories.
- Produces: fully localized Discover labels, signals, tooltips, and states.
- Preserves: server-owned ranking, URL filter parameters, watched sinking, and favorite behavior.

- [ ] **Step 1: Write failing tabs and localization tests**

```tsx
it("links Discover tabs and supports arrow navigation", async () => {
  renderDiscover();
  const trending = screen.getByRole("tab", { name: messages.discover.tabTrending });
  const videos = screen.getByRole("tab", { name: messages.discover.tabVideos });
  expect(trending).toHaveAttribute("aria-controls", "discover-primary-panel-trending");
  trending.focus();
  await user.keyboard("{ArrowRight}");
  expect(videos).toHaveFocus();
});

it("never exposes deployment instructions to a normal user", async () => {
  mockVideos({ noApiKey: true, items: [] });
  renderVideoList("zh");
  expect(await screen.findByText(zh.discover.videosUnavailableTitle)).toBeInTheDocument();
  expect(screen.queryByText(/YOUTUBE_API_KEY|Vercel/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- 'app/(app)/discover/DiscoverClient.test.tsx' 'app/(app)/discover/components/VideoList.test.tsx'`

Expected: FAIL because tabs lack complete relationships and many labels are hard-coded English or deployment guidance.

- [ ] **Step 3: Apply shared tabs and touch contracts**

Use `useAccessibleTabs` for the two primary tabs and for video categories. Category tabs use `activationMode="manual"` so arrow exploration does not trigger network requests; Enter or Space commits the focused category. Add 44-pixel mobile targets to category, favorite, retry, open, sort, and period controls while preserving compact desktop heights with `sm:h-8`.

Use `motion-safe:` for thumbnail scale and play-button scale. Favorite and external-link buttons receive `h-11 w-11 sm:h-8 sm:w-8` and visible focus rings.

- [ ] **Step 4: Replace visible hard-coded copy with exact message keys**

```json
// en discover additions
"sectionsLabel": "Discover sections",
"videoCategoriesLabel": "Video categories",
"categoryAll": "All",
"categoryCodex": "Codex",
"categoryClaude": "Claude",
"categoryAnthropic": "Anthropic",
"categoryRag": "RAG",
"categoryAgents": "Agents",
"categoryAgentSkills": "Agent Skills",
"categoryHarnessEngineering": "Harness engineering",
"sortVideos": "Sort videos",
"timePeriod": "Time period",
"videosUnavailableTitle": "Videos are temporarily unavailable",
"videosUnavailableHint": "Try again later or browse trending repositories.",
"videoLoadError": "Videos could not be loaded.",
"retryVideos": "Retry videos",
"cachedVideos": "Showing cached results from {time} because the video service is temporarily limited.",
"playOnYouTube": "Play on YouTube: {title}",
"openOnYouTube": "Open on YouTube",
"addFavorite": "Add to favorites",
"removeFavorite": "Remove from favorites",
"watched": "Watched",
"qualityHighMatch": "High match",
"qualityPopular": "Popular",
"qualityTrusted": "Trusted source",
"qualityPractical": "Practical length",
"trustOfficial": "Official",
"trustIndependent": "Trusted",
"trustExpert": "Expert",
"trustOfficialHint": "Official or foundational creator",
"trustIndependentHint": "Top independent voice",
"trustExpertHint": "Niche expert",
"favoritesEmptyHint": "Star a video to add it here",
"showAllTitle": "Show all videos",
"showFavoritesTitle": "Show favorite videos only"
```

```json
// zh discover additions
"sectionsLabel": "发现内容分区",
"videoCategoriesLabel": "视频分类",
"categoryAll": "全部",
"categoryCodex": "Codex",
"categoryClaude": "Claude",
"categoryAnthropic": "Anthropic",
"categoryRag": "RAG",
"categoryAgents": "智能体",
"categoryAgentSkills": "智能体技能",
"categoryHarnessEngineering": "工程实践",
"sortVideos": "视频排序",
"timePeriod": "时间范围",
"videosUnavailableTitle": "视频内容暂时不可用",
"videosUnavailableHint": "请稍后重试，或先浏览热门开源项目。",
"videoLoadError": "暂时无法加载视频。",
"retryVideos": "重新加载视频",
"cachedVideos": "视频服务暂时受限，当前展示 {time} 的缓存结果。",
"playOnYouTube": "在 YouTube 播放：{title}",
"openOnYouTube": "在 YouTube 打开",
"addFavorite": "添加到收藏",
"removeFavorite": "从收藏中移除",
"watched": "已观看",
"qualityHighMatch": "高度相关",
"qualityPopular": "热门内容",
"qualityTrusted": "可信来源",
"qualityPractical": "实用时长",
"trustOfficial": "官方",
"trustIndependent": "可信创作者",
"trustExpert": "领域专家",
"trustOfficialHint": "官方或奠基型创作者",
"trustIndependentHint": "优质独立创作者",
"trustExpertHint": "垂直领域专家",
"favoritesEmptyHint": "收藏视频后可在这里快速查看",
"showAllTitle": "显示全部视频",
"showFavoritesTitle": "仅显示收藏视频"
```

- [ ] **Step 5: Verify the complete workspace plan**

Run: `npm test -- 'app/(app)/fetch/FetchClient.test.tsx' 'app/(app)/resume/ResumeForm.test.tsx' 'app/(app)/discover/DiscoverClient.test.tsx' 'app/(app)/discover/components/VideoList.test.tsx'`

Expected: all workspace tests pass in both locale fixtures.

Run: `npm run lint`

Expected: exit 0 with no new hard-coded-copy or accessibility issues.

- [ ] **Step 6: Commit**

```bash
git add 'app/(app)/discover' messages/en.json messages/zh.json
git commit -m "fix(discover): localize and standardize content navigation"
```
