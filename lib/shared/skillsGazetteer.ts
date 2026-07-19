// Curated gazetteer of common technical skills. Used by both the JD scanner
// and the resume-profile scanner so that "React.js" in a JD matches a user
// who wrote "ReactJS" in their skills list.
//
// Design notes:
//   - English-only by deliberate choice. CN job postings in tech use English
//     skill names (React, Spring, Kubernetes, etc.) ~universally.
//   - Aliases are matched with word boundaries (\b) so that "react" doesn't
//     match "react-native" (we list react-native as its own aliases entry
//     when we care about it).
//   - `name` is the canonical label returned to the UI (matchedSkills).
//   - Coverage target: top ~250 skills that appear in >1% of SWE postings.
//     Incomplete by design — gracefully degrades (just under-counts).

export interface GazetteerEntry {
  name: string;
  aliases: string[];
}

export const SKILLS_GAZETTEER: GazetteerEntry[] = [
  // ── Programming languages ─────────────────────────────
  { name: "JavaScript", aliases: ["javascript", "js"] },
  { name: "TypeScript", aliases: ["typescript", "ts"] },
  { name: "Python", aliases: ["python", "python3", "py"] },
  { name: "Java", aliases: ["java"] },
  { name: "Kotlin", aliases: ["kotlin"] },
  { name: "Scala", aliases: ["scala"] },
  // Bare "go" is resolved contextually below; global matching is too noisy.
  { name: "Go", aliases: ["golang", "go-lang"] },
  { name: "Rust", aliases: ["rust", "rust-lang"] },
  { name: "C++", aliases: ["c\\+\\+", "cpp"] },
  { name: "C#", aliases: ["c#", "csharp", "c-sharp"] },
  { name: "C", aliases: [] }, // fall through intentionally — too noisy to match
  { name: "Ruby", aliases: ["ruby"] },
  { name: "PHP", aliases: ["php"] },
  { name: "Swift", aliases: ["swift"] },
  { name: "Objective-C", aliases: ["objective-c", "objc"] },
  { name: "Dart", aliases: ["dart"] },
  { name: "Elixir", aliases: ["elixir"] },
  { name: "Erlang", aliases: ["erlang"] },
  { name: "Haskell", aliases: ["haskell"] },
  { name: "Clojure", aliases: ["clojure"] },
  { name: "Lua", aliases: ["lua"] },
  { name: "R", aliases: [] }, // skip — too noisy
  { name: "Perl", aliases: ["perl"] },
  { name: "Shell", aliases: ["shell", "bash", "zsh", "shell scripting"] },
  { name: "PowerShell", aliases: ["powershell"] },
  { name: "Groovy", aliases: ["groovy"] },
  { name: "Solidity", aliases: ["solidity"] },

  // ── Frontend frameworks & libs ────────────────────────
  { name: "React", aliases: ["react", "react\\.js", "reactjs"] },
  { name: "React Native", aliases: ["react native", "react-native"] },
  { name: "Next.js", aliases: ["next\\.js", "nextjs", "next js"] },
  { name: "Vue", aliases: ["vue", "vue\\.js", "vuejs"] },
  { name: "Nuxt", aliases: ["nuxt", "nuxt\\.js", "nuxtjs"] },
  { name: "Angular", aliases: ["angular", "angularjs"] },
  { name: "Svelte", aliases: ["svelte", "sveltekit"] },
  { name: "Solid.js", aliases: ["solid\\.js", "solidjs"] },
  { name: "Ember", aliases: ["ember", "ember\\.js"] },
  { name: "jQuery", aliases: ["jquery"] },
  { name: "Redux", aliases: ["redux"] },
  { name: "MobX", aliases: ["mobx"] },
  { name: "Zustand", aliases: ["zustand"] },
  { name: "React Query", aliases: ["react query", "react-query", "tanstack query"] },
  { name: "SWR", aliases: ["swr"] },
  { name: "Tailwind CSS", aliases: ["tailwind", "tailwind css", "tailwindcss"] },
  { name: "CSS", aliases: ["css", "css3"] },
  { name: "SCSS", aliases: ["scss", "sass"] },
  { name: "HTML", aliases: ["html", "html5"] },
  { name: "Webpack", aliases: ["webpack"] },
  { name: "Vite", aliases: ["vite"] },
  { name: "Rollup", aliases: ["rollup"] },
  { name: "esbuild", aliases: ["esbuild"] },
  { name: "Storybook", aliases: ["storybook"] },
  { name: "Material UI", aliases: ["material ui", "material-ui", "mui"] },
  { name: "shadcn/ui", aliases: ["shadcn", "shadcn/ui", "shadcn-ui"] },
  { name: "Chakra UI", aliases: ["chakra", "chakra ui", "chakra-ui"] },
  { name: "Ant Design", aliases: ["ant design", "antd"] },
  { name: "Bootstrap", aliases: ["bootstrap"] },

  // ── Backend frameworks ────────────────────────────────
  { name: "Node.js", aliases: ["node\\.js", "nodejs", "node js"] },
  { name: "Express", aliases: ["express", "express\\.js", "expressjs"] },
  { name: "NestJS", aliases: ["nestjs", "nest\\.js"] },
  { name: "Fastify", aliases: ["fastify"] },
  { name: "Koa", aliases: ["koa", "koa\\.js"] },
  { name: "Deno", aliases: ["deno"] },
  { name: "Bun", aliases: ["bun"] },
  // Bare "spring" is resolved contextually below; global matching is too noisy.
  { name: "Spring", aliases: ["spring framework"] },
  { name: "Spring Boot", aliases: ["spring boot", "springboot"] },
  { name: "Spring Cloud", aliases: ["spring cloud"] },
  { name: "Hibernate", aliases: ["hibernate"] },
  { name: "JPA", aliases: ["jpa"] },
  { name: "MyBatis", aliases: ["mybatis", "mybatis-plus", "mybatis plus"] },
  { name: "Django", aliases: ["django"] },
  { name: "Flask", aliases: ["flask"] },
  { name: "FastAPI", aliases: ["fastapi", "fast api"] },
  { name: "Rails", aliases: ["rails", "ruby on rails"] },
  { name: "Laravel", aliases: ["laravel"] },
  { name: "Symfony", aliases: ["symfony"] },
  { name: "ASP.NET", aliases: ["asp\\.net", "aspnet", "\\.net core", "dotnet"] },
  { name: ".NET", aliases: ["\\.net"] },
  { name: "Gin", aliases: ["gin", "gin-gonic"] },
  { name: "Echo", aliases: ["echo framework"] },
  { name: "Actix", aliases: ["actix", "actix-web"] },
  { name: "Phoenix", aliases: ["phoenix framework"] },
  { name: "Ktor", aliases: ["ktor"] },

  // ── Databases ─────────────────────────────────────────
  { name: "PostgreSQL", aliases: ["postgres", "postgresql", "psql"] },
  { name: "MySQL", aliases: ["mysql"] },
  { name: "MariaDB", aliases: ["mariadb"] },
  { name: "SQLite", aliases: ["sqlite"] },
  { name: "SQL Server", aliases: ["sql server", "mssql", "microsoft sql server"] },
  { name: "Oracle", aliases: ["oracle database", "oracle db"] },
  { name: "MongoDB", aliases: ["mongodb", "mongo"] },
  { name: "Redis", aliases: ["redis"] },
  { name: "Memcached", aliases: ["memcached"] },
  { name: "Cassandra", aliases: ["cassandra"] },
  { name: "DynamoDB", aliases: ["dynamodb", "dynamo db"] },
  { name: "Elasticsearch", aliases: ["elasticsearch", "elastic search"] },
  { name: "OpenSearch", aliases: ["opensearch", "open search"] },
  { name: "Neo4j", aliases: ["neo4j"] },
  { name: "CouchDB", aliases: ["couchdb"] },
  { name: "Firestore", aliases: ["firestore"] },
  { name: "Supabase", aliases: ["supabase"] },
  { name: "CockroachDB", aliases: ["cockroachdb", "cockroach db"] },
  { name: "ClickHouse", aliases: ["clickhouse"] },
  { name: "Snowflake", aliases: ["snowflake"] },
  { name: "BigQuery", aliases: ["bigquery", "big query"] },
  { name: "Redshift", aliases: ["redshift"] },
  { name: "Databricks", aliases: ["databricks"] },
  { name: "Prisma", aliases: ["prisma", "prisma orm"] },
  { name: "TypeORM", aliases: ["typeorm"] },
  { name: "Sequelize", aliases: ["sequelize"] },
  { name: "Drizzle", aliases: ["drizzle", "drizzle orm"] },
  { name: "GraphQL", aliases: ["graphql"] },
  { name: "Apollo", aliases: ["apollo", "apollo server", "apollo client"] },
  { name: "Hasura", aliases: ["hasura"] },

  // ── Cloud / infra ─────────────────────────────────────
  { name: "AWS", aliases: ["aws", "amazon web services"] },
  { name: "Amazon EC2", aliases: ["amazon ec2", "aws ec2", "ec2"] },
  { name: "Amazon ECS", aliases: ["amazon ecs", "aws ecs", "ecs"] },
  { name: "Amazon EKS", aliases: ["amazon eks", "aws eks", "eks"] },
  { name: "Amazon RDS", aliases: ["amazon rds", "aws rds", "rds"] },
  { name: "Amazon S3", aliases: ["amazon s3", "aws s3", "s3"] },
  { name: "CloudFormation", aliases: ["cloudformation", "cloud formation"] },
  { name: "GCP", aliases: ["gcp", "google cloud", "google cloud platform"] },
  { name: "Google Kubernetes Engine", aliases: ["google kubernetes engine", "gke"] },
  { name: "Cloud Run", aliases: ["google cloud run", "cloud run"] },
  { name: "Azure", aliases: ["azure", "microsoft azure"] },
  { name: "Azure Kubernetes Service", aliases: ["azure kubernetes service", "aks"] },
  { name: "Azure DevOps", aliases: ["azure devops"] },
  { name: "Azure Functions", aliases: ["azure functions"] },
  { name: "Vercel", aliases: ["vercel"] },
  { name: "Netlify", aliases: ["netlify"] },
  { name: "Cloudflare", aliases: ["cloudflare"] },
  { name: "Heroku", aliases: ["heroku"] },
  { name: "DigitalOcean", aliases: ["digitalocean", "digital ocean"] },
  { name: "Docker", aliases: ["docker"] },
  { name: "Kubernetes", aliases: ["kubernetes", "k8s", "k3s"] },
  { name: "Helm", aliases: ["helm"] },
  { name: "Terraform", aliases: ["terraform"] },
  { name: "Pulumi", aliases: ["pulumi"] },
  { name: "Ansible", aliases: ["ansible"] },
  { name: "Chef", aliases: ["chef configuration management"] },
  { name: "Puppet", aliases: ["puppet"] },
  { name: "Istio", aliases: ["istio"] },
  { name: "Consul", aliases: ["consul"] },
  { name: "Nomad", aliases: ["nomad"] },
  { name: "Packer", aliases: ["packer"] },
  { name: "Vagrant", aliases: ["vagrant"] },
  { name: "Nginx", aliases: ["nginx"] },
  { name: "Apache", aliases: ["apache"] },
  { name: "HAProxy", aliases: ["haproxy"] },
  { name: "CDN", aliases: ["cdn"] },

  // ── DevOps / CI-CD ────────────────────────────────────
  { name: "Git", aliases: ["git"] },
  { name: "GitHub", aliases: ["github"] },
  { name: "GitLab", aliases: ["gitlab"] },
  { name: "Bitbucket", aliases: ["bitbucket"] },
  { name: "GitHub Actions", aliases: ["github actions"] },
  { name: "GitLab CI", aliases: ["gitlab ci", "gitlab-ci"] },
  { name: "Jenkins", aliases: ["jenkins"] },
  { name: "CircleCI", aliases: ["circleci", "circle ci"] },
  { name: "Travis CI", aliases: ["travis ci", "travis-ci"] },
  { name: "ArgoCD", aliases: ["argocd", "argo cd"] },
  { name: "FluxCD", aliases: ["fluxcd", "flux cd"] },
  { name: "Spinnaker", aliases: ["spinnaker"] },
  { name: "Prometheus", aliases: ["prometheus"] },
  { name: "Grafana", aliases: ["grafana"] },
  { name: "Datadog", aliases: ["datadog"] },
  { name: "New Relic", aliases: ["new relic", "newrelic"] },
  { name: "Splunk", aliases: ["splunk"] },
  { name: "Sentry", aliases: ["sentry"] },
  { name: "PagerDuty", aliases: ["pagerduty"] },
  { name: "OpenTelemetry", aliases: ["opentelemetry", "otel"] },
  { name: "Jaeger", aliases: ["jaeger"] },

  // ── Messaging / streaming ─────────────────────────────
  { name: "Kafka", aliases: ["kafka", "apache kafka"] },
  { name: "RabbitMQ", aliases: ["rabbitmq", "rabbit mq"] },
  { name: "NATS", aliases: ["nats"] },
  { name: "ActiveMQ", aliases: ["activemq"] },
  { name: "ZeroMQ", aliases: ["zeromq", "zmq"] },
  { name: "SQS", aliases: ["sqs"] },
  { name: "SNS", aliases: ["sns"] },
  { name: "Pub/Sub", aliases: ["pub/sub", "pubsub"] },
  { name: "Kinesis", aliases: ["kinesis"] },
  { name: "Airflow", aliases: ["airflow", "apache airflow"] },
  { name: "Dagster", aliases: ["dagster"] },
  { name: "Prefect", aliases: ["prefect"] },
  { name: "Temporal", aliases: ["temporal"] },

  // ── Data / ML / AI ────────────────────────────────────
  { name: "TensorFlow", aliases: ["tensorflow"] },
  { name: "PyTorch", aliases: ["pytorch"] },
  { name: "JAX", aliases: ["jax"] },
  { name: "Keras", aliases: ["keras"] },
  { name: "Scikit-learn", aliases: ["scikit-learn", "sklearn"] },
  { name: "Pandas", aliases: ["pandas"] },
  { name: "NumPy", aliases: ["numpy"] },
  { name: "SciPy", aliases: ["scipy"] },
  { name: "Spark", aliases: ["spark", "apache spark", "pyspark"] },
  { name: "Hadoop", aliases: ["hadoop"] },
  { name: "Flink", aliases: ["flink", "apache flink"] },
  { name: "dbt", aliases: ["dbt"] },
  { name: "LangChain", aliases: ["langchain"] },
  { name: "LlamaIndex", aliases: ["llamaindex", "llama index"] },
  { name: "OpenAI", aliases: ["openai", "open ai"] },
  { name: "Anthropic", aliases: ["anthropic"] },
  { name: "Claude", aliases: ["claude"] },
  { name: "GPT", aliases: ["gpt", "gpt-4", "gpt-3\\.5", "chatgpt"] },
  { name: "LLM", aliases: ["llm", "llms", "large language model"] },
  { name: "RAG", aliases: ["rag", "retrieval augmented generation", "retrieval-augmented"] },
  { name: "MCP", aliases: ["mcp", "model context protocol"] },
  { name: "Embeddings", aliases: ["embeddings", "embedding"] },
  { name: "Pinecone", aliases: ["pinecone"] },
  { name: "Weaviate", aliases: ["weaviate"] },
  { name: "Qdrant", aliases: ["qdrant"] },
  { name: "Chroma", aliases: ["chroma", "chromadb"] },
  { name: "pgvector", aliases: ["pgvector"] },
  { name: "Hugging Face", aliases: ["hugging face", "huggingface"] },
  { name: "Transformers", aliases: ["transformers library"] },
  { name: "MLflow", aliases: ["mlflow"] },
  { name: "Weights & Biases", aliases: ["weights & biases", "wandb"] },
  { name: "Ray", aliases: ["ray"] },
  { name: "Dask", aliases: ["dask"] },
  { name: "OpenCV", aliases: ["opencv"] },

  // ── Testing ───────────────────────────────────────────
  { name: "Jest", aliases: ["jest"] },
  { name: "Vitest", aliases: ["vitest"] },
  { name: "Mocha", aliases: ["mocha"] },
  { name: "Cypress", aliases: ["cypress"] },
  { name: "Playwright", aliases: ["playwright"] },
  { name: "Selenium", aliases: ["selenium"] },
  { name: "Puppeteer", aliases: ["puppeteer"] },
  { name: "pytest", aliases: ["pytest"] },
  { name: "unittest", aliases: ["unittest"] },
  { name: "JUnit", aliases: ["junit"] },
  { name: "TestNG", aliases: ["testng"] },
  { name: "RSpec", aliases: ["rspec"] },
  { name: "Testing Library", aliases: ["testing library", "react testing library"] },
  { name: "TDD", aliases: ["tdd", "test-driven development", "test driven development"] },
  { name: "BDD", aliases: ["bdd", "behavior-driven development"] },

  // ── Mobile ────────────────────────────────────────────
  { name: "iOS", aliases: ["ios"] },
  { name: "Android", aliases: ["android"] },
  { name: "Flutter", aliases: ["flutter"] },
  { name: "Xamarin", aliases: ["xamarin"] },
  { name: "Ionic", aliases: ["ionic"] },
  { name: "Cordova", aliases: ["cordova"] },
  { name: "SwiftUI", aliases: ["swiftui"] },
  { name: "Jetpack Compose", aliases: ["jetpack compose"] },

  // ── Protocols / formats ───────────────────────────────
  { name: "REST", aliases: ["rest", "restful", "rest api"] },
  { name: "gRPC", aliases: ["grpc"] },
  { name: "WebSocket", aliases: ["websocket", "websockets"] },
  { name: "JSON", aliases: ["json"] },
  { name: "XML", aliases: ["xml"] },
  { name: "YAML", aliases: ["yaml", "yml"] },
  { name: "Protobuf", aliases: ["protobuf", "protocol buffers"] },
  { name: "OAuth", aliases: ["oauth", "oauth2", "oauth 2\\.0"] },
  { name: "OpenID Connect", aliases: ["openid connect", "oidc"] },
  { name: "JWT", aliases: ["jwt", "json web token"] },
  { name: "SAML", aliases: ["saml"] },
  { name: "TLS", aliases: ["tls", "ssl"] },
  { name: "HTTP", aliases: ["http", "http/2", "http/3"] },

  // ── Architecture / methodology ────────────────────────
  { name: "Microservices", aliases: ["microservice", "microservices"] },
  { name: "Event-driven", aliases: ["event-driven", "event driven architecture"] },
  { name: "Serverless", aliases: ["serverless"] },
  { name: "Lambda", aliases: ["lambda", "aws lambda"] },
  { name: "CQRS", aliases: ["cqrs"] },
  { name: "Event Sourcing", aliases: ["event sourcing"] },
  { name: "DDD", aliases: ["ddd", "domain-driven design"] },
  { name: "Agile", aliases: ["agile"] },
  { name: "Scrum", aliases: ["scrum"] },
  { name: "Kanban", aliases: ["kanban"] },
  { name: "CI/CD", aliases: ["ci/cd", "cicd", "continuous integration"] },
  { name: "DevOps", aliases: ["devops"] },
  { name: "SRE", aliases: ["sre", "site reliability"] },
  { name: "MLOps", aliases: ["mlops"] },
  { name: "GitOps", aliases: ["gitops"] },
  { name: "Observability", aliases: ["observability"] },
  { name: "Monitoring", aliases: ["monitoring"] },
  { name: "Logging", aliases: ["logging"] },

  // ── Security ──────────────────────────────────────────
  { name: "OWASP", aliases: ["owasp"] },
  { name: "Penetration Testing", aliases: ["penetration testing", "pen testing", "pentest"] },
  { name: "Zero Trust", aliases: ["zero trust"] },
  { name: "IAM", aliases: ["iam"] },
  { name: "RBAC", aliases: ["rbac", "role-based access"] },

  // ── Payments / integrations ──────────────────────────
  { name: "Stripe", aliases: ["stripe"] },
  { name: "PayPal", aliases: ["paypal"] },
  { name: "Twilio", aliases: ["twilio"] },
  { name: "SendGrid", aliases: ["sendgrid"] },
  { name: "Auth0", aliases: ["auth0"] },
  { name: "Okta", aliases: ["okta"] },
  { name: "Clerk", aliases: ["clerk"] },

  // ── Build / package ─────────────────────────────────
  { name: "Maven", aliases: ["maven"] },
  { name: "Gradle", aliases: ["gradle"] },
  { name: "npm", aliases: ["npm"] },
  { name: "yarn", aliases: ["yarn"] },
  { name: "pnpm", aliases: ["pnpm"] },
  { name: "pip", aliases: ["pip"] },
  { name: "Poetry", aliases: ["poetry"] },
  { name: "Cargo", aliases: ["cargo"] },
  { name: "Go Modules", aliases: ["go modules", "go mod"] },
];

/**
 * Build a single regex that matches ANY skill alias with word boundaries,
 * case-insensitive. The result has a single capture group that lets the
 * caller identify which alias fired. Compiled once per module import.
 */
function compileGazetteerRegex(): RegExp {
  const parts: string[] = [];
  for (const entry of SKILLS_GAZETTEER) {
    for (const alias of entry.aliases) {
      parts.push(alias);
    }
  }
  // Sort longest-first so "node.js" matches before "node"
  parts.sort((a, b) => b.length - a.length);
  // Word boundaries fail for punctuation-led or trailing names such as .NET,
  // C# and C++. Capture an optional separator instead.
  return new RegExp(
    `(^|[^A-Za-z0-9_])(${parts.join("|")})(?=$|[^A-Za-z0-9_])`,
    "gi",
  );
}

const GAZETTEER_REGEX = compileGazetteerRegex();

/**
 * Build a reverse index: lowercase alias → canonical skill name. Used to
 * normalize regex hits back to the UI-facing label.
 */
function buildAliasIndex(): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of SKILLS_GAZETTEER) {
    for (const alias of entry.aliases) {
      // Unescape the regex-escape-able parts for the lookup key
      const key = alias.replace(/\\\./g, ".").replace(/\\\+/g, "+").toLowerCase();
      map.set(key, entry.name);
    }
  }
  return map;
}

const ALIAS_INDEX = buildAliasIndex();

export type SkillMention = {
  name: string;
  alias: string;
  index: number;
};

const CONTEXTUAL_SKILL_RULES: ReadonlyArray<{
  name: "Go" | "Spring";
  patterns: readonly RegExp[];
}> = [
  {
    name: "Go",
    patterns: [
      /\b(?:experience|expertise|knowledge|proficiency)\s+(?:in|of|with)\s+(?:the\s+)?(go)\b/gi,
      /\b(?:code|coding|develop(?:ment|ing)?|programming|services?\s+written|written)\s+(?:in|with)\s+(go)\b/gi,
      /\b(go)\b(?=\s+(?:apis?|backend|codebase|developer|development|engineer|engineering|language|microservices?|modules?|programming|sdk|services?|tooling)\b)/gi,
      /\b(?:c#|c\+\+|java|javascript|kotlin|python|rust|scala|terraform|typescript)\s*(?:,|\/|\+|\band\b|\bor\b)\s*(go)\b/gi,
      /\b(Go)\b(?=\s*(?:[,;/)]|$|\band\b|\bor\b))/g,
    ],
  },
  {
    name: "Spring",
    patterns: [
      /\b(?:[Ee]xperience|[Ee]xpertise|[Kk]nowledge|[Pp]roficiency)\s+(?:in|of|with)\s+(?:the\s+)?(Spring)\b(?!\s+(?:boot|cloud|framework)\b)/g,
      /\b(spring)\b(?=\s+(?:apis?|batch|data|developer|development|ecosystem|integration|mvc|security|services?|webflux)\b)/gi,
      /\bjava\s*(?:,|\/|\+|\band\b|\bor\b)\s*(spring)\b(?!\s+(?:boot|cloud|framework)\b)/gi,
      /\b(spring)\b(?!\s+(?:boot|cloud|framework)\b)\s*(?:,|\/|\+|\band\b|\bor\b)\s*java\b/gi,
    ],
  },
];

function extractContextualSkillMentions(text: string): SkillMention[] {
  const mentions: SkillMention[] = [];
  for (const rule of CONTEXTUAL_SKILL_RULES) {
    for (const pattern of rule.patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const alias = match[1];
        if (!alias) continue;
        const relativeIndex = match[0].toLowerCase().lastIndexOf(
          alias.toLowerCase(),
        );
        mentions.push({
          name: rule.name,
          alias,
          index: match.index + Math.max(0, relativeIndex),
        });
      }
    }
  }
  return mentions;
}

const SKILL_IMPLICATIONS: Readonly<Record<string, readonly string[]>> = {
  TypeScript: ["JavaScript"],
  "React Native": ["React"],
  "Next.js": ["React"],
  NestJS: ["Node.js"],
  Express: ["Node.js"],
  "Spring Boot": ["Spring", "Java"],
  Django: ["Python"],
  Flask: ["Python"],
  FastAPI: ["Python"],
  Rails: ["Ruby"],
  Laravel: ["PHP"],
  "ASP.NET": [".NET"],
  "Amazon EKS": ["Kubernetes", "AWS"],
  "Amazon ECS": ["AWS"],
  "Amazon EC2": ["AWS"],
  "Amazon RDS": ["AWS"],
  "Amazon S3": ["AWS"],
  CloudFormation: ["AWS"],
  "Google Kubernetes Engine": ["Kubernetes", "GCP"],
  "Cloud Run": ["GCP"],
  "Azure Kubernetes Service": ["Kubernetes", "Azure"],
  "Azure DevOps": ["Azure"],
  "Azure Functions": ["Azure"],
};

/**
 * Add only one-way, factually safe implications. EKS proves Kubernetes/AWS
 * exposure, while generic Kubernetes does not prove EKS.
 */
export function expandSkillSet(skills: Iterable<string>): Set<string> {
  const expanded = new Set(skills);
  const queue = [...expanded];
  while (queue.length) {
    const skill = queue.shift();
    if (!skill) continue;
    for (const implied of SKILL_IMPLICATIONS[skill] ?? []) {
      if (expanded.has(implied)) continue;
      expanded.add(implied);
      queue.push(implied);
    }
  }
  return expanded;
}

/** Return every canonical skill occurrence with source position and alias. */
export function extractSkillMentions(text: string): SkillMention[] {
  if (!text) return [];
  const mentions: SkillMention[] = extractContextualSkillMentions(text);
  GAZETTEER_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = GAZETTEER_REGEX.exec(text)) !== null) {
    const alias = match[2];
    if (!alias) continue;
    const canonical = ALIAS_INDEX.get(alias.toLowerCase());
    if (!canonical) continue;
    mentions.push({
      name: canonical,
      alias,
      index: match.index + (match[1]?.length ?? 0),
    });
  }
  const unique = new Map<string, SkillMention>();
  for (const mention of mentions) {
    unique.set(`${mention.name}\u0000${mention.index}`, mention);
  }
  return [...unique.values()].sort((a, b) => a.index - b.index);
}

/**
 * Scan arbitrary text for gazetteer skills. Returns a deduplicated set of
 * canonical skill names (UI-friendly).
 */
export function extractSkills(text: string): Set<string> {
  return new Set(extractSkillMentions(text).map((mention) => mention.name));
}
