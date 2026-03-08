# i18n CN/EN Full-Site Language Switching — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a global EN/中文 language toggle that switches the entire site language and market (EN=Overseas, CN=China), using next-intl with cookie-based locale detection (no URL prefix).

**Architecture:** next-intl middleware reads a `locale` cookie to determine language. A `NextIntlClientProvider` in the provider tree delivers translations to client components. A `useMarket()` hook derives market from locale. All per-page market toggles are removed; the single TopNav toggle controls everything.

**Tech Stack:** next-intl, Next.js 16 middleware, localStorage + cookie persistence, JSON translation dictionaries

**Design doc:** `docs/plans/2026-03-08-i18n-cn-en-switching-design.md`

---

### Task 1: Install next-intl

**Files:**
- Modify: `package.json`

**Step 1: Install the dependency**

Run:
```bash
npm install next-intl
```

**Step 2: Verify installation**

Run:
```bash
npm ls next-intl
```
Expected: Shows next-intl version in dependency tree

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install next-intl"
```

---

### Task 2: Create i18n configuration files

**Files:**
- Create: `i18n/routing.ts`
- Create: `i18n/request.ts`

**Step 1: Create routing config**

Create `i18n/routing.ts`:
```typescript
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "zh"],
  defaultLocale: "en",
});
```

**Step 2: Create request config**

Create `i18n/request.ts`:
```typescript
import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { routing } from "./routing";

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("locale")?.value;
  const locale =
    cookieLocale && routing.locales.includes(cookieLocale as "en" | "zh")
      ? cookieLocale
      : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
```

**Step 3: Commit**

```bash
git add i18n/
git commit -m "feat(i18n): add next-intl routing and request config"
```

---

### Task 3: Create translation dictionary files

**Files:**
- Create: `messages/en.json`
- Create: `messages/zh.json`

**Step 1: Create English dictionary**

Create `messages/en.json`:
```json
{
  "common": {
    "signOut": "Sign out",
    "search": "Search",
    "allLocations": "All locations",
    "allLevels": "All levels",
    "all": "All",
    "close": "Close",
    "cancel": "Cancel",
    "confirm": "Confirm",
    "delete": "Delete",
    "save": "Save",
    "loading": "Loading…",
    "noResults": "No results found.",
    "error": "Something went wrong."
  },
  "nav": {
    "jobs": "Jobs",
    "fetch": "Fetch",
    "resume": "Resume",
    "automation": "Automation",
    "guide": "Guide"
  },
  "marketing": {
    "heroTitle": "Find the right roles, faster",
    "heroSubtitle": "Search smarter, compare quickly, and move with clarity. Jobflow helps you discover, track, and apply to jobs with confidence.",
    "feature1Title": "Smart search",
    "feature1Desc": "AI-powered matching surfaces the most relevant roles for your skills and preferences.",
    "feature2Title": "Quick compare",
    "feature2Desc": "Side-by-side views let you evaluate compensation, culture, and growth at a glance.",
    "feature3Title": "Tailored resumes",
    "feature3Desc": "One-click generation produces polished, role-specific resumes and cover letters.",
    "feature4Title": "Auto tracking",
    "feature4Desc": "Every application is logged automatically so nothing slips through the cracks.",
    "step1Title": "Discover roles",
    "step1Desc": "Search across sources with smart filters for title, location, level, and more.",
    "step2Title": "Refine & compare",
    "step2Desc": "Shortlist your top picks and compare them side by side to find the best fit.",
    "step3Title": "Apply with confidence",
    "step3Desc": "Generate tailored documents, track applications, and stay organized end to end.",
    "cta": "Start free",
    "login": "Log in",
    "howItWorks": "How it works",
    "readyToStart": "Ready to take control of your job search?",
    "readyToStartDesc": "Join Jobflow today — it only takes a minute to get started.",
    "getStarted": "Get started — it's free",
    "allRightsReserved": "All rights reserved.",
    "openSource": "Open-source on GitHub",
    "skipToContent": "Skip to content",
    "badge": "Your job search, organized"
  },
  "jobs": {
    "titleOrKeywords": "Title or Keywords",
    "placeholder": "e.g. software engineer",
    "location": "Location",
    "jobLevel": "Job level",
    "status": "Status",
    "posted": "Posted",
    "results": "Results",
    "newestFirst": "Posted: newest",
    "oldestFirst": "Posted: oldest",
    "statusNew": "New",
    "statusApplied": "Applied",
    "statusRejected": "Rejected",
    "noJobs": "No jobs found.",
    "deleteConfirmTitle": "Delete this job?",
    "deleteConfirmDesc": "This action cannot be undone.",
    "generateResume": "Generate Resume",
    "generateCover": "Generate Cover Letter",
    "viewPdf": "View PDF",
    "jobDetails": "Job details",
    "applied": "Applied",
    "company": "Company",
    "type": "Type"
  },
  "fetch": {
    "searchRoles": "Search roles",
    "jobTitle": "Job title",
    "locationLabel": "Location",
    "hoursOld": "Hours old",
    "smartExpand": "Smart expand",
    "excludeTitles": "Exclude titles",
    "startFetch": "Start fetch",
    "fetching": "Fetching…",
    "suggestions": "Suggestions",
    "popular": "Popular",
    "cnCity": "City",
    "cnPlatforms": "Platforms",
    "cnExcludeKeywords": "Exclude keywords",
    "excludeApplied": "Exclude applied"
  },
  "resume": {
    "masterResumes": "Master resumes",
    "masterResumesDesc": "Maintain multiple base resume versions and choose which one drives your CV and CL generation.",
    "managePromptRules": "Manage prompt rules"
  }
}
```

**Step 2: Create Chinese dictionary**

Create `messages/zh.json`:
```json
{
  "common": {
    "signOut": "退出登录",
    "search": "搜索",
    "allLocations": "全部城市",
    "allLevels": "全部级别",
    "all": "全部",
    "close": "关闭",
    "cancel": "取消",
    "confirm": "确认",
    "delete": "删除",
    "save": "保存",
    "loading": "加载中…",
    "noResults": "暂无结果。",
    "error": "出了点问题。"
  },
  "nav": {
    "jobs": "职位",
    "fetch": "抓取",
    "resume": "简历",
    "automation": "自动化",
    "guide": "引导"
  },
  "marketing": {
    "heroTitle": "更快找到合适的职位",
    "heroSubtitle": "智能搜索、快速对比、清晰决策。Jobflow 帮你发现、追踪并自信地申请理想职位。",
    "feature1Title": "智能搜索",
    "feature1Desc": "AI 驱动的匹配算法，为你推荐最相关的职位。",
    "feature2Title": "快速对比",
    "feature2Desc": "并排对比薪资、文化和发展空间，一目了然。",
    "feature3Title": "定制简历",
    "feature3Desc": "一键生成精美的岗位定制简历和求职信。",
    "feature4Title": "自动追踪",
    "feature4Desc": "每一次申请都自动记录，不遗漏任何机会。",
    "step1Title": "发现职位",
    "step1Desc": "跨平台搜索，支持按职位名称、城市、级别等智能筛选。",
    "step2Title": "精选对比",
    "step2Desc": "将心仪职位加入候选列表，并排比较找到最佳匹配。",
    "step3Title": "自信投递",
    "step3Desc": "生成定制文档，追踪申请进度，全程有序管理。",
    "cta": "免费开始",
    "login": "登录",
    "howItWorks": "使用流程",
    "readyToStart": "准备好掌控你的求职过程了吗？",
    "readyToStartDesc": "立即加入 Jobflow — 只需一分钟即可开始。",
    "getStarted": "免费开始使用",
    "allRightsReserved": "保留所有权利。",
    "openSource": "在 GitHub 上开源",
    "skipToContent": "跳到正文",
    "badge": "你的求职管理工具"
  },
  "jobs": {
    "titleOrKeywords": "职位名称或关键词",
    "placeholder": "例如：前端开发工程师",
    "location": "城市",
    "jobLevel": "职级",
    "status": "状态",
    "posted": "发布时间",
    "results": "结果",
    "newestFirst": "最新发布",
    "oldestFirst": "最早发布",
    "statusNew": "新职位",
    "statusApplied": "已投递",
    "statusRejected": "已拒绝",
    "noJobs": "暂无职位。",
    "deleteConfirmTitle": "删除这个职位？",
    "deleteConfirmDesc": "此操作不可撤销。",
    "generateResume": "生成简历",
    "generateCover": "生成求职信",
    "viewPdf": "查看 PDF",
    "jobDetails": "职位详情",
    "applied": "已投递",
    "company": "公司",
    "type": "类型"
  },
  "fetch": {
    "searchRoles": "搜索职位",
    "jobTitle": "职位名称",
    "locationLabel": "城市",
    "hoursOld": "发布时间（小时内）",
    "smartExpand": "智能扩展",
    "excludeTitles": "排除职位",
    "startFetch": "开始抓取",
    "fetching": "抓取中…",
    "suggestions": "建议",
    "popular": "热门",
    "cnCity": "城市",
    "cnPlatforms": "平台",
    "cnExcludeKeywords": "排除关键词",
    "excludeApplied": "排除已投递"
  },
  "resume": {
    "masterResumes": "主简历",
    "masterResumesDesc": "维护多个基础简历版本，选择一个用于生成定制简历和求职信。",
    "managePromptRules": "管理提示词规则"
  }
}
```

**Step 3: Commit**

```bash
git add messages/
git commit -m "feat(i18n): add en.json and zh.json translation dictionaries"
```

---

### Task 4: Create middleware and update next.config.ts

**Files:**
- Create: `middleware.ts`
- Modify: `next.config.ts`

**Step 1: Create middleware**

Create `middleware.ts`:
```typescript
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing, {
  localePrefix: "never",
  localeDetection: false,
});

export const config = {
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
```

**Step 2: Update next.config.ts**

Modify `next.config.ts` to add the next-intl plugin:
```typescript
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  /* config options here */
};

export default withNextIntl(nextConfig);
```

**Step 3: Verify build**

Run:
```bash
npx next build 2>&1 | tail -20
```
Expected: Build succeeds

**Step 4: Commit**

```bash
git add middleware.ts next.config.ts
git commit -m "feat(i18n): add middleware and next-intl plugin config"
```

---

### Task 5: Update root layout for dynamic locale

**Files:**
- Modify: `app/layout.tsx`

**Step 1: Update layout to use dynamic locale and inject messages**

Replace `app/layout.tsx` content:
```typescript
import type { Metadata } from "next";
import { JetBrains_Mono, Source_Sans_3 } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Source_Sans_3({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Jobflow Dashboard",
    template: "%s | Jobflow",
  },
  description: "Job tracking and automated discovery dashboard.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

**Step 2: Verify build**

Run:
```bash
npx next build 2>&1 | tail -20
```
Expected: Build succeeds

**Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "feat(i18n): dynamic locale in root layout with NextIntlClientProvider"
```

---

### Task 6: Add Chinese font CSS and useMarket hook

**Files:**
- Modify: `app/globals.css`
- Create: `hooks/useMarket.ts`

**Step 1: Add Chinese font fallback to globals.css**

Add at the end of `app/globals.css`:
```css
html[lang="zh"] {
  --font-sans: system-ui, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
  --font-edu-body: system-ui, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
}
```

**Step 2: Create useMarket hook**

Create `hooks/useMarket.ts`:
```typescript
import { useLocale } from "next-intl";

export function useMarket(): "AU" | "CN" {
  const locale = useLocale();
  return locale === "zh" ? "CN" : "AU";
}
```

**Step 3: Commit**

```bash
git add app/globals.css hooks/useMarket.ts
git commit -m "feat(i18n): Chinese font CSS fallback and useMarket hook"
```

---

### Task 7: Write test for useMarket hook

**Files:**
- Create: `test/useMarket.test.tsx`

**Step 1: Write the test**

Create `test/useMarket.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useMarket } from "@/hooks/useMarket";

function wrapper(locale: string) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={{}}>
        {children}
      </NextIntlClientProvider>
    );
  };
}

describe("useMarket", () => {
  it("returns AU for en locale", () => {
    const { result } = renderHook(() => useMarket(), { wrapper: wrapper("en") });
    expect(result.current).toBe("AU");
  });

  it("returns CN for zh locale", () => {
    const { result } = renderHook(() => useMarket(), { wrapper: wrapper("zh") });
    expect(result.current).toBe("CN");
  });
});
```

**Step 2: Run test to verify it passes**

Run:
```bash
npx vitest run test/useMarket.test.tsx
```
Expected: 2 tests PASS

**Step 3: Commit**

```bash
git add test/useMarket.test.tsx
git commit -m "test: useMarket hook returns correct market from locale"
```

---

### Task 8: Create LocaleSwitcher component

**Files:**
- Create: `components/LocaleSwitcher.tsx`
- Create: `test/LocaleSwitcher.test.tsx`

**Step 1: Write the test**

Create `test/LocaleSwitcher.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

function renderWithLocale(locale: string) {
  return render(
    <NextIntlClientProvider locale={locale} messages={{}}>
      <LocaleSwitcher />
    </NextIntlClientProvider>,
  );
}

describe("LocaleSwitcher", () => {
  beforeEach(() => {
    mockRefresh.mockClear();
    document.cookie = "locale=; max-age=0";
    localStorage.clear();
  });

  it("renders EN and 中文 buttons", () => {
    renderWithLocale("en");
    expect(screen.getByRole("button", { name: "EN" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "中文" })).toBeInTheDocument();
  });

  it("highlights EN when locale is en", () => {
    renderWithLocale("en");
    const enBtn = screen.getByRole("button", { name: "EN" });
    expect(enBtn.className).toContain("bg-slate-900");
  });

  it("highlights 中文 when locale is zh", () => {
    renderWithLocale("zh");
    const zhBtn = screen.getByRole("button", { name: "中文" });
    expect(zhBtn.className).toContain("bg-slate-900");
  });

  it("sets cookie and localStorage on switch to zh", async () => {
    renderWithLocale("en");
    await userEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(localStorage.getItem("locale")).toBe("zh");
    expect(document.cookie).toContain("locale=zh");
    expect(mockRefresh).toHaveBeenCalledOnce();
  });

  it("does not refresh when clicking already-active locale", async () => {
    renderWithLocale("en");
    await userEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run test/LocaleSwitcher.test.tsx
```
Expected: FAIL — module not found

**Step 3: Implement LocaleSwitcher**

Create `components/LocaleSwitcher.tsx`:
```tsx
"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";

const options = [
  { value: "en", label: "EN" },
  { value: "zh", label: "中文" },
] as const;

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();

  function switchLocale(newLocale: string) {
    if (newLocale === locale) return;
    localStorage.setItem("locale", newLocale);
    document.cookie = `locale=${newLocale};path=/;max-age=31536000;SameSite=Lax`;
    router.refresh();
  }

  return (
    <div className="flex gap-0.5 rounded-full bg-slate-100 p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => switchLocale(opt.value)}
          className={`rounded-full px-3 py-1 text-xs font-semibold tracking-wide transition-all duration-200 ${
            locale === opt.value
              ? "bg-slate-900 text-white shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run test/LocaleSwitcher.test.tsx
```
Expected: 5 tests PASS

**Step 5: Commit**

```bash
git add components/LocaleSwitcher.tsx test/LocaleSwitcher.test.tsx
git commit -m "feat(i18n): LocaleSwitcher component with tests"
```

---

### Task 9: Add LocaleSwitcher to TopNav

**Files:**
- Modify: `app/(app)/TopNav.tsx`
- Modify: `app/(app)/TopNav.test.tsx`

**Step 1: Update TopNav**

In `app/(app)/TopNav.tsx`:

1. Add imports at top:
```typescript
import { useTranslations } from "next-intl";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
```

2. Inside TopNav function, add after `const { openGuide, state } = useGuide();`:
```typescript
const t = useTranslations("nav");
const tc = useTranslations("common");
```

3. Replace the `links` array:
```typescript
const links = [
  { href: "/jobs", label: t("jobs") },
  { href: "/fetch", label: t("fetch") },
  { href: "/resume", label: t("resume") },
  { href: "/automation", label: t("automation") },
];
```

4. Replace `Guide` text in button:
```typescript
{t("guide")}
```

5. Replace `Sign out` text in button:
```typescript
{tc("signOut")}
```

6. Add `<LocaleSwitcher />` before the Sign out button:
```tsx
<LocaleSwitcher />
<Button
  variant="outline"
  ...
```

**Step 2: Update TopNav tests**

In `app/(app)/TopNav.test.tsx`, add a NextIntlClientProvider wrapper to the test render function, using `en` locale and the en.json messages (or a minimal subset). Existing tests that check for "Jobs", "Fetch" etc should still pass since the EN translations match.

**Step 3: Run tests**

Run:
```bash
npx vitest run app/\(app\)/TopNav.test.tsx
```
Expected: All existing TopNav tests pass

**Step 4: Commit**

```bash
git add app/\(app\)/TopNav.tsx app/\(app\)/TopNav.test.tsx
git commit -m "feat(i18n): translated TopNav with LocaleSwitcher"
```

---

### Task 10: Add LocaleSwitcher to Marketing page nav

**Files:**
- Modify: `app/(marketing)/page.tsx`
- Modify: `app/(marketing)/MobileNav.tsx`

**Step 1: Update marketing page**

The marketing page is a server component. Use `getTranslations` from `next-intl/server`:

1. Add import: `import { getTranslations } from "next-intl/server";`
2. Make `HomePage` async: `export default async function HomePage() {`
3. At the top of the function: `const t = await getTranslations("marketing"); const tn = await getTranslations("nav");`
4. Replace all hardcoded feature titles/descriptions with `t("feature1Title")`, `t("feature1Desc")`, etc.
5. Replace step titles/descriptions similarly.
6. Replace hero section text, CTA buttons, footer text.
7. In the desktop nav, replace "Jobs" with `tn("jobs")`, "Fetch" with `tn("fetch")`, etc.
8. Replace "Log in" with `t("login")`, "Start free" with `t("cta")`.

Note: The `features` and `steps` arrays can no longer be static constants since they depend on `t()`. Move them inside the function body after the `t` call.

**Step 2: Update MobileNav**

MobileNav is a client component:
1. Add `import { useTranslations } from "next-intl";`
2. Inside function: `const t = useTranslations("marketing"); const tn = useTranslations("nav");`
3. Replace "Jobs" → `tn("jobs")`, "Fetch" → `tn("fetch")`, "Log in" → `t("login")`, "Start free" → `t("cta")`

**Step 3: Update marketing page tests**

In `app/(marketing)/page.test.tsx`, wrap renders in `NextIntlClientProvider` for client components. For server component tests, mock `next-intl/server` `getTranslations`.

**Step 4: Run tests**

Run:
```bash
npx vitest run app/\(marketing\)/page.test.tsx
```
Expected: PASS

**Step 5: Commit**

```bash
git add app/\(marketing\)/page.tsx app/\(marketing\)/MobileNav.tsx app/\(marketing\)/page.test.tsx
git commit -m "feat(i18n): translated marketing page and MobileNav"
```

---

### Task 11: Translate Jobs page and remove market toggle

**Files:**
- Modify: `app/(app)/jobs/JobsClient.tsx`
- Modify: related test files

**Step 1: Update JobsClient.tsx**

1. Add imports:
```typescript
import { useTranslations } from "next-intl";
import { useMarket } from "@/hooks/useMarket";
```

2. Inside the component, add:
```typescript
const t = useTranslations("jobs");
const tc = useTranslations("common");
const market = useMarket();
```

3. **Remove** `marketFilter` state: delete `const [marketFilter, setMarketFilter] = useState<"AU" | "CN">("AU");`

4. Replace all references to `marketFilter` with `market` (from `useMarket()`):
   - In `debouncedFilters` object: `marketFilter` → `market` (rename the key to `market`)
   - In `queryString` builder: `sp.set("market", debouncedFilters.market)`
   - In the dependency array

5. **Remove the entire market toggle button group** (the `<div className="mb-3 flex gap-1">` block with Overseas/CN buttons)

6. Replace label strings:
   - `"Title or Keywords"` → `t("titleOrKeywords")`
   - `"e.g. software engineer"` → `t("placeholder")`
   - `"Location"` → `t("location")`
   - `"All locations"` → `tc("allLocations")`
   - `"Job level"` → `t("jobLevel")`
   - `"All levels"` → `tc("allLevels")`
   - `"Status"` → `t("status")`
   - `"All"` → `tc("all")`
   - `"New"` → `t("statusNew")`
   - `"Applied"` → `t("statusApplied")`
   - `"Rejected"` → `t("statusRejected")`
   - `"Posted"` → `t("posted")`
   - `"Posted: newest"` → `t("newestFirst")`
   - `"Posted: oldest"` → `t("oldestFirst")`
   - `"Results"` → `t("results")`
   - `"Search"` → `tc("search")`

7. Update location dropdown: references to `marketFilter` → `market`

**Step 2: Update Jobs tests**

Wrap test renders in a helper that includes `NextIntlClientProvider` with `en` locale and en.json messages. Update any assertions that depend on the removed market toggle.

**Step 3: Run tests**

Run:
```bash
npx vitest run app/\(app\)/jobs/
```
Expected: PASS

**Step 4: Commit**

```bash
git add app/\(app\)/jobs/
git commit -m "feat(i18n): translated Jobs page, market derived from locale"
```

---

### Task 12: Translate Fetch page and remove market toggle

**Files:**
- Modify: `app/(app)/fetch/FetchClient.tsx`
- Modify: related test files

**Step 1: Update FetchClient.tsx**

1. Add imports:
```typescript
import { useTranslations } from "next-intl";
import { useMarket } from "@/hooks/useMarket";
```

2. Inside component:
```typescript
const t = useTranslations("fetch");
const tc = useTranslations("common");
const market = useMarket();
```

3. **Remove** `market` state: delete `const [market, setMarket] = useState<"AU" | "CN">("AU");`

4. **Remove** the market toggle buttons (the `<div className="flex gap-2">` block with 🌏海外/🇨🇳国内)

5. Replace label strings:
   - `"Search roles"` → `t("searchRoles")`
   - `"Job title"` → `t("jobTitle")`
   - Other labels as per the `fetch` namespace keys

6. All existing `market` references now use `useMarket()` return value — should just work since the variable name stays `market`.

**Step 2: Update Fetch tests**

Wrap test renders with `NextIntlClientProvider`.

**Step 3: Run tests**

Run:
```bash
npx vitest run app/\(app\)/fetch/
```
Expected: PASS

**Step 4: Commit**

```bash
git add app/\(app\)/fetch/
git commit -m "feat(i18n): translated Fetch page, market derived from locale"
```

---

### Task 13: Translate Resume page

**Files:**
- Modify: `app/(app)/resume/page.tsx`

**Step 1: Update Resume page**

This is a server component. Use `getTranslations`:

```typescript
import { getTranslations } from "next-intl/server";
```

Inside `ResumePage`:
```typescript
const t = await getTranslations("resume");
```

Replace:
- `"Master resumes"` → `{t("masterResumes")}`
- `"Maintain multiple..."` → `{t("masterResumesDesc")}`
- `"Manage prompt rules"` → `{t("managePromptRules")}`

**Step 2: Verify build**

Run:
```bash
npx next build 2>&1 | tail -20
```
Expected: Build succeeds

**Step 3: Commit**

```bash
git add app/\(app\)/resume/page.tsx
git commit -m "feat(i18n): translated Resume page"
```

---

### Task 14: Update test setup for next-intl compatibility

**Files:**
- Modify: `test/setup.ts`

**Step 1: Add next-intl test helper**

Add at the end of `test/setup.ts`:
```typescript
// Mock next-intl for tests that don't explicitly wrap with NextIntlClientProvider
vi.mock("next-intl", async () => {
  const actual = await vi.importActual("next-intl");
  return {
    ...actual,
    useLocale: () => "en",
    useTranslations: (ns?: string) => {
      return (key: string) => ns ? `${ns}.${key}` : key;
    },
  };
});
```

Add `import { vi } from "vitest";` at top.

Note: Tests that explicitly render with `NextIntlClientProvider` (like LocaleSwitcher tests, useMarket tests) should use `vi.unmock("next-intl")` or wrap in the provider which overrides the mock.

**Step 2: Run all tests**

Run:
```bash
npx vitest run
```
Expected: All 206+ tests pass

**Step 3: Commit**

```bash
git add test/setup.ts
git commit -m "test: add next-intl mock to global test setup"
```

---

### Task 15: Final build verification and cleanup

**Files:**
- All modified files

**Step 1: Run all tests**

Run:
```bash
npx vitest run
```
Expected: All tests pass

**Step 2: Run production build**

Run:
```bash
npx next build
```
Expected: Build succeeds with no errors

**Step 3: Manual smoke test**

Run dev server and verify:
```bash
npx next dev
```
- Default loads in English
- Click "中文" in TopNav → page reloads in Chinese
- Jobs page shows Chinese labels, only CN data
- Fetch page shows Chinese form, no AU/CN toggle
- Resume page shows Chinese section titles
- Marketing page shows Chinese content
- Click "EN" → back to English

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(i18n): complete CN/EN language switching implementation"
```
