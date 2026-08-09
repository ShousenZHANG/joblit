export const HIGHLIGHT_KEYWORDS = [
  "HTML", "CSS", "Sass", "SCSS", "Less", "JavaScript", "TypeScript", "React",
  "Next.js", "Vue", "Nuxt", "Angular", "Svelte", "SvelteKit", "SolidJS", "Remix",
  "Node", "Node.js", "Express", "NestJS", "Fastify", "Deno", "Bun",
  "Python", "Django", "Flask", "FastAPI", "Java", "Spring", "Spring Boot",
  "Kotlin", "Scala", "C#", ".NET", "ASP.NET", "C++", "Go", "Golang", "Rust",
  "Ruby", "Rails", "PHP", "Laravel", "GraphQL", "REST", "gRPC", "tRPC",
  "SQL", "PostgreSQL", "MySQL", "SQLite", "MongoDB", "Redis", "Elasticsearch",
  "OpenSearch", "Kafka", "RabbitMQ", "SQS", "SNS", "AWS", "Azure", "GCP",
  "Firebase", "Cloudflare", "Docker", "Kubernetes", "Terraform", "Ansible",
  "Git", "GitHub Actions", "GitLab CI", "CI/CD", "Linux", "Nginx", "Vercel", "Netlify",
  "Jest", "Vitest", "Cypress", "Playwright", "Storybook", "Tailwind", "shadcn/ui",
  "Material UI", "Chakra UI", "Figma", "React Native", "Flutter", "Swift", "SwiftUI",
  "Android", "iOS", "ML", "AI", "LLM", "OpenAI", "LangChain", "Vector",
  "Pinecone", "Weaviate", "Snowflake", "Databricks", "Airflow", "dbt",
];

/**
 * Values are the `state:` keys `lib/server/jobs/jobLocationScope.ts` expands
 * into the aliases a posting actually carries — `state:NSW` becomes
 * ["NSW", "New South Wales", "Sydney", "Newcastle", "Wollongong"].
 *
 * Job.location is the source posting's own string (jobImportService writes
 * `item.location` verbatim), so a literal "New South Wales, Australia" never
 * matched a row reading "Sydney, AU". The filter looked useless because it was
 * returning nothing, not because the scope was already narrow.
 */
export const AU_LOCATION_OPTIONS = [
  { value: "state:NSW", label: "New South Wales" },
  { value: "state:VIC", label: "Victoria" },
  { value: "state:QLD", label: "Queensland" },
  { value: "state:WA", label: "Western Australia" },
  { value: "state:SA", label: "South Australia" },
  { value: "state:ACT", label: "ACT" },
  { value: "state:TAS", label: "Tasmania" },
  { value: "state:NT", label: "Northern Territory" },
];

export const CN_LOCATION_OPTIONS = [
  { value: "Beijing", label: "北京" },
  { value: "Shanghai", label: "上海" },
  { value: "Shenzhen", label: "深圳" },
  { value: "Guangzhou", label: "广州" },
  { value: "Hangzhou", label: "杭州" },
  { value: "Chengdu", label: "成都" },
  { value: "Nanjing", label: "南京" },
  { value: "Wuhan", label: "武汉" },
  { value: "Suzhou", label: "苏州" },
  { value: "Xi'an", label: "西安" },
];

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getUserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
