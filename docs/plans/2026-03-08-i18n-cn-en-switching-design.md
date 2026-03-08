# i18n CN/EN 全站语言切换设计

**日期**: 2026-03-08  
**状态**: Approved

## 概述

为 Jobflow 添加全站 CN/EN 语言切换功能。语言 = 市场，一个开关控制所有：EN 模式 = 英文界面 + 海外岗位，CN 模式 = 中文界面 + 国内岗位，两个市场完全隔离。

## 决策记录

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 持久化 | localStorage + cookie | 零后端成本，cookie 供 middleware 读取 |
| 切换入口 | TopNav 右上角 | 大厂标准，全局统一入口 |
| 翻译方案 | next-intl（无 URL 前缀模式） | 零路由重构，服务端+客户端都能翻译 |
| 中文字体 | 系统字体回退 | 零加载成本，各平台自带字体已成熟 |
| 落地页 | 也翻译 | 中文用户看中文营销文案 |
| 联动规则 | 语言 = 市场，完全隔离 | 简化心智模型，无歧义 |

## 1. 架构总览

### 切换流程

```
用户点击 EN/中文 toggle
  → localStorage 写入 locale
  → document.cookie 写入 locale（供 middleware 读取）
  → router.refresh()
  → middleware 读 cookie → 设 next-intl locale
  → 服务端/客户端组件拿到正确 locale → 重渲染
```

### 新增文件

```
jobflow/
  middleware.ts                    # 读 cookie，设 locale
  i18n/
    request.ts                     # next-intl 服务端配置
    routing.ts                     # locale 列表定义
  messages/
    en.json                        # 英文翻译字典
    zh.json                        # 中文翻译字典
  hooks/
    useMarket.ts                   # locale → market 派生 hook
```

### Provider 层级

```
Providers → QueryClient → SessionProvider → NextIntlClientProvider → FetchStatusProvider → children
```

### middleware.ts

- 读 cookie `locale`，没有则默认 `"en"`
- 设置 `x-next-intl-locale` header
- 不改 URL，不做 redirect

### html lang

`app/layout.tsx` 的 `<html lang="en">` 改为动态 `<html lang={locale}>`，通过 `getLocale()` 获取。

## 2. 语言 = 市场联动

### 映射关系

| locale | market | UI 语言 | 数据范围 |
|--------|--------|---------|---------|
| `en` | `AU` | English | 海外岗位、AU 城市、英文简历 |
| `zh` | `CN` | 中文 | 国内岗位、CN 城市、中文简历 |

### useMarket hook

```typescript
function useMarket(): "AU" | "CN" {
  const locale = useLocale(); // from next-intl
  return locale === "zh" ? "CN" : "AU";
}
```

### 页面联动

- **Jobs** — `marketFilter` 由 locale 派生，移除 Overseas/CN 按钮
- **Fetch** — `market` 由 locale 派生，移除 🌏海外/🇨🇳国内 按钮
- **Resume** — locale 跟随全局，`"en" → "en-AU"`, `"zh" → "zh-CN"`
- **Automation** — 按 market 过滤

## 3. 翻译字典结构

按页面/组件做命名空间：

```json
{
  "common": { "signOut", "search", "allLocations", "allLevels", "all" },
  "nav": { "jobs", "fetch", "resume", "automation", "guide" },
  "marketing": { "heroTitle", "heroSubtitle", "feature1Title", ... },
  "jobs": { "titleOrKeywords", "location", "jobLevel", "status", "posted", "results", ... },
  "fetch": { "jobTitle", "hoursOld", "startFetch", ... },
  "resume": { "masterResumes", "promptRules", ... }
}
```

总计约 85 个翻译 key，en.json + zh.json 各一份。

## 4. TopNav 切换器

### 布局

```
[Jobs] [Fetch] [Resume] [Automation]          [Guide]  EN | 中文  [Sign out]
```

### 样式

- pill 形按钮组，`text-xs px-3 py-1 rounded-full`
- 选中态：`bg-slate-900 text-white`
- 未选中：`bg-slate-100 text-slate-500`

### 行为

点击 → 写 localStorage + cookie → `router.refresh()`

## 5. 中文字体

```css
:root {
  --font-sans: "Source Sans 3", system-ui, sans-serif;
}

html[lang="zh"] {
  --font-sans: system-ui, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
}
```

## 6. 各页面改造

### Jobs 页

- 移除 Overseas/CN 按钮
- `marketFilter` → `useMarket()`
- 所有 label 改用 `t("jobs.xxx")`

### Fetch 页

- 移除 🌏海外/🇨🇳国内 按钮
- `market` → `useMarket()`
- 所有 label 改用 `t("fetch.xxx")`

### Resume 页

- locale 跟随全局
- section 标题改用 `t("resume.xxx")`

### Marketing 落地页

- 全部文案改用 `t("marketing.xxx")`
- 也显示 EN/中文 切换器

### Automation 页

- 按 market 过滤
- label 翻译

## 7. 测试策略

| 层级 | 内容 | 方式 |
|------|------|------|
| 单元测试 | `useMarket()` 返回正确 market | vitest + mock locale |
| 组件测试 | TopNav 显示中文导航链接 | vitest + NextIntlClientProvider mock |
| 组件测试 | Jobs toolbar 中文 label | vitest + mock |
| 组件测试 | Fetch 表单 CN 模式只显示国内选项 | vitest + mock |
| 集成测试 | 切换语言后 cookie/localStorage 写入 | vitest |

现有测试适配：给测试 wrapper 加 `NextIntlClientProvider`，传入 en messages 作为默认。
