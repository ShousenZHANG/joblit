# Cover Letter 生成最优性分析

## 当前设计概览

### 输出契约 (schema)

- **必填**：`paragraphOne`, `paragraphTwo`, `paragraphThree`（各 1–2000 字符）。
- **选填**：`candidateTitle`, `subject`, `date`, `salutation`, `closing`, `signatureName`（长度均有限制）。
- 渲染：LaTeX 按三段落 + 上述字段生成 PDF，支持 **keyword** 加粗。

### 规则与结构 (rules + structure block)

- 澳洲职场 + 大厂标准：直接、简洁、自信但克制；证据优先、无套路开头；280–360 词。
- 三段分工：P1 意图与匹配，P2 证据映射（Top-3 职责优先），P3 动机（一到两个具体点）。
- 禁止编造、自然第一人称、JD 关键词加粗、无 hype/filler。

### 技能包 (SKILL)

- Trigger、Execution、Verification 已对齐「修改简历 / 生成 CL」及 AU + 大厂标准。
- **Pack 内 cover 示例**（`examples/output.cover.minimal.json`）当前为占位式泛化内容（"I am applying for...", "My recent work aligns strongly...", "I am interested in ... because of its mission..."），与规则中「不要套路开头 / 证据先行 / 低调动机」**不一致**，模型容易模仿成泛化腔。

---

## 已做得好的部分（接近最优）

| 维度 | 现状 | 说明 |
|------|------|------|
| 三段结构 | 清晰 | P1 意图/匹配，P2 证据，P3 动机，符合常见大厂 CL 结构。 |
| 字数约束 | 280–360 | 适合一页内、易扫读，不会过长。 |
| AU + 大厂语气 | 已写入规则与 SKILL | 直接、证据先行、无套路开头、低调自信、协作语气。 |
| 事实约束 | 强 | 仅基于候选人简历、禁止编造。 |
| Schema | 完整 | 必备业务信要素齐全，可选字段合理。 |
| 关键词加粗 | 有 | 利于 ATS/扫读，且与渲染兼容。 |

---

## 可改进点

### 1. Pack 内 cover 示例与规则不一致（建议必做）

- **问题**：示例里仍是 "I am applying for...", "My recent work aligns strongly...", "I am interested in ... because of its mission..."，和「不要 generic openers / 证据先行 / 具体动机」冲突，易把生成结果拉回泛化版本。
- **建议**：把 `output.cover.minimal.json` 的示例改成符合当前规则的短例：P1 用经历锚定（无 "I am writing to apply"），P2 用一句证据+结果，P3 用具体、低调的动机表述。这样「当前生成的 Cover letter」会更接近你定义的最优版本。

### 2. 段落篇幅分配未写死（可选）

- **现状**：只规定总字数 280–360，未规定各段比例。
- **建议**：可在规则里加一句「P1 约 2–3 句，P2 占主体篇幅，P3 约 2–3 句」，减少 P1 过长或 P2 过短。非必须，属微调。

### 3. Cover 未注入「Top-3 职责」列表（可选）

- **现状**：Resume 有 coverage block（top-3、missing、fallback）；Cover 只有完整 JD，模型自行从 JD 提炼重点。
- **建议**：若希望 P2 更稳定对齐 JD 优先级，可在 cover 的 user prompt 中注入与 resume 相同的 top-3 职责列表（仅列表，不需 missing/fallback），便于模型「先写这三点再写其余」。实现成本适中，收益是 P2 更一致、可预测。

### 4. 规则内少量重复（可选）

- 「Bold all JD-critical keywords」与「Naturally bold JD-critical terms」意思重叠，可合并为一条，减少 token、避免歧义。

---

## 结论：是否已是最优版本？

- **规则与结构**：在「澳洲职场 + 大厂、证据先行、无编造、三段式、280–360 词」的前提下，**已接近最优**；主要缺口在**示例与规则不一致**。
- **生成结果**：在未改示例前，模型容易受当前 pack 示例影响，产出仍偏泛化；**更新 pack 内 cover 示例后**，整体可视为**当前设定下的最优版本**。
- **若再要做精**：可加上「段落篇幅建议」和「Cover 注入 Top-3 职责」两项可选增强。

---

## 建议执行顺序

1. **立即**：更新 `examples/output.cover.minimal.json`（及生成该内容的 `skillPack.ts` 内 `coverExampleJson`）为符合 AU + 大厂规则的短例。
2. **可选**：在 DEFAULT_COVER_RULES 或 buildCoverStructureBlock 中增加一句段落篇幅建议；Cover user prompt 中注入 top-3 职责列表（需从现有 coverage 或新算 cover 用 top-3）。
