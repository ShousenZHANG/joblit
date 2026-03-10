---
title: 简历模块：移除年龄/性别，新增到岗时间（YYYY-MM）
date: 2026-03-10
status: approved-by-user
scope:
  - 前端简历表单（Basics）
  - 简历 profile 保存/回显
  - CN 简历 LaTeX 映射与渲染
non_goals:
  - 不做存量数据清理/迁移（历史 age/gender 允许存在但不再使用）
  - 不引入新模板体系（仍基于现有 Resume_CN）
constraints:
  - 年龄/性别在前端 UI 中移除，保存后不会再出现
  - 预览与最终 PDF 输出中不包含年龄/性别
  - 到岗时间由用户填写，格式为 YYYY-MM，允许为空
---

## 背景

当前 CN 简历 Header 的个人信息行会包含 `性别/年龄/身份` 等信息。需求为：

1. **移除** 年龄与性别：简历内容中不展示；前端页面移除；后续保存也不再出现。
2. **新增** 到岗时间：用户在前端填写，格式为 **YYYY-MM**；展示在“身份”之后，文案为 **`到岗：YYYY-MM`**。

## 目标

- 让简历更符合国内大厂常见简历规范（避免年龄/性别这类敏感信息）。
- 保证数据链路一致：表单填写 → 保存 → 回显 → 预览 PDF → 下载/生成 PDF 全链路一致。

## 设计概览（推荐方案：前端移除 + 后端忽略）

### 数据模型

- **移除使用**：
  - `basics.gender`
  - `basics.age`
  - 说明：不要求清理历史数据；但任何渲染/预览/回显/保存逻辑不再读取或写入这两个字段。

- **新增字段**：
  - `basics.availabilityMonth`（string，格式 `YYYY-MM`，允许为空）

### 前端（ResumeForm / Basics）

- 在简历模块的 **Basics** 步骤中：
  - 删除“性别”“年龄”输入项与所有展示/回显逻辑
  - 新增“到岗（YYYY-MM）”输入项
    - placeholder 示例：`2026-03`
    - 允许为空（为空则不展示到 PDF header）

- **保存一致性**：
  - 提交 payload 时不再包含 `gender/age`
  - 保存后再次打开简历表单，不显示/不回填 `gender/age`

### 服务端（CN 映射与渲染）

- `mapResumeProfileCN`：
  - `personalInfoLine` 只从以下字段构建：
    - `identity`（原有“身份”字段）
    - `availabilityMonth`（新增到岗时间）
  - 展示规则：
    - 若 `identity` 非空：先输出 `identity`
    - 若 `availabilityMonth` 非空：追加 `到岗：YYYY-MM`
    - 分隔符保持与现有 header 一致（当前为 `$\cdot$`）
  - `gender/age` 不再参与 personalInfoLine（即使历史数据存在）。

- `Resume_CN/main.tex`：
  - 不要求修改结构；仍通过 `{{PERSONAL_INFO_LINE}}` 注入。

## 验收标准（Acceptance Criteria）

1. **前端**：
   - 简历表单中不再出现“性别/年龄”字段
   - Basics 中可填写到岗时间（YYYY-MM），保存后可回显
2. **保存/回显**：
   - 新保存记录不包含 gender/age（payload 不提交；后端不写入）
3. **PDF 预览/生成**：
   - Header 的个人信息行不包含性别/年龄
   - 当到岗时间有值时，展示 `到岗：YYYY-MM`（在身份后）
4. **兼容历史数据**：
   - 历史 profile 即使仍含 gender/age，也不会在 UI 或 PDF 中出现

## 风险与对策

- **旧客户端/异常请求**可能仍提交 `gender/age`：推荐在 API 层剔除/忽略（不报错，保证兼容）。
- **格式错误**（如 `2026-3`）：前端可做轻校验/掩码；后端映射时按“无效则不展示”的策略保守处理（不影响编译）。

