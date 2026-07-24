type ResumeOutput = {
  readonly cvSummary: string;
  readonly latestExperience: {
    readonly addedBullets: readonly string[];
  };
};

type CoverOutput = {
  readonly cover: {
    readonly paragraphOne: string;
    readonly paragraphTwo: string;
    readonly paragraphThree: string;
  };
};

const EN_AU_RESUME: ResumeOutput = {
  cvSummary:
    "Platform-focused software engineer with 6+ years delivering **cloud-native** services across **AWS** and **GCP**. Led **CI/CD pipeline** modernisation and **Kubernetes** migration for a 200-service platform, improving deployment frequency by 40%. Experienced in **infrastructure-as-code**, **observability**, and cross-functional product delivery.",
  latestExperience: {
    addedBullets: [
      "Architected an event-driven data pipeline using **Kafka** and **AWS Lambda** to process more than 2M events daily",
      "Mentored three engineers on **infrastructure-as-code** practices and platform engineering principles",
      "Improved **incident response** processes and runbooks, reducing MTTR from 45 to 18 minutes",
    ],
  },
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
    "专注平台工程的高级软件工程师，拥有 6 年以上**云原生**服务交付经验，覆盖 **AWS** 与 **GCP**。主导 **CI/CD 流水线**现代化和 **Kubernetes** 迁移，为 200+ 微服务平台提升部署频率 40%。擅长**基础设施即代码**、**可观测性**与跨职能协作。",
  latestExperience: {
    addedBullets: [
      "基于 **Kafka** 与 **AWS Lambda** 构建事件驱动数据管道，日处理 200 万以上事件",
      "指导三名工程师落实**基础设施即代码**实践与平台工程规范",
      "优化**事故响应**流程与运行手册，将 MTTR 从 45 分钟缩短至 18 分钟",
    ],
  },
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
- Bolds a small set of JD-critical keywords with clean Markdown markers.
- Does not return skills; the Master Resume Profile owns the skills section.

## latestExperience.addedBullets
- Contains additions only, never a copy of the existing experience bullets.
- Contains zero to three strings; this example uses three grounded additions.
- Each addition maps to an under-covered JD responsibility and preserves the
  candidate's existing tone.
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
- 使用语法正确的 Markdown 标记突出少量 JD 关键字。
- 不返回技能字段；技能始终由主简历档案维护。

## latestExperience.addedBullets
- 只包含新增内容，不复制现有经历要点。
- 数量为 0 至 3 条；本示例包含 3 条有证据支持的新增要点。
- 每条新增要点优先覆盖尚未充分体现的 JD 职责，并保持原有语气。
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
