# 手动复制 Prompt 长度扫描与分析

## 当前流程

1. 用户下载 jobflow-tailoring 压缩包并解压，将包内容（SKILL.md、rules、schema、context、prompts）喂给大模型。
2. 在 Jobflow 里对某个职位点击 Generate CV/CL，点击「Copy Prompt」。
3. 复制的内容被粘贴到已加载 pack 的对话里，模型按指令产出 JSON。

**问题**：每次复制的 prompt 是否必须那么长？是否合理？

---

## 当前复制内容构成（JobsClient.loadTailorPrompt）

拼接顺序与大致长度（估算）：

| 部分 | 内容来源 | 估算字符 | 说明 |
|------|----------|----------|------|
| 头部说明 | 固定 4 行 | ~180 | "You are given SYSTEM and USER instructions below. Follow them strictly. Output MUST be exactly one valid JSON object. Do not add any markdown..." |
| SYSTEM INSTRUCTIONS | `buildApplicationSystemPrompt(rules)` | ~700–900 | 角色、用 pack 为单源真相、resume 路径、JSON-only、bold 允许、Hard Constraints 列表 |
| USER INSTRUCTIONS | `buildApplicationUserPrompt(...)` | 见下 | |
| JSON OUTPUT CONTRACT | `expectedJsonShape`（JSON 字符串） | ~400–600 | 与 user 里的 Required JSON shape **完全重复** |
| **USER 内部细分** | | | |
| → Task + 规则一句 | 1–2 行 | ~150 | |
| → Required JSON shape | 多行 JSON 形状 | ~400–600 | 与 CONTRACT 重复 |
| → JSON-only 提醒 | 1 行 | ~80 | |
| → Resume: 覆盖块 | top-3、base bullets、missing、fallback、checklist | ~1200–2500 | **职位+简历相关，必要** |
| → Resume: skills policy | 9 条 | ~550 | 与 pack 内 SKILL/rules 重复 |
| → Cover: structure block | 14 条 | ~900 | 与 pack 内 SKILL 重复 |
| → CV/Cover Rules | 默认 30/22 条 | ~2500/1800 | 与 pack 内 cv-rules.md/cover-rules.md **完全重复** |
| → Job Input | title, company, **description** | 视 JD 长度 | **必要**，常为 2000–8000+ |

**总长**（不含 JD）：约 6000–8000 字符；**含 JD**：约 8000–20000+ 字符。

---

## 合理性分析

### 1. 设计意图：一次粘贴即可用（不依赖先上传 pack）

当前逻辑是：**单次复制的内容自包含**，粘贴到**新对话**也能用（不要求用户先上传 pack）。因此必须包含：

- 完整 system 指令（角色、JSON-only、hard constraints）
- 完整 user 指令（任务、规则、技能/cover 结构、Job Input）
- 明确输出契约（JSON shape）

在这种前提下，**长度偏长是预期内的**，因为把「本应在 pack 里的规则」又塞进每次复制的 prompt 里了。

### 2. 与你实际使用方式错位

你的实际用法是：**先下载并喂了 pack，再复制 prompt**。此时：

- **重复 1**：System 里「用 pack 为单源真相」「读 context/resume-snapshot.json」等，模型已从 pack 的 SKILL 和文件里获得。
- **重复 2**：User 里的 CV Rules / Cover Rules、skills policy、cover structure 与 pack 内 `rules/cv-rules.md`、`rules/cover-rules.md`、SKILL 的 Execution/Verification 高度重复。
- **重复 3**：Required JSON shape 与末尾「=== JSON OUTPUT CONTRACT ===」**完全重复**，多占一份长度且无信息增量。

真正**每次换职位都必须变**的只有：

- 目标（resume / cover）
- 职位信息：title、company、**job description**
- （仅 resume）本职位与简历的对齐：top-3、base bullets、missing、fallback、建议新增条数（即 coverage 块）

所以：**在「已喂 pack」的前提下，当前复制内容不必那么长；存在明显冗余。**

### 3. 结论

| 维度 | 结论 |
|------|------|
| 若坚持「一次粘贴、不依赖 pack」 | 当前长度有合理性，但 **JSON shape 重复一次** 仍属明显浪费，应去掉一处。 |
| 若以「已加载 pack 后每次只发职位相关」为主场景 | 当前设计**不合理**：应提供**短版 prompt**，只含目标 + 职位 +（resume 时）覆盖块 + 一句「按 pack 输出 JSON」。 |

---

## 建议改动

### A. 立刻可做（不改变使用方式）

- **去掉重复的 JSON 契约**：当前「Required JSON shape」已出现在 user 段内，末尾「=== JSON OUTPUT CONTRACT ===」与之完全重复。建议**删除 CONTRACT 整段**，只保留 user 内一份，复制内容可减少约 400–600 字符。

### B. 支持「已加载 pack」的短版复制

- **服务端**：在 `POST /api/applications/prompt` 的响应中增加 `shortUserPrompt`（或等价字段），内容仅包含：
  - 目标（resume/cover）
  - 一句：「按你已加载的 jobflow-tailoring 规则与 schema，输出唯一 JSON，不要 markdown/code fence。」
  - Job title、Company、Job description
  - 若 target=resume：当前 job 的 coverage 块（top-3、base bullets、missing、fallback、suggested additions）；不包含完整 CV rules、skills policy、JSON shape。
- **前端**：在「Copy Prompt」旁增加「Copy short prompt (pack already loaded)」（或折叠/切换），复制内容为上述 `shortUserPrompt` + 极简头部（可选）。这样在已喂 pack 的前提下，每次复制量可降到约 1500–5000 字符（主要差在 JD 长度），**长度合理**且不丢必要信息。

### C. 文档与 UI 提示

- 在「Copy short prompt」旁或帮助文案中说明：仅当**已把 jobflow-tailoring 包内容提供给当前对话**时使用短版；否则用「Copy full prompt」。
- 可选：在下载 pack 的说明里加一句：「若每次生成前都会先上传/粘贴本包，可使用『Copy short prompt』减少重复内容。」

---

## 总结

- **是否合理**：在「不假设已加载 pack」的前提下，当前偏长但可接受；**在「已喂 pack」的前提下，当前复制内容过长、不合理**。
- **最小改动**：去掉末尾重复的 JSON OUTPUT CONTRACT（保留 user 内 Required JSON shape）。
- **更合理体验**：增加「短版 prompt」与对应 API 字段，供已加载 pack 的用户每次只复制职位相关 + 一句约束，长度与使用方式更匹配。
