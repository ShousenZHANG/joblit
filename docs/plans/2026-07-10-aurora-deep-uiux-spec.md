# Aurora Deep（极光深空）UIUX 实现规格 — Joblit

> **文档性质**：自包含实现规格。执行者（AI 或人类）无需任何额外上下文即可按本文档完整实现。
> **概念一句话**：求职 = 在浩瀚信号场中定位属于你的那颗星。深空墨蓝为底，**翡翠极光为生命信号**——现有 emerald 品牌不更换，语义升维为"黑暗中的光"。

---

## 0. 项目上下文（执行前必读）

### 技术栈
- **Next.js 15 App Router** + React 19 + TypeScript，路径别名 `@/*` → 项目根
- **Tailwind CSS v4**（CSS-first 配置：所有 token 在 `app/globals.css` 的 `@theme` 块中定义，**没有** tailwind.config.js 的 theme 扩展）
- shadcn/ui（Radix primitives，`components/ui/*`）
- framer-motion（已安装，import 自 `framer-motion`）
- next-intl：文案表在 `messages/en.json` + `messages/zh.json`，**双语必须同时加、键完全对等**
- 暗色模式：next-themes class 策略——`.dark` class 挂在 html 上，`defaultTheme="system"`
- 字体（已配置，勿新增）：`GeistSans`（--font-geist-sans，正文）、`GeistMono`、`Instrument Serif`（`--font-instrument-serif`，landing 展示衬线，Tailwind 工具类 `font-serif`）
- 测试 Vitest（jsdom），测试与源文件同目录或 `test/`

### 验证命令（每阶段完成后必须全绿）
```bash
npm run lint        # ESLint，0 error 0 warning
npm run test        # Vitest 全套（当前 769 通过）
npm run build       # 生产构建（含 typecheck）
```

### 关键文件地图
| 区域 | 路径 |
|---|---|
| 全局样式 + 全部 design token | `app/globals.css`（:root 亮色 token 在文件头部；**应用暗色 token 在 ~L465 的 `.dark` 块**；landing 专属 token/类散布于 L114-460） |
| 根布局（字体、Provider） | `app/layout.tsx` |
| Landing 页 | `app/(marketing)/page.tsx` + `components/landing/`（Hero.tsx、Nav.tsx、Features.tsx、Cta.tsx、ScrollProgress.tsx 等） |
| 登录页 | `app/(auth)/login/page.tsx` |
| 工作区外壳 | `app/(app)/layout.tsx` + `components/app-shell/AppNav.tsx` |
| Jobs 页 | `app/(app)/jobs/JobsClient.tsx`、`app/(app)/jobs/components/JobListItem.tsx`、`VirtualJobList.tsx`、`JobDetailPanel.tsx` |
| Fetch 页 | `app/(app)/fetch/FetchClient.tsx`、进度面板 `app/FetchProgressPanel.tsx` |
| Tailor 编辑器 | `app/(app)/jobs/[id]/tailor/TailorClient.tsx`、`PdfPreview.tsx` |
| Resume 编辑器 | `components/resume/`（PreviewPanel.tsx、ResumePageLayout.tsx） |
| 路由过渡 | `app/RouteTransition.tsx` |

### 现有资产（扩展它们，禁止重复造）
`app/globals.css` 中 **landing 已存在**以下氛围类（之前的 landing 优化建的）：
- `.landing-atmos`（+ `.dark .landing-atmos` L186）— 大气层背景
- `.landing-aurora-blob`（+ dark 变体 L243）— 极光光斑
- `.landing-grain`（+ dark 变体 L273）— 颗粒噪点
- `.spotlight-card`（L381）— 指针跟随聚光卡片

**规则：landing 相关改动必须在这些类基础上调参/扩展，不得新建平行体系。** 工作区（app 壳）目前没有氛围层——那部分是新建。

### 品牌 token（已全部定义，直接用）
`--brand-emerald-50/100/200/300/400/500/600/700/800/900/950`（:root hex + `.dark` 覆盖 50/100/200/800）+ `@theme` 中全部映射为 `--color-brand-emerald-*`（即 Tailwind 工具类 `bg-brand-emerald-500`、`text-brand-emerald-300` 等全部可用）。

---

## 1. 设计总纲（三条铁律）

### 铁律 1：分层克制
| 层 | 表面 | 宇宙化程度 |
|---|---|---|
| **氛围层** | landing、login、dark 模式底色、空态、加载态、路由过渡 | 全量：深空底、星尘、极光辉光 |
| **容器层** | app 壳、nav、卡片边框 | 轻度：玻璃态、1px 亮边、微辉光 |
| **数据层** | jobs 列表行、表单、JD 正文、tailor 编辑区 | **零装饰**。对比度、密度、扫读效率一像素都不许动 |

### 铁律 2：宇宙慢，操作快
- 氛围动画（星云漂移、极光呼吸）：30–60s 循环，`ease-in-out`，只动 `transform`/`opacity`（GPU-only）
- 交互反馈：≤200ms，缓动统一 `cubic-bezier(0.16, 1, 0.3, 1)`（项目现有约定）
- 两者的速度差就是"浩瀚感"本身

### 铁律 3：无障碍与性能不妥协
- **所有**氛围动画必须带 `motion-reduce:` 静止兜底（Tailwind `motion-reduce:animate-none` 或 CSS `@media (prefers-reduced-motion: reduce)`）
- 星场/噪点纯装饰：`aria-hidden="true"`、`pointer-events: none`
- 文字对比度 WCAG AA（≥4.5:1）。dark 深空底上的 emerald 文字用 `text-brand-emerald-300`（已定义），**不要**用 600/700（深绿在深底上 ~3.5:1 不达标）
- 禁止：WebGL/three.js、canvas 粒子系统、鼠标拖尾、每行列表动画、light 主题宇宙化

---

## 2. P0 — Token 深空化 + 全站氛围基建（纯 CSS，最高优先级）

### 2.1 应用暗色 token 替换
`app/globals.css` 有**两个 `.dark` 块**——定位方式（行号会漂移，用内容锚定）：
- **landing 专属 `.dark` 块**：内含 `--brand-emerald-50: rgba(6, 95, 70, 0.18)` 与 `--landing-nav-bg`。**不要动这个**。
- **应用工作区 `.dark` 块**（要改的）：内含 `--background: oklch(0.12 0.005 250)`。grep `oklch(0.12 0.005 250)` 直达。

将其中三个值替换：

```css
/* 现值 → 新值（深空墨：拉高蓝色 chroma，从灰蓝变墨蓝） */
--background: oklch(0.13 0.02 250);      /* 原 oklch(0.12 0.005 250) */
--card: oklch(0.17 0.022 252);           /* 原 oklch(0.16 0.005 250) */
--border: oklch(0.65 0.02 250 / 14%);    /* 原 oklch(1 0 0 / 10%)，带一点冷蓝 */
```

同一 `.dark` 块内**新增**两个 token：

```css
/* 极光辉光：用于按钮/焦点外辉光 box-shadow */
--aurora-glow: oklch(0.72 0.14 162 / 0.25);
/* 深空星云网格：氛围层背景（固定，不随滚动） */
--nebula:
  radial-gradient(ellipse 80% 50% at 20% -10%, oklch(0.25 0.06 200 / 0.35), transparent 60%),
  radial-gradient(ellipse 60% 40% at 80% 110%, oklch(0.30 0.08 160 / 0.22), transparent 55%);
```

`:root`（亮色）也加同名 token 但值为空/极淡（保证类在 light 下无害）：

```css
--aurora-glow: oklch(0.72 0.14 162 / 0.12);
--nebula: radial-gradient(ellipse 80% 50% at 20% -10%, oklch(0.96 0.01 250 / 0.5), transparent 60%);
```

### 2.2 星尘噪点 overlay（高级感的一半来源）
`app/globals.css` 新增工具类（放在现有 `.landing-grain` 附近，注释说明二者关系——landing-grain 是 landing 专属，这个是全站氛围层通用）：

```css
/* Aurora Deep: 星尘噪点。盖在氛围层容器上消灭纯色塑料感。
   仅 dark 生效；light 保持纸面干净。纯装饰，无语义。 */
.cosmos-noise { position: relative; }
.cosmos-noise::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='128'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='128' height='128' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E");
  background-size: 128px 128px;
  mix-blend-mode: overlay;
  opacity: 0;
}
.dark .cosmos-noise::before { opacity: 0.035; }
```

### 2.3 应用壳氛围层
`app/(app)/layout.tsx`：找到最外层滚动容器（带 `overflow-y-auto` 的 div），加 `cosmos-noise` class。

nebula 背景**不要用 `background-attachment: fixed`**（iOS Safari 强制逐帧重绘，滚动掉帧）。改用固定定位伪元素——星云挂在不滚动的外层：

```css
/* 挂在滚动容器的【父级】（app 壳最外层、h-dvh 不滚动的那个 div）上 */
.dark .app-shell-cosmos { position: relative; }
.dark .app-shell-cosmos::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: var(--nebula);
  z-index: 0;
}
/* 内容层需确保 z-index 高于伪元素（给直接子级 relative + z-[1]，或伪元素 z-index:-1 且父级有背景色） */
```

（light 下无背景变化。若外层已有 `overflow-hidden`/`isolate` 更佳。）

### 2.4 星舰舷窗内亮边（一行代码的质感）
所有工作区页面容器用统一的 `rounded-3xl border-2 border-border/60 bg-background/85 ...` 外壳（fetch/jobs/resume/discover/extension 的 page.tsx 中）。在 globals.css 加：

```css
/* dark 下容器顶部 1px 内亮边——舷窗感 */
.dark .cosmos-panel {
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.05);
}
```

给上述每个页面外壳 `<section>` 添加 `cosmos-panel` class（grep `rounded-3xl border-2 border-border/60` 找到全部 5-6 处）。

### 2.5 Nav 药丸极光底线
`components/app-shell/AppNav.tsx`：nav 药丸容器（motion.div，带 sticky top-3）dark 下加底部渐变亮线。globals.css：

```css
.dark .cosmos-nav::after {
  content: "";
  position: absolute;
  left: 12%; right: 12%; bottom: -1px;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--brand-emerald-500) 50%, transparent);
  opacity: 0.35;
  pointer-events: none;
}
```

nav 容器加 `relative cosmos-nav`（若已有 relative 则只加 cosmos-nav）。

### 2.6 P0 验收
- [ ] dark 模式全站底色为深空墨（明显蓝调，非灰）
- [ ] dark 下每个工作区页面容器有噪点 + 顶部内亮边；light 模式**视觉零变化**
- [ ] `npm run lint && npm run test && npm run build` 全绿
- [ ] DevTools Rendering → prefers-reduced-motion: reduce 下无任何动画

---

## 3. P1 — 记忆点表面

### 3.1 Landing：星场 + 极光带（扩展现有类）
文件：`components/landing/Hero.tsx` + `app/globals.css`。
（现有 landing 类定位：grep `.landing-aurora-blob` / `.landing-grain` / `.landing-atmos`——全部在 globals.css，勿凭行号。）

**星场**（CSS-only，3 层视差）。新建 `components/landing/Starfield.tsx`：

```tsx
"use client";

// 稀疏星场：3 层 box-shadow 星点，随指针微视差。纯装饰。
// 星点用 box-shadow 而非 80 个 DOM 节点——一层一个元素，GPU 合成。
export function Starfield() {
  return (
    <div aria-hidden className="starfield pointer-events-none absolute inset-0 overflow-hidden">
      <div className="starfield-layer starfield-far" />
      <div className="starfield-layer starfield-mid" />
      <div className="starfield-layer starfield-near" />
    </div>
  );
}
```

globals.css（星点坐标用确定性伪随机——直接硬编码生成好的 box-shadow 列表；执行者生成 3 组各 25/18/12 个 `Xpx Ypx var(--star-c)` 坐标，范围 0-1600px × 0-800px）：

```css
.starfield { opacity: 0; }
.dark .starfield { opacity: 1; }
.starfield-layer {
  position: absolute; top: 0; left: 0;
  border-radius: 999px;
  --star-c: oklch(0.9 0.02 250 / 0.5);
  transition: transform 400ms cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform;
}
/* 坐标为确定性布点（0-1600 × 0-800），box-shadow 每项复制一颗星 */
.starfield-far {
  width: 1px; height: 1px;
  box-shadow:
    45px 120px var(--star-c), 160px 640px var(--star-c), 230px 80px var(--star-c),
    310px 420px var(--star-c), 420px 700px var(--star-c), 505px 160px var(--star-c),
    590px 540px var(--star-c), 660px 90px var(--star-c), 730px 380px var(--star-c),
    820px 650px var(--star-c), 905px 210px var(--star-c), 990px 480px var(--star-c),
    1060px 40px var(--star-c), 1130px 720px var(--star-c), 1210px 300px var(--star-c),
    1290px 580px var(--star-c), 1350px 130px var(--star-c), 1420px 450px var(--star-c),
    1495px 690px var(--star-c), 1560px 240px var(--star-c), 90px 330px var(--star-c),
    370px 20px var(--star-c), 680px 760px var(--star-c), 1170px 60px var(--star-c),
    1530px 30px var(--star-c);
  transform: translate(calc(var(--px, 0) * 4px), calc(var(--py, 0) * 4px));
}
.starfield-mid {
  width: 1.5px; height: 1.5px;
  --star-c: oklch(0.92 0.03 200 / 0.6);
  box-shadow:
    120px 250px var(--star-c), 280px 560px var(--star-c), 440px 100px var(--star-c),
    570px 680px var(--star-c), 700px 300px var(--star-c), 850px 520px var(--star-c),
    960px 130px var(--star-c), 1080px 610px var(--star-c), 1230px 380px var(--star-c),
    1380px 90px var(--star-c), 1500px 560px var(--star-c), 200px 720px var(--star-c),
    520px 400px var(--star-c), 780px 40px var(--star-c), 1010px 340px var(--star-c),
    1310px 700px var(--star-c), 60px 60px var(--star-c), 1590px 410px var(--star-c);
  transform: translate(calc(var(--px, 0) * 9px), calc(var(--py, 0) * 9px));
}
.starfield-near {
  width: 2px; height: 2px;
  --star-c: oklch(0.95 0.05 165 / 0.7);
  box-shadow:
    180px 180px var(--star-c), 400px 620px var(--star-c), 640px 460px var(--star-c),
    880px 240px var(--star-c), 1120px 520px var(--star-c), 1340px 200px var(--star-c),
    1550px 640px var(--star-c), 300px 350px var(--star-c), 760px 660px var(--star-c),
    1040px 80px var(--star-c), 1440px 350px var(--star-c), 540px 40px var(--star-c);
  transform: translate(calc(var(--px, 0) * 16px), calc(var(--py, 0) * 16px));
}
@media (prefers-reduced-motion: reduce) { .starfield-layer { transition: none; transform: none !important; } }
```

> 星场覆盖 1600×800；hero 更宽时星点不平铺——可接受（边缘留空即深空）。若需覆盖超宽屏，把三组坐标按 +1600px 偏移复制一份。

视差驱动：Hero.tsx 已有 pointer 跟踪逻辑（`spotlight-card` 体系）——**复用同一 pointermove 监听**，把归一化指针位置写到容器的 `--px`/`--py`（-1..1）。若 Hero 无现成监听则新建一个 rAF 节流的 pointermove（挂在 hero section 上，不挂 window）。

**极光带**：调参现有 `.landing-aurora-blob`（L243 dark 变体）——加一条 60s 漂移动画（若已有动画则只校准时长与透明度）：

```css
.dark .landing-aurora-blob {
  animation: aurora-drift 60s ease-in-out infinite alternate;
}
@keyframes aurora-drift {
  from { transform: translate3d(-4%, 0, 0) rotate(-2deg); }
  to   { transform: translate3d(4%, 2%, 0) rotate(2deg); }
}
@media (prefers-reduced-motion: reduce) { .dark .landing-aurora-blob { animation: none; } }
```

Starfield 挂载：`Hero.tsx` 根 section 内第一个子元素（在现有 atmos/grain 层之下、内容之上按 z-index 排好）。

### 3.2 Login：深空玻璃舱
文件：`app/(auth)/login/page.tsx`。
- 页面根容器：dark 下 `var(--nebula)` 背景 + `cosmos-noise`
- 登录卡片：`backdrop-blur-xl bg-card/70 border border-white/10 rounded-3xl` + 内亮边（复用 `cosmos-panel`）
- 卡片背后呼吸光晕（绝对定位在卡片 -z-10）：

```css
.cosmos-breath {
  background: radial-gradient(circle, var(--aurora-glow), transparent 70%);
  filter: blur(60px);
  animation: cosmos-breath 8s ease-in-out infinite;
}
@keyframes cosmos-breath {
  0%, 100% { opacity: 0.6; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.06); }
}
@media (prefers-reduced-motion: reduce) { .cosmos-breath { animation: none; } }
```

- light 模式：保持现在的干净纸面（所有宇宙类在 light 下自动无效——遵循 2.x 的 `.dark` 前缀模式）

### 3.3 Jobs 空态：星座图
文件：`app/(app)/jobs/JobsClient.tsx`——找到空态块（grep `emptyHeadline`）。将现有插画替换为内联 SVG 星座：5-6 颗星（`circle` r=1.5-2.5，emerald/白）+ 虚线连线（`stroke-dasharray="2 4"`，`stroke="currentColor"` 低透明度），一颗主星带 `<animate>` 缓慢脉冲（3s，opacity 0.6→1；`motion-reduce` 时用 CSS 类关掉 SVG 动画：`.motion-reduce\:pause * { animation: none }` 或改用 CSS 动画实现脉冲）。
- 文案（i18n，双语同时加）：`jobs.emptyCosmosTitle` = "No signals detected yet" / "尚未发现信号"；描述沿用现有 `emptyHint` 逻辑。**注意：现有空态的 CTA/清筛选逻辑与测试（JobsClient.test.tsx 空态断言）必须保持通过**——只换视觉与标题文案，若测试断言旧文案则同步更新断言。

### 3.4 Jobs 行 hover 信号边（数据层唯一允许的装饰）
文件：`app/(app)/jobs/components/JobListItem.tsx`。行根元素（group）加：

```
相对定位 + 伪元素或子 span：左侧 2px、高度 60%、垂直居中、rounded-full、
bg-brand-emerald-500、opacity 0 → group-hover:opacity-100、transition-opacity duration-120
```

禁止：改变行高、加 transform、加阴影（虚拟列表滚动性能）。

### 3.5 Fetch 扫描波
文件：`app/FetchProgressPanel.tsx`。运行中 lane 的进度区顶部加 1px 扫描线：

```css
.cosmos-scan {
  position: relative; overflow: hidden;
}
.cosmos-scan::after {
  content: "";
  position: absolute; top: 0; left: -30%;
  width: 30%; height: 1px;
  background: linear-gradient(90deg, transparent, var(--brand-emerald-400), transparent);
  animation: cosmos-scan 1.4s ease-in-out infinite;
}
@keyframes cosmos-scan { to { left: 100%; } }
@media (prefers-reduced-motion: reduce) { .cosmos-scan::after { animation: none; opacity: 0; } }
```

仅当 lane status 为 RUNNING/QUEUED 时挂 `cosmos-scan`；SUCCEEDED/FAILED 移除。现有 FetchProgressPanel 测试（app/FetchProgressPanel.test.tsx）必须保持通过。

### 3.6 P1 验收
- [ ] dark landing：星场随指针 3 层视差、极光带 60s 漂移；light landing 无星场
- [ ] login 卡片玻璃态 + 呼吸光晕
- [ ] jobs 空态 = 星座 SVG + 双语新文案；行 hover 出现 emerald 信号边
- [ ] fetch 运行中出现扫描波，结束即停
- [ ] messages/en.json 与 zh.json 键完全对等——用此命令验证（输出双向 0 缺失才算过）：

```bash
node -e "const en=require('./messages/en.json'),zh=require('./messages/zh.json');function keys(o,p=''){return Object.entries(o).flatMap(([k,v])=>typeof v==='object'&&v?keys(v,p+k+'.'):[p+k]);}const E=new Set(keys(en)),Z=new Set(keys(zh));console.log('miss zh',[...E].filter(k=>!Z.has(k)),'miss en',[...Z].filter(k=>!E.has(k)))"
```

- [ ] lint/test/build 全绿；reduced-motion 全静止

**P1 预计受影响的测试（改前先读，改后同步断言）**：
- `app/(app)/jobs/JobsClient.test.tsx` — 空态断言（emptyHeadline 等）
- `app/FetchProgressPanel.test.tsx` — 进度面板结构断言
- `app/(marketing)/page.test.tsx` — landing 结构断言（Starfield 是新增子元素，通常不破坏，但 snapshot 类断言会）
- `test/mobileLayoutStyles.test.ts` — 若断言了外壳 className 字符串，`cosmos-panel` 追加可能触发

---

## 4. P2 — 精修

### 4.1 Orbit spinner（统一的宇宙等待态）
新建 `components/ui/orbit-spinner.tsx`：

```tsx
import { cn } from "@/lib/utils";

/** 轨道加载指示：一颗点绕虚线轨道。仅用于"渲染/生成"类长等待。 */
export function OrbitSpinner({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("orbit-spinner", className)}>
      <span className="orbit-dot" />
    </span>
  );
}
```

```css
.orbit-spinner {
  position: relative; display: inline-block;
  width: 24px; height: 24px;
  border: 1px dashed oklch(0.65 0.02 250 / 0.4);
  border-radius: 999px;
  animation: orbit-rotate 1.6s linear infinite;
}
.orbit-dot {
  position: absolute; top: -3px; left: 50%;
  width: 5px; height: 5px; margin-left: -2.5px;
  border-radius: 999px;
  background: var(--brand-emerald-500);
  box-shadow: 0 0 6px var(--aurora-glow);
}
@keyframes orbit-rotate { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .orbit-spinner { animation: none; border-style: solid; }
}
```

**替换范围（仅这三处，其余 Loader2 保留）**：
1. `app/(app)/jobs/[id]/tailor/PdfPreview.tsx` 渲染等待
2. `components/resume/PreviewPanel.tsx` 的 dynamic-import loading spinner
3. `app/(app)/jobs/components/GenerateProgress.tsx` 生成中指示（若其结构是步骤列表则只替换主 spinner）

**a11y**：OrbitSpinner 本体 `aria-hidden`——替换时**保留**原位置已有的 `aria-busy` / `role="status"` / 可见等待文案，只换视觉，不换语义。

### 4.2 Tailor 专注舱暗角
`app/(app)/jobs/[id]/tailor/TailorClient.tsx` 根容器加 class；globals.css：

```css
.dark .cosmos-focus {
  box-shadow: inset 0 0 120px 30px oklch(0 0 0 / 0.25);
}
```

编辑区本身（textarea/输入）不动。

### 4.3 成功星点迸发（一次性，非循环）
`app/FetchProgressPanel.tsx` 成功态数字：包一个 relative span，挂载时 4 个 2px emerald 点从中心向四角 200ms 散开淡出（CSS animation，`forwards`，一次性）。`motion-reduce` 直接无动画。仅在从 RUNNING→SUCCEEDED 转换时触发一次（用 key 或 state flag）。

### 4.4 P2 验收
- [ ] 三处等待态为 orbit spinner，其余 Loader2 不变
- [ ] tailor dark 有轻微暗角、编辑区无变化
- [ ] 成功迸发只播一次
- [ ] lint/test/build 全绿

---

## 5. 回归红线（本项目近期修复,绝对不许打破）

1. **VirtualJobList 每行禁止入场动画**（刚移除的快滚鬼影,勿加回）
2. **RouteTransition 只有一层入场动画**（页面根节点勿再加 edu-page-enter 类叠加）
3. `.filter-chip--*` 已 token 化支持 dark——新样式一律走 token,禁止裸 hex（landing 专属亮色系除外,但必须配 `.dark` 变体）
4. `brand-emerald-300/400` token 已定义可用
5. i18n：任何新用户可见文案必须 en+zh 同加；aria-label 也算文案
6. 对比度：dark 深空底上正文 ≥4.5:1；小号 muted 文字勿再加低透明度
7. 现有测试全部保持通过；改动波及断言时同步更新断言而非删测试
8. `messages/*.json` 键对等校验必须 0 缺失
9. 禁止引入新依赖（不装 three.js/粒子库/新字体——现有 framer-motion + CSS 足够）
10. 所有新 CSS 类命名统一 `cosmos-*` 前缀（starfield/orbit 除外），集中放在 globals.css 一个带注释的段落里

## 6. 交付顺序与提交规范

- 按 P0 → P1 → P2 分三次提交,每次提交前跑全套验证
- Conventional commits：`feat(ui): aurora deep P0 — deep-space tokens + cosmos atmosphere`（P1/P2 同理）
- 禁止 `--no-verify`；不推送远端（本地提交即可）

## 7. 最终验收总清单

- [ ] dark = 深空墨 + 噪点 + 舷窗亮边 + nav 极光线（P0）
- [ ] landing 星场视差 + 极光漂移；login 玻璃舱呼吸（P1）
- [ ] jobs 星座空态 + hover 信号边；fetch 扫描波（P1）
- [ ] orbit spinner ×3、tailor 暗角、成功迸发（P2）
- [ ] light 模式除 login 玻璃卡外视觉基本零变化
- [ ] prefers-reduced-motion 下全静止；纯装饰元素 aria-hidden
- [ ] lint 0/0 · test 全绿 · build 绿 · en/zh 键对等 0 缺失
- [ ] 数据层（jobs 行、表单、JD 正文）除 3.4 信号边外零改动
