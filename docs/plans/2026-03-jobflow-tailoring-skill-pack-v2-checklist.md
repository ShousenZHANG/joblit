# Jobflow Tailoring Skill Pack v2 — 下一步修改清单

> 执行顺序建议按步骤 1 → 2 → 3 → 4。每步完成后运行验证再进入下一步。

---

## 步骤 1：新增 `meta/manifest.json`（Pack 生成）

**文件：** `lib/server/ai/skillPack.ts`

**修改内容：**

1. 在文件顶部增加对 `buildSkillPackVersion` 的导入（来自 `@/lib/server/ai/promptContract`），并确保已导入 `PROMPT_TEMPLATE_VERSION`、`PROMPT_SCHEMA_VERSION`（若未导入则补上）。
2. 在 `buildGlobalSkillPackFiles` 内、在组装 `return` 的数组之前：
   - 计算 `resumeSnapshotUpdatedAt = context?.resumeSnapshotUpdatedAt ?? "missing-profile"`。
   - 计算 `skillPackVersion = buildSkillPackVersion({ ruleSetId: rules.id, resumeSnapshotUpdatedAt })`。
   - 定义 `manifest` 对象，字段建议：
     - `packName`: `"jobflow-tailoring"`
     - `packVersion`: `rules.id`
     - `generatedAt`: `new Date().toISOString()`
     - `redacted`: `!!options?.redactContext`
     - `ruleSetId`: `rules.id`
     - `resumeSnapshotUpdatedAt`
     - `promptTemplateVersion`: `PROMPT_TEMPLATE_VERSION`
     - `schemaVersion`: `PROMPT_SCHEMA_VERSION`
     - `skillPackVersion`
     - `files`: 当前函数即将 return 的 `files` 里每一项的 `name` 组成的数组（可在构建完所有文件后从数组 map 出 `name` 再写入 manifest，或先构建 manifest 用的列表再 push manifest 条目）。
3. 在 return 的数组中，在 `meta/prompt-contract.json` 之前或之后增加一条：
   - `{ name: "jobflow-tailoring/meta/manifest.json", content: JSON.stringify(manifest, null, 2) }`  
   （注意：若 manifest 需要 `files` 列表，则需先得到完整文件列表再生成 manifest，再在数组中包含 manifest 文件；可实现为：先构建不含 manifest 的 `files` 数组，再 `const fileList = files.map(f => f.name)`，再 `manifest.files = fileList`，最后 `files.push({ name: "jobflow-tailoring/meta/manifest.json", content: JSON.stringify(manifest, null, 2) })` 并 return `files`。）

**验证：**

```bash
cd jobflow && npx vitest run test/server/skillPack.test.ts -v
```

- 预期：所有用例通过。
- 新增断言（在 `test/server/skillPack.test.ts`）：  
  - 存在 `file.name === "jobflow-tailoring/meta/manifest.json"`。  
  - 解析其 `content` 为 JSON，断言存在字段：`packName`、`packVersion`、`generatedAt`、`redacted`、`ruleSetId`、`resumeSnapshotUpdatedAt`、`skillPackVersion`、`files`（数组），且 `packName === "jobflow-tailoring"`。

---

## 步骤 2：下载 API 文件名改为 jobflow-tailoring

**文件：** `app/api/prompt-rules/skill-pack/route.ts`

**修改内容：**

- 第 64 行：将  
  `const filename = \`jobflow-skill-pack-${safeSegment(rules.id)}-${today}.tar.gz\`;`  
  改为  
  `const filename = \`jobflow-tailoring-${safeSegment(rules.id)}-${today}.tar.gz\`;`

**验证：**

```bash
cd jobflow && npx vitest run test/api/promptRulesSkillPack.test.ts -v
```

- 预期：全部通过。  
- 可选：在 `test/api/promptRulesSkillPack.test.ts` 的 “returns tar.gz bundle” 中增加断言：  
  `expect(res.headers.get("content-disposition")).toMatch(/jobflow-tailoring-/);`

---

## 步骤 3：前端与 builder 中的路径/命名统一

**文件与修改：**

| 文件 | 位置 | 原内容 | 改为 |
|------|------|--------|------|
| `app/(app)/jobs/JobsClient.tsx` | 第 1414 行附近 | `fallbackName = "jobflow-skill-pack.tar.gz"` | `fallbackName = "jobflow-tailoring.tar.gz"` |
| `components/resume/PromptRulesManager.tsx` | 第 160 行附近 | `fallbackName = "jobflow-skill-pack.tar.gz"` | `fallbackName = "jobflow-tailoring.tar.gz"` |
| `lib/server/ai/applicationPromptBuilder.ts` | 第 129 行 | `jobflow-skill-pack/context/resume-snapshot.json` | `jobflow-tailoring/context/resume-snapshot.json` |

**验证：**

```bash
cd jobflow && npx vitest run test/server/skillPack.test.ts test/api/promptRulesSkillPack.test.ts -v
```

- 预期：全部通过。  
- 若存在 `app/(app)/jobs/JobsClient.test.tsx` 且其中 mock 了 `content-disposition` 为 `jobflow-skill-pack.tar.gz`，则改为 `jobflow-tailoring-...` 或至少包含 `jobflow-tailoring`，保证测试通过。

---

## 步骤 4：测试中强化契约与旧前缀清理

**文件 1：** `test/server/skillPack.test.ts`

- 已有对 `jobflow-tailoring/...` 的断言，保持不变。
- 在步骤 1 中已增加对 `meta/manifest.json` 存在及字段的断言。
- 增加一条：解压/文件列表中**不包含**任何 `name` 以 `jobflow-skill-pack/` 开头的项（例如 `expect(files.every(f => !f.name.startsWith("jobflow-skill-pack/"))).toBe(true)`）。

**文件 2：** `app/(app)/jobs/JobsClient.test.tsx`

- 若其中有 `"content-disposition": 'attachment; filename="jobflow-skill-pack.tar.gz"'`，改为与 route 一致的文件名格式，例如 `filename="jobflow-tailoring-rules-2026-03-10.tar.gz"` 或使用正则匹配 `jobflow-tailoring.*\.tar\.gz`。

**验证：**

```bash
cd jobflow && npx vitest run test/server/skillPack.test.ts test/api/promptRulesSkillPack.test.ts app/\(app\)/jobs/JobsClient.test.tsx -v
```

- 预期：全部通过。

---

## 可选步骤（按需执行）

- **Prompt 文件名统一为 design：**  
  在 `lib/server/ai/skillPack.ts` 的 `buildPromptFiles` 中，将  
  `system-prompt-template.txt` → `system.txt`，  
  `resume-user-prompt-template.txt` → `resume-user.txt`，  
  `cover-user-prompt-template.txt` → `cover-user.txt`。  
  同时更新 `test/server/skillPack.test.ts` 中对应断言，以及 README/SKILL 内提到的文件名（若有）。

- **Schema/Examples 命名：**  
  若设计文档要求 schema 为 `output.resume.schema.json` / `output.cover.schema.json`、examples 为 `output.resume.minimal.json` / `output.cover.minimal.json`，可在步骤 1 之后统一重命名并更新 SKILL/README 内引用与测试断言。

- **手工验收（Task 5）：**  
  下载 tar.gz → 解压 → 确认根目录为 `jobflow-tailoring/`，存在 `meta/manifest.json` → 按 SKILL 流程用外部模型跑一遍 → 将产出 JSON 导入 Jobflow 验证。

---

## 完成标准

- [ ] 步骤 1：manifest 已生成，单测含 manifest 断言并通过。
- [ ] 步骤 2：下载文件名为 `jobflow-tailoring-*.tar.gz`，API 测试通过。
- [ ] 步骤 3：三处前端/builder 已改为 `jobflow-tailoring`，无 `jobflow-skill-pack` 引用。
- [ ] 步骤 4：无 `jobflow-skill-pack/` 前缀断言已加，JobsClient 相关测试通过。
- [ ] 可选：prompt/schema/examples 命名与设计一致；手工验收已做。
