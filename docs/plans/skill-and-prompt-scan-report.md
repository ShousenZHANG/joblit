# Skill 与 Prompt 扫描报告

> 对照 skill-creator（writing-skills）规范与当前实现，扫描 Cursor Skill、Pack SKILL、以及 Pack 内 prompt 的符合性与最优性。

---

## 一、扫描范围

| 对象 | 位置 | 用途 |
|------|------|------|
| **Cursor Skill** | `skills/joblit/SKILL.md` + README + references | Cursor 在 joblit 仓库内工作时的指引 |
| **Pack SKILL** | `lib/server/ai/skillPack.ts` 内生成的 `SKILL.md`（包内 `joblit-tailoring/SKILL.md`） | 外部模型使用 skill pack 时的单源真相 |
| **Pack Prompts** | `lib/server/ai/applicationPromptBuilder.ts` → 包内 `prompts/system.txt`、`resume-user.txt`、`cover-user.txt` | 每次生成 CV/CL 时发给外部模型的 system + user prompt |

---

## 二、Cursor Skill（skills/joblit/）vs skill-creator

### 2.1 已符合项

- **Frontmatter**：仅 `name`、`description`，且 `name` 为字母/数字/连字符（`joblit`）✓  
- **description 以 “Use when” 开头**：有 ✓  
- **Overview**：简短，核心一句（job-search command center）✓  
- **When to Use**：有，且为 bullet 症状/场景 ✓  
- **Key Paths / 结构**：有，并指向 references ✓  
- **Non-Negotiable Rules**：有 ✓  
- **细节外置**：PATHS.md、FLOWS.md 独立，SKILL 保持精简 ✓  
- **Token 效率**：SKILL 主体短，适合常驻 ✓  

### 2.2 待改进（与 writing-skills 一致）

| 项 | 规范要求 | 当前 | 建议 |
|----|----------|------|------|
| **description 仅写“何时用”** | 只写触发条件，不写“做什么” | 含 “Provides structure, key paths, and non-negotiable conventions.” | 删除该句，或改为纯触发条件（例如 “Use when working in Joblit repo or when discussing job fetch, tailoring, skill pack, or PDF export.”） |
| **When NOT to use** | 建议有 | 无 | 可加一句（如 “Do not use for repositories other than joblit.”） |
| **Common Mistakes** | 建议有 | 无 | 可加与 “Non-Negotiable Rules” 对应的易错点（如 “Calling manual-generate without promptMeta” 等） |

### 2.3 结论（Cursor Skill）

- **是否“完全按 skill-creator 实现”**：**基本符合**，差在 description 含“做什么”的概括、以及可选小节 When NOT to use / Common Mistakes 缺失。  
- 若严格对齐 writing-skills 的 CSO（description = 仅触发条件、不概括流程），需按上表改 description 并视需要补两小节。

---

## 三、Pack SKILL（joblit-tailoring）vs skill-creator

- Pack SKILL 面向**外部模型**，格式上借鉴 skill，但 YAML 含 `version`/`locale`，属于合理扩展。  
- **description** 当前为：“Generate recruiter-grade CV/Cover JSON from JD using strict contracts for Joblit PDF rendering.”  
  - 这是“做什么”的概括；writing-skills 建议 description 以“何时用”为主。  
  - **建议**：改为触发型，例如  
    `Use when a job description is provided and tailored CV or Cover Letter JSON is needed for Joblit import.`  
- **Trigger Conditions / Required Inputs / Execution / Output Contracts / Verification / Failure and Recovery** 均存在且清晰，与单源真相、JSON-only、schema 约束一致 ✓  

### 结论（Pack SKILL）

- 结构完整、可执行性强；若严格对齐 skill-creator 的“description 仅触发条件”，只需改 description 一句。

---

## 四、Pack 内 Prompt（system + user）准确性与最优性

### 4.1 准确性（与 pack 结构、契约一致）

| 检查项 | 状态 |
|--------|------|
| 系统 prompt 中 resume 上下文路径 | `joblit-tailoring/context/resume-snapshot.json` ✓ 与包内路径一致 |
| “Use the imported skill package as the single source of truth” | ✓ 与 Pack SKILL 定位一致 |
| Hard Constraints 来自 `rules.hardConstraints` | ✓ 与默认/用户规则一致 |
| User prompt 中 Required JSON shape | 来自 `getExpectedJsonShapeForTarget` ✓ 与 schema 一致 |
| Resume：top-3、base bullets、missing、fallback、skillsFinal、verbatim | ✓ 与 DEFAULT_CV_RULES 及 Pack SKILL 一致 |
| Cover：paragraphOne/Two/Three、subject/salutation、bold、candidate voice | ✓ 与 DEFAULT_COVER_RULES 及 Pack SKILL 一致 |
| 无 LaTeX、无 code fence、仅 JSON | ✓ 与 hard constraints 一致 |

未发现与 schema、规则或包结构的冲突；**准确性可接受**。

### 4.2 最优性（可改进点）

| 位置 | 问题 | 建议 |
|------|------|------|
| **System prompt** | 两行连续表述 “Markdown bold markers inside JSON … are allowed” 含义重复 | 合并为一句，减少 token、避免歧义 |
| **System prompt** | “Do not output file/path diagnostics or process notes” 与 “JSON only” 有重叠 | 可保留（强调“不要额外输出”），或与 JSON-only 合并为一条 |
| **User prompt（resume）** | 执行清单与 DEFAULT_CV_RULES 有部分重复 | 可接受：清单是强约束摘要，规则是完整策略，各有用途 |
| **User prompt（cover）** | 2-stage process、rewrite pass 等写得很细 | 有利于质量；若未来要压 token 可考虑“见 SKILL 执行步骤”的引用式写法 |

### 4.3 与 Pack SKILL 的分工

- **Pack SKILL**：一次性阅读的“工作流 + 契约 + 校验清单”。  
- **Prompts**：每次请求的“当前任务 + 本 job 的 JD/简历片段 + 必遵规则摘要”。  
- 规则在 SKILL 与 user prompt 中都有出现是**有意重复**，保证仅读 prompt 也能执行；**当前分工合理**。

### 结论（Prompt）

- **是否已是最优最准确**：**准确**（与 schema、规则、包结构一致）。  
- **最优**：可做小优化（合并 system 中两行 Markdown bold 说明）；其余保持即可，无需大改。

---

## 五、汇总与建议优先级

| 优先级 | 对象 | 动作 |
|--------|------|------|
| **P1** | Cursor Skill `description` | 去掉 “Provides structure, key paths, and non-negotiable conventions.”，或改为纯“何时用”表述 |
| **P2** | Pack SKILL `description` | 改为 “Use when…” 触发型（见第三节） |
| **P2** | System prompt | 合并两行 “Markdown bold markers … allowed” 为一句 |
| **P3** | Cursor Skill | 视需要补 “When NOT to use”“Common Mistakes” |
| **P3** | Pack SKILL | 若希望与 Cursor 技能风格完全统一，可再收紧 description 字数 |

完成 P1+P2 后，Skill 与 prompt 在“按 skill-creator 实现”和“最优最准确”两方面即可达到当前设计目标；P3 为可选增强。
