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

/**
 * Coarse technology family. Derived from this file's own section headings so
 * there is one source of truth: a UI that colours chips by family cannot drift
 * from the list it colours.
 */
export const SKILL_CATEGORIES = [
  "LANGUAGE",
  "FRAMEWORK",
  "DATA",
  "PLATFORM",
  "PRACTICE",
] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export interface GazetteerEntry {
  name: string;
  category: SkillCategory;
  aliases: string[];
}

export const SKILLS_GAZETTEER: GazetteerEntry[] = [
  // ── Programming languages ─────────────────────────────
  { name: "JavaScript", category: "LANGUAGE", aliases: ["javascript", "js"] },
  { name: "TypeScript", category: "LANGUAGE", aliases: ["typescript", "ts"] },
  { name: "Python", category: "LANGUAGE", aliases: ["python", "python3", "py"] },
  { name: "Java", category: "LANGUAGE", aliases: ["java"] },
  { name: "Kotlin", category: "LANGUAGE", aliases: ["kotlin"] },
  { name: "Scala", category: "LANGUAGE", aliases: ["scala"] },
  // Bare "go" is resolved contextually below; global matching is too noisy.
  { name: "Go", category: "LANGUAGE", aliases: ["golang", "go-lang"] },
  { name: "Rust", category: "LANGUAGE", aliases: ["rust", "rust-lang"] },
  { name: "C++", category: "LANGUAGE", aliases: ["c\\+\\+", "cpp"] },
  { name: "C#", category: "LANGUAGE", aliases: ["c#", "csharp", "c-sharp"] },
  { name: "C", category: "LANGUAGE", aliases: [] }, // fall through intentionally — too noisy to match
  { name: "Ruby", category: "LANGUAGE", aliases: ["ruby"] },
  { name: "PHP", category: "LANGUAGE", aliases: ["php"] },
  { name: "Swift", category: "LANGUAGE", aliases: ["swift"] },
  { name: "Objective-C", category: "LANGUAGE", aliases: ["objective-c", "objc"] },
  { name: "Dart", category: "LANGUAGE", aliases: ["dart"] },
  { name: "Elixir", category: "LANGUAGE", aliases: ["elixir"] },
  { name: "Erlang", category: "LANGUAGE", aliases: ["erlang"] },
  { name: "Haskell", category: "LANGUAGE", aliases: ["haskell"] },
  { name: "Clojure", category: "LANGUAGE", aliases: ["clojure"] },
  { name: "Lua", category: "LANGUAGE", aliases: ["lua"] },
  { name: "R", category: "LANGUAGE", aliases: [] }, // skip — too noisy
  { name: "Perl", category: "LANGUAGE", aliases: ["perl"] },
  { name: "Shell", category: "LANGUAGE", aliases: ["shell", "bash", "zsh", "shell scripting"] },
  { name: "PowerShell", category: "LANGUAGE", aliases: ["powershell"] },
  { name: "Groovy", category: "LANGUAGE", aliases: ["groovy"] },
  { name: "Solidity", category: "LANGUAGE", aliases: ["solidity"] },

  // ── Frontend frameworks & libs ────────────────────────
  { name: "React", category: "FRAMEWORK", aliases: ["react", "react\\.js", "reactjs"] },
  { name: "React Native", category: "FRAMEWORK", aliases: ["react native", "react-native"] },
  { name: "Next.js", category: "FRAMEWORK", aliases: ["next\\.js", "nextjs", "next js"] },
  { name: "Vue", category: "FRAMEWORK", aliases: ["vue", "vue\\.js", "vuejs"] },
  { name: "Nuxt", category: "FRAMEWORK", aliases: ["nuxt", "nuxt\\.js", "nuxtjs"] },
  { name: "Angular", category: "FRAMEWORK", aliases: ["angular", "angularjs"] },
  { name: "Svelte", category: "FRAMEWORK", aliases: ["svelte", "sveltekit"] },
  { name: "Solid.js", category: "FRAMEWORK", aliases: ["solid\\.js", "solidjs"] },
  { name: "Ember", category: "FRAMEWORK", aliases: ["ember", "ember\\.js"] },
  { name: "jQuery", category: "FRAMEWORK", aliases: ["jquery"] },
  { name: "Redux", category: "FRAMEWORK", aliases: ["redux"] },
  { name: "MobX", category: "FRAMEWORK", aliases: ["mobx"] },
  { name: "Zustand", category: "FRAMEWORK", aliases: ["zustand"] },
  { name: "React Query", category: "FRAMEWORK", aliases: ["react query", "react-query", "tanstack query"] },
  { name: "SWR", category: "FRAMEWORK", aliases: ["swr"] },
  { name: "Tailwind CSS", category: "FRAMEWORK", aliases: ["tailwind", "tailwind css", "tailwindcss"] },
  { name: "CSS", category: "FRAMEWORK", aliases: ["css", "css3"] },
  { name: "SCSS", category: "FRAMEWORK", aliases: ["scss", "sass"] },
  { name: "HTML", category: "FRAMEWORK", aliases: ["html", "html5"] },
  { name: "Webpack", category: "FRAMEWORK", aliases: ["webpack"] },
  { name: "Vite", category: "FRAMEWORK", aliases: ["vite"] },
  { name: "Rollup", category: "FRAMEWORK", aliases: ["rollup"] },
  { name: "esbuild", category: "FRAMEWORK", aliases: ["esbuild"] },
  { name: "Storybook", category: "FRAMEWORK", aliases: ["storybook"] },
  { name: "Material UI", category: "FRAMEWORK", aliases: ["material ui", "material-ui", "mui"] },
  { name: "shadcn/ui", category: "FRAMEWORK", aliases: ["shadcn", "shadcn/ui", "shadcn-ui"] },
  { name: "Chakra UI", category: "FRAMEWORK", aliases: ["chakra", "chakra ui", "chakra-ui"] },
  { name: "Ant Design", category: "FRAMEWORK", aliases: ["ant design", "antd"] },
  { name: "Bootstrap", category: "FRAMEWORK", aliases: ["bootstrap"] },

  // ── Backend frameworks ────────────────────────────────
  { name: "Node.js", category: "FRAMEWORK", aliases: ["node\\.js", "nodejs", "node js"] },
  { name: "Express", category: "FRAMEWORK", aliases: ["express", "express\\.js", "expressjs"] },
  { name: "NestJS", category: "FRAMEWORK", aliases: ["nestjs", "nest\\.js"] },
  { name: "Fastify", category: "FRAMEWORK", aliases: ["fastify"] },
  { name: "Koa", category: "FRAMEWORK", aliases: ["koa", "koa\\.js"] },
  { name: "Deno", category: "FRAMEWORK", aliases: ["deno"] },
  { name: "Bun", category: "FRAMEWORK", aliases: ["bun"] },
  // Bare "spring" is resolved contextually below; global matching is too noisy.
  { name: "Spring", category: "FRAMEWORK", aliases: ["spring framework"] },
  { name: "Spring Boot", category: "FRAMEWORK", aliases: ["spring boot", "springboot"] },
  { name: "Spring Cloud", category: "FRAMEWORK", aliases: ["spring cloud"] },
  { name: "Hibernate", category: "FRAMEWORK", aliases: ["hibernate"] },
  { name: "JPA", category: "FRAMEWORK", aliases: ["jpa"] },
  { name: "MyBatis", category: "FRAMEWORK", aliases: ["mybatis", "mybatis-plus", "mybatis plus"] },
  { name: "Django", category: "FRAMEWORK", aliases: ["django"] },
  { name: "Flask", category: "FRAMEWORK", aliases: ["flask"] },
  { name: "FastAPI", category: "FRAMEWORK", aliases: ["fastapi", "fast api"] },
  { name: "Rails", category: "FRAMEWORK", aliases: ["rails", "ruby on rails"] },
  { name: "Laravel", category: "FRAMEWORK", aliases: ["laravel"] },
  { name: "Symfony", category: "FRAMEWORK", aliases: ["symfony"] },
  { name: "ASP.NET", category: "FRAMEWORK", aliases: ["asp\\.net", "aspnet", "\\.net core", "dotnet"] },
  { name: ".NET", category: "FRAMEWORK", aliases: ["\\.net"] },
  { name: "Gin", category: "FRAMEWORK", aliases: ["gin", "gin-gonic"] },
  { name: "Echo", category: "FRAMEWORK", aliases: ["echo framework"] },
  { name: "Actix", category: "FRAMEWORK", aliases: ["actix", "actix-web"] },
  { name: "Phoenix", category: "FRAMEWORK", aliases: ["phoenix framework"] },
  { name: "Ktor", category: "FRAMEWORK", aliases: ["ktor"] },

  // ── Databases ─────────────────────────────────────────
  { name: "PostgreSQL", category: "DATA", aliases: ["postgres", "postgresql", "psql"] },
  { name: "MySQL", category: "DATA", aliases: ["mysql"] },
  { name: "MariaDB", category: "DATA", aliases: ["mariadb"] },
  { name: "SQLite", category: "DATA", aliases: ["sqlite"] },
  { name: "SQL Server", category: "DATA", aliases: ["sql server", "mssql", "microsoft sql server"] },
  { name: "Oracle", category: "DATA", aliases: ["oracle database", "oracle db"] },
  { name: "MongoDB", category: "DATA", aliases: ["mongodb", "mongo"] },
  { name: "Redis", category: "DATA", aliases: ["redis"] },
  { name: "Memcached", category: "DATA", aliases: ["memcached"] },
  { name: "Cassandra", category: "DATA", aliases: ["cassandra"] },
  { name: "DynamoDB", category: "DATA", aliases: ["dynamodb", "dynamo db"] },
  { name: "Elasticsearch", category: "DATA", aliases: ["elasticsearch", "elastic search"] },
  { name: "OpenSearch", category: "DATA", aliases: ["opensearch", "open search"] },
  { name: "Neo4j", category: "DATA", aliases: ["neo4j"] },
  { name: "CouchDB", category: "DATA", aliases: ["couchdb"] },
  { name: "Firestore", category: "DATA", aliases: ["firestore"] },
  { name: "Supabase", category: "DATA", aliases: ["supabase"] },
  { name: "CockroachDB", category: "DATA", aliases: ["cockroachdb", "cockroach db"] },
  { name: "ClickHouse", category: "DATA", aliases: ["clickhouse"] },
  { name: "Snowflake", category: "DATA", aliases: ["snowflake"] },
  { name: "BigQuery", category: "DATA", aliases: ["bigquery", "big query"] },
  { name: "Redshift", category: "DATA", aliases: ["redshift"] },
  { name: "Databricks", category: "DATA", aliases: ["databricks"] },
  { name: "Prisma", category: "DATA", aliases: ["prisma", "prisma orm"] },
  { name: "TypeORM", category: "DATA", aliases: ["typeorm"] },
  { name: "Sequelize", category: "DATA", aliases: ["sequelize"] },
  { name: "Drizzle", category: "DATA", aliases: ["drizzle", "drizzle orm"] },
  { name: "GraphQL", category: "DATA", aliases: ["graphql"] },
  { name: "Apollo", category: "DATA", aliases: ["apollo", "apollo server", "apollo client"] },
  { name: "Hasura", category: "DATA", aliases: ["hasura"] },

  // ── Cloud / infra ─────────────────────────────────────
  { name: "AWS", category: "PLATFORM", aliases: ["aws", "amazon web services"] },
  { name: "Amazon EC2", category: "PLATFORM", aliases: ["amazon ec2", "aws ec2", "ec2"] },
  { name: "Amazon ECS", category: "PLATFORM", aliases: ["amazon ecs", "aws ecs", "ecs"] },
  { name: "Amazon EKS", category: "PLATFORM", aliases: ["amazon eks", "aws eks", "eks"] },
  { name: "Amazon RDS", category: "PLATFORM", aliases: ["amazon rds", "aws rds", "rds"] },
  { name: "Amazon S3", category: "PLATFORM", aliases: ["amazon s3", "aws s3", "s3"] },
  { name: "CloudFormation", category: "PLATFORM", aliases: ["cloudformation", "cloud formation"] },
  { name: "GCP", category: "PLATFORM", aliases: ["gcp", "google cloud", "google cloud platform"] },
  { name: "Google Kubernetes Engine", category: "PLATFORM", aliases: ["google kubernetes engine", "gke"] },
  { name: "Cloud Run", category: "PLATFORM", aliases: ["google cloud run", "cloud run"] },
  { name: "Azure", category: "PLATFORM", aliases: ["azure", "microsoft azure"] },
  { name: "Azure Kubernetes Service", category: "PLATFORM", aliases: ["azure kubernetes service", "aks"] },
  { name: "Azure DevOps", category: "PLATFORM", aliases: ["azure devops"] },
  { name: "Azure Functions", category: "PLATFORM", aliases: ["azure functions"] },
  { name: "Vercel", category: "PLATFORM", aliases: ["vercel"] },
  { name: "Netlify", category: "PLATFORM", aliases: ["netlify"] },
  { name: "Cloudflare", category: "PLATFORM", aliases: ["cloudflare"] },
  { name: "Heroku", category: "PLATFORM", aliases: ["heroku"] },
  { name: "DigitalOcean", category: "PLATFORM", aliases: ["digitalocean", "digital ocean"] },
  { name: "Docker", category: "PLATFORM", aliases: ["docker"] },
  { name: "Kubernetes", category: "PLATFORM", aliases: ["kubernetes", "k8s", "k3s"] },
  { name: "Helm", category: "PLATFORM", aliases: ["helm"] },
  { name: "Terraform", category: "PLATFORM", aliases: ["terraform"] },
  { name: "Pulumi", category: "PLATFORM", aliases: ["pulumi"] },
  { name: "Ansible", category: "PLATFORM", aliases: ["ansible"] },
  { name: "Chef", category: "PLATFORM", aliases: ["chef configuration management"] },
  { name: "Puppet", category: "PLATFORM", aliases: ["puppet"] },
  { name: "Istio", category: "PLATFORM", aliases: ["istio"] },
  { name: "Consul", category: "PLATFORM", aliases: ["consul"] },
  { name: "Nomad", category: "PLATFORM", aliases: ["nomad"] },
  { name: "Packer", category: "PLATFORM", aliases: ["packer"] },
  { name: "Vagrant", category: "PLATFORM", aliases: ["vagrant"] },
  { name: "Nginx", category: "PLATFORM", aliases: ["nginx"] },
  { name: "Apache", category: "PLATFORM", aliases: ["apache"] },
  { name: "HAProxy", category: "PLATFORM", aliases: ["haproxy"] },
  { name: "CDN", category: "PLATFORM", aliases: ["cdn"] },

  // ── DevOps / CI-CD ────────────────────────────────────
  { name: "Git", category: "PLATFORM", aliases: ["git"] },
  { name: "GitHub", category: "PLATFORM", aliases: ["github"] },
  { name: "GitLab", category: "PLATFORM", aliases: ["gitlab"] },
  { name: "Bitbucket", category: "PLATFORM", aliases: ["bitbucket"] },
  { name: "GitHub Actions", category: "PLATFORM", aliases: ["github actions"] },
  { name: "GitLab CI", category: "PLATFORM", aliases: ["gitlab ci", "gitlab-ci"] },
  { name: "Jenkins", category: "PLATFORM", aliases: ["jenkins"] },
  { name: "CircleCI", category: "PLATFORM", aliases: ["circleci", "circle ci"] },
  { name: "Travis CI", category: "PLATFORM", aliases: ["travis ci", "travis-ci"] },
  { name: "ArgoCD", category: "PLATFORM", aliases: ["argocd", "argo cd"] },
  { name: "FluxCD", category: "PLATFORM", aliases: ["fluxcd", "flux cd"] },
  { name: "Spinnaker", category: "PLATFORM", aliases: ["spinnaker"] },
  { name: "Prometheus", category: "PLATFORM", aliases: ["prometheus"] },
  { name: "Grafana", category: "PLATFORM", aliases: ["grafana"] },
  { name: "Datadog", category: "PLATFORM", aliases: ["datadog"] },
  { name: "New Relic", category: "PLATFORM", aliases: ["new relic", "newrelic"] },
  { name: "Splunk", category: "PLATFORM", aliases: ["splunk"] },
  { name: "Sentry", category: "PLATFORM", aliases: ["sentry"] },
  { name: "PagerDuty", category: "PLATFORM", aliases: ["pagerduty"] },
  { name: "OpenTelemetry", category: "PLATFORM", aliases: ["opentelemetry", "otel"] },
  { name: "Jaeger", category: "PLATFORM", aliases: ["jaeger"] },

  // ── Messaging / streaming ─────────────────────────────
  { name: "Kafka", category: "DATA", aliases: ["kafka", "apache kafka"] },
  { name: "RabbitMQ", category: "DATA", aliases: ["rabbitmq", "rabbit mq"] },
  { name: "NATS", category: "DATA", aliases: ["nats"] },
  { name: "ActiveMQ", category: "DATA", aliases: ["activemq"] },
  { name: "ZeroMQ", category: "DATA", aliases: ["zeromq", "zmq"] },
  { name: "SQS", category: "DATA", aliases: ["sqs"] },
  { name: "SNS", category: "DATA", aliases: ["sns"] },
  { name: "Pub/Sub", category: "DATA", aliases: ["pub/sub", "pubsub"] },
  { name: "Kinesis", category: "DATA", aliases: ["kinesis"] },
  { name: "Airflow", category: "DATA", aliases: ["airflow", "apache airflow"] },
  { name: "Dagster", category: "DATA", aliases: ["dagster"] },
  { name: "Prefect", category: "DATA", aliases: ["prefect"] },
  { name: "Temporal", category: "DATA", aliases: ["temporal"] },

  // ── Data / ML / AI ────────────────────────────────────
  { name: "TensorFlow", category: "DATA", aliases: ["tensorflow"] },
  { name: "PyTorch", category: "DATA", aliases: ["pytorch"] },
  { name: "JAX", category: "DATA", aliases: ["jax"] },
  { name: "Keras", category: "DATA", aliases: ["keras"] },
  { name: "Scikit-learn", category: "DATA", aliases: ["scikit-learn", "sklearn"] },
  { name: "Pandas", category: "DATA", aliases: ["pandas"] },
  { name: "NumPy", category: "DATA", aliases: ["numpy"] },
  { name: "SciPy", category: "DATA", aliases: ["scipy"] },
  { name: "Spark", category: "DATA", aliases: ["spark", "apache spark", "pyspark"] },
  { name: "Hadoop", category: "DATA", aliases: ["hadoop"] },
  { name: "Flink", category: "DATA", aliases: ["flink", "apache flink"] },
  { name: "dbt", category: "DATA", aliases: ["dbt"] },
  { name: "LangChain", category: "DATA", aliases: ["langchain"] },
  { name: "LlamaIndex", category: "DATA", aliases: ["llamaindex", "llama index"] },
  { name: "OpenAI", category: "DATA", aliases: ["openai", "open ai"] },
  { name: "Anthropic", category: "DATA", aliases: ["anthropic"] },
  { name: "Claude", category: "DATA", aliases: ["claude"] },
  { name: "GPT", category: "DATA", aliases: ["gpt", "gpt-4", "gpt-3\\.5", "chatgpt"] },
  { name: "LLM", category: "DATA", aliases: ["llm", "llms", "large language model"] },
  { name: "RAG", category: "DATA", aliases: ["rag", "retrieval augmented generation", "retrieval-augmented"] },
  { name: "MCP", category: "DATA", aliases: ["mcp", "model context protocol"] },
  { name: "Embeddings", category: "DATA", aliases: ["embeddings", "embedding"] },
  { name: "Pinecone", category: "DATA", aliases: ["pinecone"] },
  { name: "Weaviate", category: "DATA", aliases: ["weaviate"] },
  { name: "Qdrant", category: "DATA", aliases: ["qdrant"] },
  { name: "Chroma", category: "DATA", aliases: ["chroma", "chromadb"] },
  { name: "pgvector", category: "DATA", aliases: ["pgvector"] },
  { name: "Hugging Face", category: "DATA", aliases: ["hugging face", "huggingface"] },
  { name: "Transformers", category: "DATA", aliases: ["transformers library"] },
  { name: "MLflow", category: "DATA", aliases: ["mlflow"] },
  { name: "Weights & Biases", category: "DATA", aliases: ["weights & biases", "wandb"] },
  { name: "Ray", category: "DATA", aliases: ["ray"] },
  { name: "Dask", category: "DATA", aliases: ["dask"] },
  { name: "OpenCV", category: "DATA", aliases: ["opencv"] },

  // ── Testing ───────────────────────────────────────────
  { name: "Jest", category: "PRACTICE", aliases: ["jest"] },
  { name: "Vitest", category: "PRACTICE", aliases: ["vitest"] },
  { name: "Mocha", category: "PRACTICE", aliases: ["mocha"] },
  { name: "Cypress", category: "PRACTICE", aliases: ["cypress"] },
  { name: "Playwright", category: "PRACTICE", aliases: ["playwright"] },
  { name: "Selenium", category: "PRACTICE", aliases: ["selenium"] },
  { name: "Puppeteer", category: "PRACTICE", aliases: ["puppeteer"] },
  { name: "pytest", category: "PRACTICE", aliases: ["pytest"] },
  { name: "unittest", category: "PRACTICE", aliases: ["unittest"] },
  { name: "JUnit", category: "PRACTICE", aliases: ["junit"] },
  { name: "TestNG", category: "PRACTICE", aliases: ["testng"] },
  { name: "RSpec", category: "PRACTICE", aliases: ["rspec"] },
  { name: "Testing Library", category: "PRACTICE", aliases: ["testing library", "react testing library"] },
  { name: "TDD", category: "PRACTICE", aliases: ["tdd", "test-driven development", "test driven development"] },
  { name: "BDD", category: "PRACTICE", aliases: ["bdd", "behavior-driven development"] },

  // ── Mobile ────────────────────────────────────────────
  { name: "iOS", category: "FRAMEWORK", aliases: ["ios"] },
  { name: "Android", category: "FRAMEWORK", aliases: ["android"] },
  { name: "Flutter", category: "FRAMEWORK", aliases: ["flutter"] },
  { name: "Xamarin", category: "FRAMEWORK", aliases: ["xamarin"] },
  { name: "Ionic", category: "FRAMEWORK", aliases: ["ionic"] },
  { name: "Cordova", category: "FRAMEWORK", aliases: ["cordova"] },
  { name: "SwiftUI", category: "FRAMEWORK", aliases: ["swiftui"] },
  { name: "Jetpack Compose", category: "FRAMEWORK", aliases: ["jetpack compose"] },

  // ── Protocols / formats ───────────────────────────────
  { name: "REST", category: "PRACTICE", aliases: ["rest", "restful", "rest api"] },
  { name: "gRPC", category: "PRACTICE", aliases: ["grpc"] },
  { name: "WebSocket", category: "PRACTICE", aliases: ["websocket", "websockets"] },
  { name: "JSON", category: "PRACTICE", aliases: ["json"] },
  { name: "XML", category: "PRACTICE", aliases: ["xml"] },
  { name: "YAML", category: "PRACTICE", aliases: ["yaml", "yml"] },
  { name: "Protobuf", category: "PRACTICE", aliases: ["protobuf", "protocol buffers"] },
  { name: "OAuth", category: "PRACTICE", aliases: ["oauth", "oauth2", "oauth 2\\.0"] },
  { name: "OpenID Connect", category: "PRACTICE", aliases: ["openid connect", "oidc"] },
  { name: "JWT", category: "PRACTICE", aliases: ["jwt", "json web token"] },
  { name: "SAML", category: "PRACTICE", aliases: ["saml"] },
  { name: "TLS", category: "PRACTICE", aliases: ["tls", "ssl"] },
  { name: "HTTP", category: "PRACTICE", aliases: ["http", "http/2", "http/3"] },

  // ── Architecture / methodology ────────────────────────
  { name: "Microservices", category: "PRACTICE", aliases: ["microservice", "microservices"] },
  { name: "Event-driven", category: "PRACTICE", aliases: ["event-driven", "event driven architecture"] },
  { name: "Serverless", category: "PRACTICE", aliases: ["serverless"] },
  { name: "Lambda", category: "PRACTICE", aliases: ["lambda", "aws lambda"] },
  { name: "CQRS", category: "PRACTICE", aliases: ["cqrs"] },
  { name: "Event Sourcing", category: "PRACTICE", aliases: ["event sourcing"] },
  { name: "DDD", category: "PRACTICE", aliases: ["ddd", "domain-driven design"] },
  { name: "Agile", category: "PRACTICE", aliases: ["agile"] },
  { name: "Scrum", category: "PRACTICE", aliases: ["scrum"] },
  { name: "Kanban", category: "PRACTICE", aliases: ["kanban"] },
  { name: "CI/CD", category: "PRACTICE", aliases: ["ci/cd", "cicd", "continuous integration"] },
  { name: "DevOps", category: "PRACTICE", aliases: ["devops"] },
  { name: "SRE", category: "PRACTICE", aliases: ["sre", "site reliability"] },
  { name: "MLOps", category: "PRACTICE", aliases: ["mlops"] },
  { name: "GitOps", category: "PRACTICE", aliases: ["gitops"] },
  { name: "Observability", category: "PRACTICE", aliases: ["observability"] },
  { name: "Monitoring", category: "PRACTICE", aliases: ["monitoring"] },
  { name: "Logging", category: "PRACTICE", aliases: ["logging"] },

  // ── Security ──────────────────────────────────────────
  { name: "OWASP", category: "PRACTICE", aliases: ["owasp"] },
  { name: "Penetration Testing", category: "PRACTICE", aliases: ["penetration testing", "pen testing", "pentest"] },
  { name: "Zero Trust", category: "PRACTICE", aliases: ["zero trust"] },
  { name: "IAM", category: "PRACTICE", aliases: ["iam"] },
  { name: "RBAC", category: "PRACTICE", aliases: ["rbac", "role-based access"] },

  // ── Payments / integrations ──────────────────────────
  { name: "Stripe", category: "DATA", aliases: ["stripe"] },
  { name: "PayPal", category: "DATA", aliases: ["paypal"] },
  { name: "Twilio", category: "DATA", aliases: ["twilio"] },
  { name: "SendGrid", category: "DATA", aliases: ["sendgrid"] },
  { name: "Auth0", category: "DATA", aliases: ["auth0"] },
  { name: "Okta", category: "DATA", aliases: ["okta"] },
  { name: "Clerk", category: "DATA", aliases: ["clerk"] },

  // ── Build / package ─────────────────────────────────
  { name: "Maven", category: "PLATFORM", aliases: ["maven"] },
  { name: "Gradle", category: "PLATFORM", aliases: ["gradle"] },
  { name: "npm", category: "PLATFORM", aliases: ["npm"] },
  { name: "yarn", category: "PLATFORM", aliases: ["yarn"] },
  { name: "pnpm", category: "PLATFORM", aliases: ["pnpm"] },
  { name: "pip", category: "PLATFORM", aliases: ["pip"] },
  { name: "Poetry", category: "PLATFORM", aliases: ["poetry"] },
  { name: "Cargo", category: "PLATFORM", aliases: ["cargo"] },
  { name: "Go Modules", category: "PLATFORM", aliases: ["go modules", "go mod"] },
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

const CATEGORY_BY_NAME: ReadonlyMap<string, SkillCategory> = new Map(
  SKILLS_GAZETTEER.map((entry) => [entry.name, entry.category]),
);

/**
 * Technology family for a canonical skill name.
 *
 * Returns null for anything outside the gazetteer — the JD analyser can surface
 * skills it inferred from context, and a wrong colour is worse than no colour.
 */
export function categoryForSkill(name: string): SkillCategory | null {
  return CATEGORY_BY_NAME.get(name) ?? null;
}
