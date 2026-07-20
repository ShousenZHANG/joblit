type Locale = "en" | "zh";

export type StoryForMatching = {
  id: string;
  title: string;
  skills: string[];
  tags: string[];
};

export type InterviewQuestion = {
  id: string;
  requirement: string;
  question: string;
  followUps: string[];
  evidenceRequired: true;
};

const stopWords = new Set([
  "and", "the", "with", "for", "from", "that", "this", "you", "your",
  "years", "year", "experience", "skills", "ability", "using", "have",
  "以及", "具备", "经验", "能力", "负责", "相关", "工作", "熟悉",
]);

function tokens(value: string): Set<string> {
  const normalized = value
    .toLocaleLowerCase()
    .normalize("NFKC");
  const terms = normalized.match(/[\p{L}\p{N}+#.]{2,}/gu) ?? [];
  const result = new Set(terms.filter((term) => !stopWords.has(term)));
  for (const run of normalized.match(/[\u3400-\u9fff]{2,}/gu) ?? []) {
    for (let index = 0; index < run.length - 1; index += 1) {
      result.add(run.slice(index, index + 2));
    }
  }
  return result;
}

function overlapScore(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  return intersection / new Set([...left, ...right]).size;
}

export function buildInterviewQuestions(
  requirements: string[],
  locale: Locale = "en",
): InterviewQuestion[] {
  return requirements.map((raw, index) => {
    const requirement = raw.replace(/\s+/g, " ").trim();
    return locale === "zh"
      ? {
          id: `requirement-${index + 1}`,
          requirement,
          question: `请用一个真实案例说明你如何满足这项要求：「${requirement}」。`,
          followUps: [
            "当时的具体目标和限制是什么？",
            "哪些行动由你本人完成？",
            "结果如何衡量？如果没有量化数据，请明确说明。",
          ],
          evidenceRequired: true as const,
        }
      : {
          id: `requirement-${index + 1}`,
          requirement,
          question: `Describe one real example that demonstrates: "${requirement}".`,
          followUps: [
            "What was the exact goal and constraint?",
            "Which actions did you personally take?",
            "How was the result measured? Say explicitly if no metric exists.",
          ],
          evidenceRequired: true as const,
        };
  });
}

export function mapStarStoriesToRequirements(
  requirements: string[],
  stories: StoryForMatching[],
) {
  return requirements.map((requirement, requirementIndex) => {
    const requirementTokens = tokens(requirement);
    const candidates = stories
      .map((story) => ({
        storyId: story.id,
        storyTitle: story.title,
        score: overlapScore(
          requirementTokens,
          tokens([story.title, ...story.skills, ...story.tags].join(" ")),
        ),
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || a.storyId.localeCompare(b.storyId))
      .slice(0, 3);

    return {
      requirementId: `requirement-${requirementIndex + 1}`,
      requirement,
      candidates,
      needsEvidence: candidates.length === 0,
    };
  });
}

type NegotiationInput = {
  company: string;
  role: string;
  currency: string;
  offeredTotal?: number | null;
  targetTotal?: number | null;
  strengths: string[];
  locale?: Locale;
};

function money(value: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-AU", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function buildNegotiationScript(input: NegotiationInput) {
  const locale = input.locale ?? "en";
  const offered = input.offeredTotal == null
    ? null
    : money(input.offeredTotal, input.currency, locale);
  const target = input.targetTotal == null
    ? null
    : money(input.targetTotal, input.currency, locale);
  const strengths = input.strengths.map((item) => item.trim()).filter(Boolean);
  const evidenceLine = strengths.length > 0
    ? strengths.map((item) => `- ${item}`).join("\n")
    : locale === "zh"
      ? "- 请加入一项可验证的个人优势；当前未自动补写。"
      : "- Add one verifiable strength; none was invented.";

  const script = locale === "zh"
    ? [
        `感谢 ${input.company} 提供 ${input.role} 的机会。我对岗位和团队很有兴趣。`,
        offered ? `我理解当前年度总包约为 ${offered}。` : "我希望先确认年度总包构成。",
        `我希望讨论${target ? `将年度总包调整到 ${target}` : "年度总包的调整空间"}。`,
        "我的依据仅包括以下已经提供、可以在面试中验证的事实：",
        evidenceLine,
        "请问团队是否可以在基础薪资、签约奖金、年度奖金或股权之间调整组合？",
      ].join("\n\n")
    : [
        `Thank you for the opportunity to join ${input.company} as ${input.role}. I am excited about the role and team.`,
        offered ? `My understanding is that the annual total package is ${offered}.` : "I would like to confirm the annual package components.",
        `I would like to discuss ${target ? `an annual total package of ${target}` : "the available flexibility in the annual package"}.`,
        "My request is based only on these supplied, verifiable facts:",
        evidenceLine,
        "Could we adjust the mix across base salary, sign-on bonus, annual bonus, or equity?",
      ].join("\n\n");

  return {
    script,
    factsUsed: {
      company: input.company,
      role: input.role,
      offeredTotal: input.offeredTotal ?? null,
      targetTotal: input.targetTotal ?? null,
      strengths,
    },
    inventedFacts: [],
  };
}
