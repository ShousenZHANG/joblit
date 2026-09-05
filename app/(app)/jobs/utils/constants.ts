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

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getUserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
