type ResumeOutput = {
  readonly cvSummary: string;
  readonly skillsSelection: readonly {
    readonly group: number;
    readonly items: readonly number[];
  }[];
};

type CoverOutput = {
  readonly cover: {
    readonly paragraphOne: string;
    readonly paragraphTwo: string;
    readonly paragraphThree: string;
  };
};

/**
 * The indexes below are illustrative. A real selection references the groups
 * and items of the pack owner's own `context/resume-snapshot.json`, which is
 * why the walkthroughs tell the reader to read their bank rather than copy
 * these numbers.
 */
const EN_AU_RESUME: ResumeOutput = {
  cvSummary:
    "Platform engineer with 6+ years delivering **cloud-native** services across **AWS** and **GCP**. Led **CI/CD** modernisation and a **Kubernetes** migration for a 200-service platform, lifting deployment frequency 40%.",
  skillsSelection: [
    { group: 0, items: [2, 0, 4] },
    { group: 1, items: [1, 3] },
  ],
};

const EN_AU_COVER: CoverOutput = {
  cover: {
    paragraphOne:
      "My recent work building and operating **cloud-native platforms** at scale maps directly to your Platform Engineer role. Over the past three years I have led **Kubernetes** migrations, built **CI/CD** pipelines, and established **observability** standards across a 200-service estate.",
    paragraphTwo:
      "Your priorities in **infrastructure automation**, **developer experience**, and **reliability engineering** are areas where I have delivered measurable outcomes. I designed **Terraform** modules for zero-downtime multi-region deployments, migrated legacy builds to **GitHub Actions** to reduce pipeline time from 45 to 12 minutes, and implemented **Datadog** SLO monitoring that helped reduce MTTR from 45 to 18 minutes.",
    paragraphThree:
      "Acme Cloud's focus on internal platforms that treat developer productivity as a product matches how I approach platform work. I would welcome the opportunity to apply my migration and reliability experience to your infrastructure modernisation priorities.",
  },
};

const ZH_CN_RESUME: ResumeOutput = {
  cvSummary:
    "专注平台工程的软件工程师，拥有 6 年以上**云原生**服务交付经验，覆盖 **AWS** 与 **GCP**。主导 **CI/CD 流水线**现代化与 **Kubernetes** 迁移，为 200+ 微服务平台提升部署频率 40%，并建立跨团队的**可观测性**规范。",
  skillsSelection: [
    { group: 0, items: [2, 0, 4] },
    { group: 1, items: [1, 3] },
  ],
};

const ZH_CN_COVER: CoverOutput = {
  cover: {
    paragraphOne:
      "我近期负责大规模**云原生平台**的建设与运行，这与贵公司的平台工程师岗位高度契合。过去三年，我主导了 **Kubernetes** 迁移、**CI/CD** 流水线建设，并为 200+ 服务建立了**可观测性**标准。",
    paragraphTwo:
      "贵公司重视的**基础设施自动化**、**开发者体验**和**可靠性工程**，都是我交付过可量化成果的领域。我设计的 **Terraform** 模块支持多区域零停机部署；将遗留构建迁移到 **GitHub Actions** 后，流水线耗时从 45 分钟降至 12 分钟；通过 **Datadog** SLO 监控与运行手册优化，将 MTTR 从 45 分钟降至 18 分钟。",
    paragraphThree:
      "贵公司将开发者生产力视为产品来建设内部平台，这与我的工作方式一致。我期待把平台迁移和可靠性经验用于贵公司的基础设施现代化目标，并进一步交流具体落地方案。",
  },
};

const EN_AU_RESUME_WALKTHROUGH = `# Resume Output Walkthrough

## cvSummary
- Repositions the candidate for the role using only supplied evidence.
- Runs 120-350 characters, and contains the posting's role title with its
  seniority word and trailing qualifiers dropped.
- States no number and names no technology that is missing from the resume
  snapshot; Joblit rejects the import when either appears.
- Bolds a small set of JD-critical keywords with clean Markdown markers.

## skillsSelection
- References the candidate's own skills by index and never by name: \`group\`
  indexes the snapshot's \`skills\` array, and each entry of \`items\` indexes
  that group's \`items\` array.
- Read the numbering out of \`context/resume-snapshot.json\`. The indexes in
  the example are illustrative and will not match another profile.
- Drops the groups and items the posting does not reward. A tailored skills
  section is shorter than the master one, never longer.
- Array order is render order: most relevant first, in both dimensions.
- Selects each group at most once, and each index at most once per group.
`;

const EN_AU_COVER_WALKTHROUGH = `# Cover Output Walkthrough

## paragraphOne
- Opens with role fit grounded in recent experience.

## paragraphTwo
- Maps evidence to the highest-priority responsibilities and includes only
  metrics already present in the resume snapshot.

## paragraphThree
- Connects motivation to a specific company priority and states a concrete
  forward contribution.

The cover object contains only these three paragraph fields.
`;

const ZH_CN_RESUME_WALKTHROUGH = `# 简历输出说明

## cvSummary
- 仅根据提供的证据调整候选人的岗位定位。
- 长度为 120 至 350 个字符，并且必须包含岗位标题（去掉资历词与后缀限定语）。
- 不得出现简历快照中没有的数字或技术名称，否则导入会被拒绝。
- 使用语法正确的 Markdown 标记突出少量 JD 关键字。

## skillsSelection
- 只用序号引用候选人已有的技能，绝不写出技能名称：\`group\` 对应快照 \`skills\`
  数组的下标，\`items\` 中的每个数字对应该分组 \`items\` 数组的下标。
- 序号请从 \`context/resume-snapshot.json\` 中读取；示例中的数字仅作说明，
  换一份档案就不再成立。
- 删除与该岗位无关的分组和条目：定制后的技能区只会更短，不会更长。
- 数组顺序即渲染顺序，分组之间与分组内部都按相关度由高到低排列。
- 每个分组最多出现一次，分组内每个序号最多出现一次。
`;

const ZH_CN_COVER_WALKTHROUGH = `# 求职信输出说明

## paragraphOne
- 以近期真实经历直接说明岗位匹配度。

## paragraphTwo
- 按优先级映射岗位职责，只使用简历快照中已有的量化证据。

## paragraphThree
- 将求职动机连接到具体公司方向，并说明可贡献的能力。

cover 对象只包含以上三个段落字段。
`;

export function buildRealisticResumeExample(
  locale: "en-AU" | "zh-CN" = "en-AU",
): string {
  return JSON.stringify(
    locale === "zh-CN" ? ZH_CN_RESUME : EN_AU_RESUME,
    null,
    2,
  );
}

export function buildAnnotatedResumeWalkthrough(
  locale: "en-AU" | "zh-CN" = "en-AU",
): string {
  return locale === "zh-CN"
    ? ZH_CN_RESUME_WALKTHROUGH
    : EN_AU_RESUME_WALKTHROUGH;
}

export function buildRealisticCoverExample(
  locale: "en-AU" | "zh-CN" = "en-AU",
): string {
  return JSON.stringify(
    locale === "zh-CN" ? ZH_CN_COVER : EN_AU_COVER,
    null,
    2,
  );
}

export function buildAnnotatedCoverWalkthrough(
  locale: "en-AU" | "zh-CN" = "en-AU",
): string {
  return locale === "zh-CN"
    ? ZH_CN_COVER_WALKTHROUGH
    : EN_AU_COVER_WALKTHROUGH;
}
