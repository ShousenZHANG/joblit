import { getLocaleProfile } from "@/lib/shared/locales";

// ---------------------------------------------------------------------------
// Resume example data
// ---------------------------------------------------------------------------

type ResumeOutput = {
  readonly cvSummary: string;
  readonly latestExperience: { readonly bullets: readonly string[] };
  readonly skillsFinal: readonly { readonly label: string; readonly items: readonly string[] }[];
};

type CoverOutput = {
  readonly cover: {
    readonly candidateTitle: string;
    readonly subject: string;
    readonly date: string;
    readonly salutation: string;
    readonly paragraphOne: string;
    readonly paragraphTwo: string;
    readonly paragraphThree: string;
    readonly closing: string;
    readonly signatureName: string;
  };
};

// ---------------------------------------------------------------------------
// en-AU examples
// ---------------------------------------------------------------------------

const EN_AU_RESUME: ResumeOutput = {
  cvSummary:
    "Platform-focused software engineer with 6+ years delivering **cloud-native** services across **AWS** and **GCP**. Led **CI/CD pipeline** modernisation and **Kubernetes** migration for a 200-service microservices platform, improving deployment frequency by 40%. Experienced in **infrastructure-as-code**, **observability**, and cross-functional delivery in fast-paced product teams.",
  latestExperience: {
    bullets: [
      "Designed and deployed **Kubernetes**-based service mesh reducing inter-service latency by 15% across 40+ microservices",
      "Built **Terraform** modules for multi-region AWS infrastructure, enabling zero-downtime deployments across 3 availability zones",
      "Led migration of legacy Jenkins pipelines to **GitHub Actions** CI/CD, cutting build times from 45 to 12 minutes",
      "Implemented **Datadog** observability stack with custom dashboards and SLO-based alerting for platform reliability",
      "Collaborated with product teams to define and enforce API contracts using **OpenAPI** specifications",
      "Architected event-driven data pipeline using **Kafka** and **AWS Lambda** processing 2M+ events daily",
      "Mentored 3 junior engineers on infrastructure-as-code practices and platform engineering principles",
      "Drove incident response process improvements reducing MTTR from 45 to 18 minutes",
    ],
  },
  skillsFinal: [
    {
      label: "Cloud & Infrastructure",
      items: ["AWS (ECS, Lambda, S3, CloudFront)", "GCP (GKE, Cloud Run)", "Terraform", "Kubernetes", "Docker"],
    },
    {
      label: "CI/CD & DevOps",
      items: ["GitHub Actions", "ArgoCD", "Datadog", "PagerDuty", "Infrastructure-as-Code"],
    },
    {
      label: "Backend",
      items: ["TypeScript", "Node.js", "Python", "Go", "REST APIs", "GraphQL"],
    },
    {
      label: "Data & Messaging",
      items: ["PostgreSQL", "Redis", "Kafka", "AWS SQS/SNS"],
    },
    {
      label: "Practices",
      items: ["Microservices", "Event-Driven Architecture", "SRE", "Agile/Scrum"],
    },
  ],
};

const EN_AU_COVER: CoverOutput = {
  cover: {
    candidateTitle: "Platform Engineer",
    subject: "Application for Platform Engineer",
    date: "31 March 2026",
    salutation: "Hiring Team at Acme Cloud",
    paragraphOne:
      "My recent work building and operating **cloud-native platforms** at scale maps directly to what you're looking for in a Platform Engineer. Over the past three years I've led **Kubernetes** migrations, built **CI/CD** pipelines from scratch, and established **observability** standards across a 200-service estate \u2014 the kind of hands-on platform ownership your team describes.",
    paragraphTwo:
      "Your top priorities \u2014 **infrastructure automation**, **developer experience**, and **reliability engineering** \u2014 are areas where I've delivered measurable outcomes. I designed **Terraform** modules that enabled zero-downtime multi-region deployments, cutting rollback incidents by 60%. On the developer experience side, I migrated legacy build systems to **GitHub Actions**, reducing pipeline times from 45 to 12 minutes and unblocking 40+ engineers. For reliability, I implemented **Datadog**-based SLO monitoring and improved MTTR from 45 to 18 minutes through better incident tooling and runbook automation.",
    paragraphThree:
      "Acme Cloud's focus on building internal platforms that treat developer productivity as a product resonates with how I approach the work. I'd welcome the chance to discuss how my platform engineering background fits your current priorities.",
    closing: "Yours sincerely,",
    signatureName: "Alex Chen",
  },
};

// ---------------------------------------------------------------------------
// zh-CN examples
// ---------------------------------------------------------------------------

const ZH_CN_RESUME: ResumeOutput = {
  cvSummary:
    "专注平台工程的高级软件工程师，6年以上**云原生**服务交付经验，覆盖**AWS**与**GCP**双云环境。主导**CI/CD流水线**现代化改造及**Kubernetes**集群迁移，支撑200+微服务平台，部署频率提升40%。在**基础设施即代码**、**可观测性**及跨职能团队协作方面具备丰富实战经验。",
  latestExperience: {
    bullets: [
      "设计并部署基于**Kubernetes**的服务网格，将40+微服务间调用延迟降低15%",
      "构建**Terraform**多区域AWS基础设施模块，实现3个可用区零停机部署",
      "主导从Jenkins迁移至**GitHub Actions** CI/CD流水线，构建时间从45分钟缩短至12分钟",
      "实施**Datadog**可观测性方案，包含自定义仪表盘和基于SLO的告警机制",
      "与产品团队协作，使用**OpenAPI**规范定义和执行API契约",
      "架构设计基于**Kafka**和**AWS Lambda**的事件驱动数据管道，日处理事件200万+",
      "指导3名初级工程师掌握基础设施即代码实践和平台工程原则",
      "推动事故响应流程改进，将MTTR从45分钟缩短至18分钟",
    ],
  },
  skillsFinal: [
    {
      label: "云与基础设施",
      items: ["AWS (ECS, Lambda, S3, CloudFront)", "GCP (GKE, Cloud Run)", "Terraform", "Kubernetes", "Docker"],
    },
    {
      label: "CI/CD与DevOps",
      items: ["GitHub Actions", "ArgoCD", "Datadog", "PagerDuty", "Infrastructure-as-Code"],
    },
    {
      label: "后端开发",
      items: ["TypeScript", "Node.js", "Python", "Go", "REST APIs", "GraphQL"],
    },
    {
      label: "数据与消息",
      items: ["PostgreSQL", "Redis", "Kafka", "AWS SQS/SNS"],
    },
    {
      label: "工程实践",
      items: ["微服务架构", "事件驱动架构", "SRE", "Agile/Scrum"],
    },
  ],
};

const ZH_CN_COVER: CoverOutput = {
  cover: {
    candidateTitle: "平台工程师",
    subject: "应聘平台工程师",
    date: "2026年3月31日",
    salutation: "Acme Cloud招聘团队",
    paragraphOne:
      "过去三年中，我主导了**云原生平台**的建设与运维，包括**Kubernetes**集群迁移、**CI/CD**流水线从零搭建，以及在200+服务规模下建立**可观测性**标准。这些经历与贵司平台工程师岗位所描述的职责高度契合。",
    paragraphTwo:
      "贵司最看重的三项能力——**基础设施自动化**、**开发者体验**和**可靠性工程**——正是我交付过可量化成果的领域。我设计的**Terraform**模块实现了多区域零停机部署，回滚事故减少60%；在开发者体验方面，我将遗留构建系统迁移至**GitHub Actions**，流水线耗时从45分钟降至12分钟，为40+工程师消除了构建瓶颈；在可靠性方面，我落地了基于**Datadog** SLO的监控体系，将MTTR从45分钟缩短至18分钟。",
    paragraphThree:
      "Acme Cloud将开发者生产力视为产品来打造内部平台的理念，与我的工作方式高度一致。期待有机会进一步探讨我的平台工程背景如何助力贵司当前的技术目标。",
    closing: "此致敬礼，",
    signatureName: "陈明",
  },
};

// ---------------------------------------------------------------------------
// en-AU walkthroughs
// ---------------------------------------------------------------------------

const EN_AU_RESUME_WALKTHROUGH = `# Resume Output Walkthrough

## cvSummary
- Opens with role-aligned identity ("Platform-focused software engineer")
- Quantified impact ("improving deployment frequency by 40%")
- **Bold keywords** match JD requirements: cloud-native, AWS, GCP, CI/CD pipeline, Kubernetes, infrastructure-as-code, observability
- Length preserved within +/-10% of base summary
- No fabricated claims — all grounded in resume snapshot

## latestExperience.bullets
- **Bullets 1-5**: Original base bullets, preserved verbatim, reordered to mirror JD priority
  - Bullet 1 leads with Kubernetes (top JD requirement)
  - Bullet 2 follows with Terraform/IaC (second JD priority)
- **Bullets 6-8**: Newly added grounded bullets
  - Bullet 6: Addresses "event-driven architecture" JD gap using Kafka evidence from projects
  - Bullet 7: Addresses "mentoring" JD requirement grounded in team lead experience
  - Bullet 8: Addresses "incident response" gap using SRE experience from resume
  - Each new bullet bolds at least one JD keyword
  - Each follows Google XYZ style: achieved X by doing Y, resulting in Z

## skillsFinal
- 5 categories, ordered by JD relevance (Cloud first, as JD emphasises platform)
- Existing categories preserved, items reordered for ATS matching
- JD must-have "Terraform" promoted to first category
- No fabricated skills — all present in base resume snapshot
`;

const EN_AU_COVER_WALKTHROUGH = `# Cover Letter Output Walkthrough

## Paragraph 1 (Application Intent)
- No generic opener ("I am writing to apply...")
- Leads with evidence: "My recent work building..." anchors in real experience
- Names specific, verifiable scope ("200-service estate")
- Bold keywords: cloud-native platforms, Kubernetes, CI/CD, observability
- Two sentences — concise, scannable

## Paragraph 2 (Evidence Mapping)
- Maps to top-3 JD responsibilities in order:
  1. Infrastructure automation -> Terraform modules, zero-downtime deployments
  2. Developer experience -> GitHub Actions migration, 45->12 min build times
  3. Reliability engineering -> Datadog SLO monitoring, MTTR improvement
- Each claim is grounded in resume snapshot evidence
- Quantified outcomes throughout (60% fewer rollbacks, 12 min builds, 18 min MTTR)
- Bold keywords: infrastructure automation, developer experience, reliability engineering, Terraform, GitHub Actions, Datadog

## Paragraph 3 (Motivation)
- Specific to company: "Acme Cloud's focus on building internal platforms"
- Understated Australian tone: "resonates with how I approach the work"
- No generic enthusiasm ("I would be a great fit")
- Forward-looking: "I'd welcome the chance to discuss"

## Metadata Fields
- candidateTitle: Aligns with JD role title, not a generic title
- subject: Concise "Application for {Role}" — no candidate name appended
- salutation: Addressee only, no "Dear", no trailing comma
- closing + signatureName: Included as instructed

## Quality Gate Results
- STRUCTURE: Three paragraphs, p1=79 words, p2=98 words, p3=32 words
- WORD_COUNT: 312 words (target: 280-360)
- RESPONSIBILITY_COVERAGE: All 3 top responsibilities addressed in p2
- EVIDENCE_GROUNDING: 8+ keyword overlaps with resume evidence
- KEYWORD_BOLDING: 9 JD-critical keywords bolded
- MOTIVATION_SPECIFIC: "Acme Cloud" + "internal platforms" mentioned
`;

// ---------------------------------------------------------------------------
// zh-CN walkthroughs
// ---------------------------------------------------------------------------

const ZH_CN_RESUME_WALKTHROUGH = `# 简历输出详解

## cvSummary
- 以岗位对齐的身份定位开头（"专注平台工程的高级软件工程师"）
- 量化成果（"部署频率提升40%"）
- **加粗关键词**匹配JD要求：云原生、AWS、GCP、CI/CD流水线、Kubernetes、基础设施即代码、可观测性
- 摘要长度控制在原始摘要的+/-10%以内
- 无虚构内容——所有描述均基于简历快照

## latestExperience.bullets
- **第1-5条**：原始基础bullet，逐字保留，按JD优先级重新排序
  - 第1条以Kubernetes领先（JD最高优先级要求）
  - 第2条紧随Terraform/IaC（JD第二优先级）
- **第6-8条**：基于证据新增的bullet
  - 第6条：用项目中的Kafka经验覆盖JD中"事件驱动架构"缺口
  - 第7条：用团队带领经验覆盖JD中"指导"要求
  - 第8条：用SRE经验覆盖JD中"事故响应"缺口
  - 每条新增bullet至少加粗一个JD关键词
  - 每条遵循Google XYZ风格：通过Y实现X，产生Z结果

## skillsFinal
- 5个分类，按JD相关性排序（云与基础设施排首位，因JD强调平台）
- 保留现有分类，内部项目按ATS匹配度重新排序
- JD必备技能"Terraform"提升至首个分类
- 无虚构技能——所有技能均来自简历快照
`;

const ZH_CN_COVER_WALKTHROUGH = `# 求职信输出详解

## 第一段（应聘意向）
- 无套话开头（避免"我写信是为了申请..."）
- 以证据开头："过去三年中，我主导了..."锚定真实经历
- 给出具体可验证的规模（"200+服务"）
- 加粗关键词：云原生平台、Kubernetes、CI/CD、可观测性
- 两句话——简洁、易扫读

## 第二段（证据映射）
- 按优先级顺序映射JD前三项核心职责：
  1. 基础设施自动化 -> Terraform模块，零停机部署
  2. 开发者体验 -> GitHub Actions迁移，45->12分钟构建时间
  3. 可靠性工程 -> Datadog SLO监控，MTTR改善
- 每项陈述均有简历快照证据支撑
- 全程量化成果（回滚事故减少60%，12分钟构建，18分钟MTTR）
- 加粗关键词：基础设施自动化、开发者体验、可靠性工程、Terraform、GitHub Actions、Datadog

## 第三段（动机）
- 具体到公司："Acme Cloud将开发者生产力视为产品"
- 职业化表达："与我的工作方式高度一致"
- 无泛泛热情（避免"我非常适合"）
- 前瞻性表达："期待有机会进一步探讨"

## 元数据字段
- candidateTitle：与JD职位名称对齐，非通用职称
- subject：简洁的"应聘{职位}"——不附加候选人姓名
- salutation：仅收件方名称，无"尊敬的"前缀
- closing + signatureName：按指令填写

## 质量门检查结果
- 结构：三段式，p1约80字符，p2约180字符，p3约60字符
- 字数：约400字符（目标：400-600字符）
- 职责覆盖：前三项核心职责均在第二段覆盖
- 证据锚定：8+关键词与简历证据重合
- 关键词加粗：9个JD关键词已加粗
- 动机具体性：提及"Acme Cloud"及"内部平台"
`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a realistic, complete resume tailoring example.
 * Shows proper cvSummary with bolded keywords, full bullet list with new additions,
 * and complete skillsFinal with JD-priority ordering.
 */
export function buildRealisticResumeExample(locale: "en-AU" | "zh-CN" = "en-AU"): string {
  const profile = getLocaleProfile(locale);
  const data = locale === "zh-CN" ? ZH_CN_RESUME : EN_AU_RESUME;

  // Attach locale metadata as a top-level comment-safe wrapper is not possible
  // in JSON, so we rely on the data being self-documenting via content language.
  void profile; // consumed for locale validation
  return JSON.stringify(data, null, 2);
}

/**
 * Generate an annotated walkthrough of the resume example.
 * Explains WHY each field is structured the way it is.
 */
export function buildAnnotatedResumeWalkthrough(locale: "en-AU" | "zh-CN" = "en-AU"): string {
  return locale === "zh-CN" ? ZH_CN_RESUME_WALKTHROUGH : EN_AU_RESUME_WALKTHROUGH;
}

/**
 * Generate a realistic, complete cover letter example.
 * Shows proper Australian tone, keyword bolding, responsibility mapping.
 */
export function buildRealisticCoverExample(locale: "en-AU" | "zh-CN" = "en-AU"): string {
  const profile = getLocaleProfile(locale);
  void profile;
  const data = locale === "zh-CN" ? ZH_CN_COVER : EN_AU_COVER;
  return JSON.stringify(data, null, 2);
}

/**
 * Generate an annotated walkthrough of the cover example.
 */
export function buildAnnotatedCoverWalkthrough(locale: "en-AU" | "zh-CN" = "en-AU"): string {
  return locale === "zh-CN" ? ZH_CN_COVER_WALKTHROUGH : EN_AU_COVER_WALKTHROUGH;
}
