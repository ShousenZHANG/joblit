# Jobflow 搜索与全站性能优化方案

**Date:** 2026-03-29
**Branch:** master
**Tech Stack:** Next.js 15 App Router, PostgreSQL (Neon Serverless), Prisma ORM, TanStack Query 5, Vercel, Zod v4

---

## 1. 方案对比

### Option A: B-tree Index + ILIKE（增量修复）

| 维度 | 说明 |
|------|------|
| 搜索方式 | 保留现有 `ILIKE` / `contains`，补充 B-tree 索引 |
| 索引策略 | `@@index([userId, title])` 等 |
| 缓存 | 保留现有 ETag，补充 suggestions Cache-Control |
| 工期 | 1-2 天 |

**优点：** 改动最小，零回归风险，不需要新的 PostgreSQL 扩展。

**缺点：** B-tree 索引对 `%keyword%` 模式无效（仅支持前缀 `keyword%`），依然全表扫描。无相关性排名。中文搜索不支持。

**结论：** 不足以解决核心性能问题，仅修补表面 Bug。

---

### Option B: PostgreSQL 全文搜索 tsvector + GIN（推荐）

| 维度 | 说明 |
|------|------|
| 搜索方式 | 添加 `searchVector` (tsvector) 列，GIN 索引，`ts_rank` 排序 |
| 索引策略 | GIN 索引 + 补充 B-tree 索引 |
| 缓存 | React Query 调优 + suggestions ETag + HTTP 304 |
| 工期 | 5-7 天（分 3 阶段） |

**优点：**
- 原生 PostgreSQL 方案，无外部服务依赖
- GIN 索引对任意位置子串高效匹配
- `ts_rank` 提供相关性排名
- 前缀匹配 `to_tsquery('word:*')`
- 兼容 Neon Serverless，无额外基础设施成本

**缺点：**
- 需要 raw SQL migration（Prisma 不原生支持 tsvector）
- 搜索路径需 `$queryRaw`
- 中文 FTS 依赖 Neon 的扩展支持（`zhparser` 可能不可用，退回 `simple` 配置 + ILIKE 兜底）

**结论：** 当前阶段的最佳平衡——能力、成本、复杂度均可控。

---

### Option C: 外部搜索引擎（Typesense / Meilisearch）

| 维度 | 说明 |
|------|------|
| 搜索方式 | 同步 jobs 到外部搜索引擎，前端直连 |
| 索引策略 | 搜索引擎自管理 |
| 缓存 | 搜索引擎内置 + CDN 边缘缓存 |
| 工期 | 10-14 天 |

**优点：** 最佳搜索体验（容错、分面、高亮、<5ms 响应），中文分词内置（Meilisearch），可扩展至百万级。

**缺点：** 新增基础设施依赖；数据同步复杂度；成本（自建或 SaaS）；最终一致性问题；对当前用户规模严重过度设计。

**结论：** 过早优化。当用户量超过 10K 或 Job 记录超过 500K 时再考虑。

---

### 方案对比总结

| 维度 | A: ILIKE | B: FTS (推荐) | C: 外部引擎 |
|------|----------|---------------|-------------|
| 搜索质量 | 差（无排名） | 好（ts_rank） | 极佳（容错+排名） |
| 性能 | 全表扫描 | GIN 索引 <10ms | <5ms |
| 中文支持 | ILIKE 可用 | simple + ILIKE 兜底 | 内置分词 |
| 基础设施 | 无变更 | 无变更 | 新增服务 |
| 复杂度 | 极低 | 中等 | 高 |
| 工期 | 1-2 天 | 5-7 天 | 10-14 天 |
| 适用阶段 | 临时修补 | 当前最优 | 规模化阶段 |

---

## 2. 推荐方案详细设计（Option B）

### 2.1 搜索算法优化

#### 2.1.1 数据库迁移：添加 searchVector 列

Prisma 不原生支持 `tsvector`，需要通过 raw SQL migration 实现。

**Migration 文件:** `prisma/migrations/YYYYMMDD_add_search_vector/migration.sql`

```sql
-- 1. 添加 tsvector 列
ALTER TABLE "Job" ADD COLUMN "searchVector" tsvector;

-- 2. 回填现有数据
UPDATE "Job" SET "searchVector" =
  setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
  setweight(to_tsvector('english', coalesce("company", '')), 'B') ||
  setweight(to_tsvector('english', coalesce("location", '')), 'C');

-- 3. 创建 GIN 索引
CREATE INDEX "Job_userId_searchVector_idx"
  ON "Job" USING gin ("userId", "searchVector");

-- 4. 创建自动更新触发器
CREATE OR REPLACE FUNCTION job_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('english', coalesce(NEW."title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW."company", '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW."location", '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER job_search_vector_trigger
  BEFORE INSERT OR UPDATE OF "title", "company", "location"
  ON "Job"
  FOR EACH ROW
  EXECUTE FUNCTION job_search_vector_update();
```

**权重说明：**
- `'A'` (title) = 最高权重 — 标题匹配优先
- `'B'` (company) = 中等权重
- `'C'` (location) = 最低权重

#### 2.1.2 搜索服务实现

**新文件:** `lib/server/jobs/jobSearchService.ts`

```typescript
/**
 * 将用户搜索字符串转为 tsquery 格式
 * "senior react developer" -> "senior:* & react:* & developer:*"
 */
export function buildTsQuery(input: string): string {
  const tokens = input
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, ""))
    .filter((token) => token.length > 0);

  if (tokens.length === 0) return "";
  return tokens.map((t) => `${t}:*`).join(" & ");
}

/**
 * 判断是否使用 FTS（短查询或纯数字退回 ILIKE）
 */
export function shouldUseFts(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length < 2) return false;
  if (/^\d+$/.test(trimmed)) return false;
  return true;
}
```

#### 2.1.3 修改 listJobs 支持 FTS

`lib/server/jobs/jobListService.ts` 需要两条代码路径：

```
Path 1: q 为空或不适合 FTS → 现有 Prisma findMany（保留）
Path 2: q 有效 + shouldUseFts(q) → $queryRaw 走 FTS + ts_rank 排序
```

FTS 路径的 SQL 核心：

```sql
SELECT j.*, ts_rank(j."searchVector", to_tsquery('english', $2)) AS rank
FROM "Job" j
WHERE j."userId" = $1
  AND j."searchVector" @@ to_tsquery('english', $2)
  AND ... (status, market, jobLevel 条件)
ORDER BY rank DESC, j."createdAt" DESC, j."id" DESC
LIMIT $N
```

#### 2.1.4 中文搜索策略

Neon PostgreSQL 目前不支持 `zhparser` / `pg_jieba`。退路方案：

1. **主路径：** CN 市场使用 `'simple'` 配置（按空格分词，不做词干提取——对中英混合招聘标题基本可用）
2. **兜底路径：** 对 CN 市场同时保留 ILIKE OR 条件：

```sql
WHERE (
  j."searchVector" @@ to_tsquery('simple', $2)
  OR j."title" ILIKE '%' || $3 || '%'
  OR j."company" ILIKE '%' || $3 || '%'
)
```

3. **远期：** 当 Neon 支持 `zhparser` 时，更新触发器即可无缝迁移。

#### 2.1.5 模糊匹配（Phase 3）

利用 `pg_trgm` 扩展实现容错搜索（FTS 返回 0 结果时的 fallback）：

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Job_title_trgm_idx" ON "Job" USING gin ("title" gin_trgm_ops);
CREATE INDEX "Job_company_trgm_idx" ON "Job" USING gin ("company" gin_trgm_ops);

-- 当 FTS 无结果时 fallback
SELECT * FROM "Job" j
WHERE j."userId" = $1
  AND (similarity(j."title", $2) > 0.3 OR similarity(j."company", $2) > 0.3)
ORDER BY greatest(similarity(j."title", $2), similarity(j."company", $2)) DESC
LIMIT $3;
```

---

### 2.2 数据库索引优化

#### 新增索引

```prisma
model Job {
  // ... 现有字段 ...

  // 现有索引
  @@unique([userId, jobUrl])
  @@index([userId, createdAt])
  @@index([userId, updatedAt])
  @@index([userId, status])
  @@index([userId, market, createdAt])

  // 新增索引
  @@index([userId, jobLevel])                      // jobLevel 精确匹配
  @@index([userId, market, status, createdAt])      // 最常见复合筛选
  // GIN(userId, searchVector) — 通过 raw SQL migration 创建
}
```

#### 索引覆盖分析

| 索引 | 查询模式 | 影响 |
|------|----------|------|
| `GIN(userId, searchVector)` | 关键词搜索 `@@` 操作符 | 消除全表扫描，<10ms |
| `B-tree(userId, jobLevel)` | `WHERE userId=? AND jobLevel=?` | 精确匹配从全表扫描 → 索引查找 |
| `B-tree(userId, market, status, createdAt)` | `WHERE userId=? AND market=? AND status=? ORDER BY createdAt` | 覆盖最常见的复合筛选组合 |

#### 不推荐的索引

- `B-tree(userId, title/company/location)` — 对 `ILIKE '%keyword%'` 无效，FTS 方案下不需要
- `INCLUDE(description)` 覆盖索引 — description 太大（数 KB），不适合放入索引

---

### 2.3 API 层优化

#### 2.3.1 移除 `platform` 参数

数据库 `Job` 模型中**没有 `platform` 字段**，但 API 的 Zod Schema 接受了它。

**修改文件：**
- `app/api/jobs/route.ts` — 从 `QuerySchema` 移除 `platform`
- `lib/server/jobs/jobListService.ts` — 从 `JobListQuery` 类型和 `filtersSignature` 移除

如果未来需要按平台筛选，先在 `Job` 模型添加 `platform` 字段再接入。

#### 2.3.2 列表响应包含 description

消除 N+1 详情查询：

```typescript
// lib/server/jobs/jobListService.ts — select 中添加
select: {
  // ... 现有字段 ...
  description: true,  // 新增
}
```

**负载控制：** 描述字段可能 2-10KB。若 `limit=10` 导致响应超 200KB，降级为截断方案：

```typescript
description: job.description?.slice(0, 500) ?? null,
descriptionTruncated: (job.description?.length ?? 0) > 500,
```

前端：若 `descriptionTruncated` 为 `true` 才触发详情接口。

#### 2.3.3 Suggestions API 缓存

`app/api/jobs/suggestions/route.ts` 添加：

```typescript
const etag = `W/"sug:${createHash("sha1").update(combined.join("|")).digest("base64url")}"`;

if (ifNoneMatch === etag) {
  return new NextResponse(null, {
    status: 304,
    headers: { ETag: etag, "Cache-Control": "private, max-age=30" },
  });
}

return NextResponse.json({ suggestions: combined }, {
  headers: { ETag: etag, "Cache-Control": "private, max-age=30" },
});
```

---

### 2.4 前端性能优化

#### 2.4.1 React Query 配置调优

```typescript
// 全局默认
staleTime: 30_000,      // 30 秒
gcTime: 5 * 60_000,     // 5 分钟
retry: 1,

// Jobs 列表（JobsClient.tsx）
staleTime: 60_000,       // 1 分钟（jobs 变化不频繁）
gcTime: 10 * 60_000,     // 滚动历史保留 10 分钟

// Job 详情
staleTime: 5 * 60_000,   // 5 分钟（description 几乎不变）

// Suggestions
staleTime: 2 * 60_000,   // 2 分钟
```

#### 2.4.2 所有筛选器统一防抖

当前只有 `q` 有 200ms 防抖。改为统一防抖整个 filter 对象：

```typescript
const rawFilters = useMemo(() => ({
  q, statusFilter, locationFilter, jobLevelFilter, market, sortOrder, pageSize,
}), [q, statusFilter, locationFilter, jobLevelFilter, market, sortOrder, pageSize]);

const debouncedFilters = useDebouncedValue(rawFilters, 200);
```

效果：200ms 内连续更改多个筛选器只触发 1 次 API 请求。

#### 2.4.3 Loading 状态优化

**即时反馈条：** 筛选器变化后立刻在结果面板顶部显示 pulse 条：

```tsx
{(isFilterDirty || showLoadingOverlay) && (
  <div className="absolute top-0 left-0 right-0 h-0.5 bg-emerald-500/60 animate-pulse z-20" />
)}
```

**Skeleton UI：** 初始加载时渲染骨架屏而非空白：

```tsx
{loadingInitial && Array.from({ length: 5 }).map((_, i) => (
  <div key={i} className="space-y-2 rounded-lg border p-3">
    <Skeleton className="h-5 w-3/4" />
    <Skeleton className="h-4 w-1/2" />
    <Skeleton className="h-3 w-1/3" />
  </div>
))}
```

#### 2.4.4 包体积优化

```typescript
// next.config.ts
experimental: {
  optimizePackageImports: [
    "lucide-react",
    "framer-motion",
    "react-markdown",
    "rehype-highlight",
    "remark-gfm",
  ],
}
```

Markdown 渲染器（重型依赖）改为懒加载：

```typescript
const MarkdownRenderer = dynamic(
  () => import("./MarkdownRenderer"),
  { loading: () => <Skeleton className="h-40 w-full" /> },
);
```

#### 2.4.5 路由预取

```tsx
// 在 AppLayout 或 TopNav 中
useEffect(() => {
  router.prefetch("/jobs");
  router.prefetch("/resume");
  router.prefetch("/automation");
}, [router]);
```

---

### 2.5 全站性能优化

#### 2.5.1 Suspense 流式渲染

`app/(app)/jobs/page.tsx` 改为流式：

```tsx
export default function JobsPage() {
  return (
    <Suspense fallback={<JobsPageSkeleton />}>
      <JobsPageContent />
    </Suspense>
  );
}

async function JobsPageContent() {
  // ... SSR 数据获取 + 渲染 JobsClient ...
}
```

效果：页面 Shell（导航栏、侧边栏）立即渲染，数据库查询异步流入。

#### 2.5.2 Core Web Vitals 目标

| 指标 | 目标 | 风险点 | 缓解措施 |
|------|------|--------|----------|
| LCP | < 2.5s | SSR 查询阻塞首屏 | Suspense 流式渲染 |
| INP | < 200ms | 筛选器切换 | `useTransition` + 防抖 |
| CLS | < 0.1 | 数据加载前布局偏移 | 骨架屏 + 固定容器尺寸 |

#### 2.5.3 Edge 缓存

当前 `Cache-Control: private, max-age=0, must-revalidate` 对已认证的动态数据是正确的，无需更改。

静态资源由 Vercel 自动 Edge 缓存。确保 `next.config.ts` 不覆盖默认行为。

#### 2.5.4 Service Worker

当前阶段不推荐。App 是动态仪表板，数据新鲜度优先。离线场景下 Service Worker 增加的复杂度不值当。

---

### 2.6 用户体验优化

#### 2.6.1 搜索建议 / 自动补全

提取 `SearchInput` 组件，带下拉建议列表：

```tsx
// app/(app)/jobs/SearchInput.tsx
<div className="relative">
  <Input value={value} onChange={onChange} role="combobox"
    aria-expanded={open} aria-autocomplete="list" />
  {open && suggestions.length > 0 && (
    <ul id="search-suggestions" role="listbox" className="absolute ...">
      {suggestions.map((s, i) => (
        <li key={i} role="option" onMouseDown={() => onChange(s)}>{s}</li>
      ))}
    </ul>
  )}
</div>
```

#### 2.6.2 搜索结果高亮

```tsx
// lib/shared/highlightMatch.tsx
export function highlightMatch(text: string, query: string): ReactNode {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part)
      ? <mark key={i} className="bg-yellow-200/60 rounded-sm px-0.5">{part}</mark>
      : part
  );
}
```

#### 2.6.3 搜索历史

```typescript
// hooks/useSearchHistory.ts
const STORAGE_KEY = "jobflow:search-history";
const MAX_ENTRIES = 10;

export function useSearchHistory() {
  function getHistory(): string[] { /* localStorage.getItem */ }
  function addEntry(query: string) { /* 去重 + 头部插入 + 截断 */ }
  function clearHistory() { /* localStorage.removeItem */ }
  return { getHistory, addEntry, clearHistory };
}
```

焦点聚焦且输入为空时显示历史记录列表。

#### 2.6.4 空状态与错误状态

**空结果：**

```tsx
<div className="flex flex-col items-center py-16">
  <Search className="h-12 w-12 text-muted-foreground/40" />
  <p>{q ? t("noSearchResults") : t("noJobs")}</p>
  {q && <button onClick={() => setQ("")}>{t("clearSearch")}</button>}
</div>
```

**错误状态：** 加入重试按钮。

#### 2.6.5 无障碍访问

- 搜索输入：`aria-label={t("searchJobs")}`
- 结果计数：`aria-live="polite"` 让屏幕阅读器播报筛选变化
- 所有 Select 组件添加 `aria-label`
- Job 列表支持方向键导航（`role="listbox"` + `role="option"`）

---

## 3. 实施路线图

### Phase 1: 立即修复（1-2 天，零风险）

| 任务 | 涉及文件 | 解决问题 |
|------|----------|----------|
| 移除 `platform` 参数 | `route.ts`, `jobListService.ts` | Bug #2 |
| 列表响应包含 `description` | `jobListService.ts`, `JobsClient.tsx` | N+1 #3 |
| 添加 `jobLevel` 索引 | `prisma/schema.prisma` | 精确匹配性能 |
| 添加复合索引 `(userId, market, status, createdAt)` | `prisma/schema.prisma` | 复合筛选性能 |
| Suggestions API 加 Cache-Control | `suggestions/route.ts` | 重复查询 #6 |
| 所有筛选器统一防抖 | `JobsClient.tsx` | 多次请求 #4 |
| 即时 filter-dirty 指示器 | `JobsClient.tsx` | 360ms 空白反馈 #9 |
| `optimizePackageImports` | `next.config.ts` | 包体积 |

### Phase 2: 全文搜索 + UX 升级（5-7 天）

| 任务 | 涉及文件 | 解决问题 |
|------|----------|----------|
| searchVector 列 + GIN 索引 migration | `prisma/migrations/` | FTS 基础设施 |
| 自动更新触发器 | 同上 | 保持 tsvector 同步 |
| `jobSearchService.ts` 实现 | `lib/server/jobs/` | FTS 查询 + ts_rank |
| 修改 `listJobs` 支持 FTS | `jobListService.ts` | 相关性排名 #5 |
| SearchInput 组件（建议下拉） | `app/(app)/jobs/SearchInput.tsx` | 自动补全 UX |
| 搜索高亮 | `lib/shared/highlightMatch.tsx` | 视觉反馈 |
| 搜索历史 | `hooks/useSearchHistory.ts` | 快速重搜 |
| Markdown 懒加载 | `app/(app)/jobs/MarkdownRenderer.tsx` | 包体积 |
| Suspense 流式渲染 | `app/(app)/jobs/page.tsx` | LCP 优化 |
| React Query 缓存调优 | `providers.tsx`, `JobsClient.tsx` | 减少请求 |
| FTS 单元测试 | `jobSearchService.test.ts` | 回归安全 |

### Phase 3: 远期增强（2-4 周，按需）

| 任务 | 涉及文件 | 解决问题 |
|------|----------|----------|
| `pg_trgm` 模糊匹配 | migration + `jobSearchService.ts` | 容错搜索 |
| `zhparser` 集成 | migration（更新触发器） | 原生中文分词 |
| 移动端 slide-over 详情面板 | `JobsClient.tsx` | Mobile UX |
| 键盘导航 | `JobsClient.tsx` | 无障碍 |
| 拆分 `JobsClient.tsx`（2400 行） | `app/(app)/jobs/` 目录 | 可维护性 |
| 外部搜索引擎评估 | 架构决策 | >500K 数据规模 |
| Upstash Redis 限流 | `lib/server/api/rateLimit.ts` | 生产级限流 |

---

## 4. 风险与回退策略

### 风险 1: Neon 不支持 GIN 复合索引 (userId + tsvector)

**可能性：** 低（Neon 支持标准 PostgreSQL GIN 索引）
**缓解：** 改用两个独立索引（B-tree on userId + GIN on searchVector），PostgreSQL 自动做 bitmap AND。
**回退：** Drop GIN 索引，revert `listJobs` 到 ILIKE 路径。原始代码保留为 `buildWhereClauseLegacy`。

### 风险 2: $queryRaw SQL 注入

**可能性：** 中（如果实现不当）
**缓解：** 所有用户输入通过参数化查询（`$1`, `$2`），不做字符串拼接。`buildTsQuery` 剔除特殊字符。优先用 `Prisma.$queryRaw`（tagged template）而非 `$queryRawUnsafe`。
**验证：** Code review + SQL 注入测试用例。

### 风险 3: tsvector 触发器影响批量导入

**可能性：** 中（FetchRun 一次可导入数百条 Job）
**缓解：** 触发器按行执行，PostgreSQL 处理效率可接受。如需导入 1000+ 行，可临时禁用触发器后批量 UPDATE。
**监控：** 追踪 FetchRun 导入耗时。

### 风险 4: description 加入列表响应增大负载

**可能性：** 高（描述字段 2-10KB）
**缓解：** 先以截断方案上线（500 字符）。监控 Vercel 分析中的 payload 大小。若中位数超 200KB，回退到独立详情请求 + React Query 预取。

### 通用回退策略

1. 数据库变更为 forward-only migration，回退 = 创建新 migration 回退变更
2. FTS 路径通过环境变量 `ENABLE_FTS=true` 门控
3. 原始 ILIKE 的 `buildWhereClause` 保留为 `buildWhereClauseLegacy`，可即时恢复
4. Phase 1 和 Phase 2 分别独立 PR 发布，Phase 1 零风险先行

---

## 附录：关键文件索引

| 文件 | 角色 |
|------|------|
| `prisma/schema.prisma` | 数据库 Schema — 添加索引 |
| `lib/server/jobs/jobListService.ts` | 核心搜索逻辑 — 修改 WHERE + 添加 FTS 路径 |
| `lib/server/jobs/jobSearchService.ts` | 新文件 — FTS 查询构建 + ts_rank |
| `app/api/jobs/route.ts` | API 路由 — 移除 platform |
| `app/api/jobs/suggestions/route.ts` | Suggestions API — 添加缓存 |
| `app/(app)/jobs/JobsClient.tsx` | 主 UI — 防抖 + loading + 高亮 |
| `app/(app)/jobs/SearchInput.tsx` | 新文件 — 搜索输入 + 自动补全 |
| `app/(app)/jobs/page.tsx` | SSR 页面 — Suspense 流式 |
| `next.config.ts` | Next.js 配置 — optimizePackageImports |
| `lib/shared/highlightMatch.tsx` | 新文件 — 搜索高亮工具 |
| `hooks/useSearchHistory.ts` | 新文件 — 搜索历史 |
| `lib/server/jobsListEtag.ts` | ETag — 移除 platform |
