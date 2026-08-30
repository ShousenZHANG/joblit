/**
 * Synthetic candidate profiles for the eval set.
 *
 * The operator's own profile is one data point, and a pass rate measured
 * against one profile says nothing about which failures are the prompt's
 * fault and which are the profile's. These four vary the axis that the gates
 * actually react to: how much evidence the summary has to draw on.
 *
 * summaryLint rejects any number or skill the profile does not already carry,
 * so a thin profile should fail more often than a dense one. That prediction
 * is the point of including them — if it does not hold, the failure is in the
 * prompt rather than in the evidence.
 *
 * All four are invented. No real person's details appear here.
 */

const link = (label, url) => ({ label, url });

export const SYNTHETIC_PROFILES = [
  {
    id: "thin-junior",
    note: "One short role, no projects, few skills. Least evidence to ground a summary in.",
    locale: "en-AU",
    summary: "Junior developer looking for backend work.",
    basics: {
      fullName: "Alex Rivera",
      title: "Junior Software Engineer",
      email: "alex.rivera@example.com",
      phone: "(+61) 400 000 001",
      location: "Melbourne, Australia",
    },
    links: [link("GitHub", "https://github.com/example-alex")],
    skills: [{ category: "Languages", items: ["Python", "JavaScript", "SQL"] }],
    experiences: [
      {
        title: "Junior Developer",
        company: "Riverstone Digital",
        location: "Melbourne, Australia",
        dates: "Feb 2025 - Present",
        links: [],
        bullets: [
          "Maintained internal reporting scripts in Python and fixed defects raised by the support team.",
          "Wrote SQL queries against the reporting database to answer ad-hoc questions from operations.",
        ],
      },
    ],
    projects: [],
    education: [
      {
        school: "RMIT University",
        degree: "Bachelor of Computer Science",
        location: "Melbourne, Australia",
        dates: "Feb 2021 - Nov 2024",
        details: "",
      },
    ],
  },
  {
    id: "mid-fullstack",
    note: "Three years, web stack, one project. The common shape.",
    locale: "en-AU",
    summary:
      "Full-stack engineer working across React front ends and Node services, with a focus on getting features to production quickly and safely.",
    basics: {
      fullName: "Priya Nathan",
      title: "Software Engineer",
      email: "priya.nathan@example.com",
      phone: "(+61) 400 000 002",
      location: "Sydney, Australia",
    },
    links: [link("GitHub", "https://github.com/example-priya"), link("LinkedIn", "https://linkedin.com/in/example-priya")],
    skills: [
      { category: "Languages", items: ["TypeScript", "JavaScript", "Python", "SQL"] },
      { category: "Frontend", items: ["React", "Next.js", "Tailwind CSS", "Vitest"] },
      { category: "Backend & Data", items: ["Node.js", "Express", "PostgreSQL", "Redis", "REST APIs"] },
      { category: "Cloud & Tooling", items: ["AWS", "Docker", "GitHub Actions", "Terraform"] },
    ],
    experiences: [
      {
        title: "Software Engineer",
        company: "Harbourline Software",
        location: "Sydney, Australia",
        dates: "Mar 2023 - Present",
        links: [],
        bullets: [
          "Built and shipped customer-facing features across a React front end and Node services, owning them from design through to production support.",
          "Migrated the reporting endpoints to a paginated API, cutting the slowest dashboard load from twelve seconds to under two.",
          "Introduced contract tests between the front end and the service layer, which caught three breaking changes before release.",
        ],
      },
      {
        title: "Graduate Developer",
        company: "Bellhaven Systems",
        location: "Sydney, Australia",
        dates: "Jan 2022 - Feb 2023",
        links: [],
        bullets: [
          "Delivered internal tooling in TypeScript used by the operations team for daily reconciliation.",
          "Automated the release checklist with GitHub Actions, removing a manual step from every deploy.",
        ],
      },
    ],
    projects: [
      {
        name: "Ledgerly",
        location: "Sydney, Australia",
        dates: "2024",
        stack: "Next.js, PostgreSQL, Stripe",
        links: [link("GitHub", "https://github.com/example-priya/ledgerly")],
        bullets: [
          "Built a small invoicing tool for freelancers, with Stripe checkout and PDF export.",
        ],
      },
    ],
    education: [
      {
        school: "University of Technology Sydney",
        degree: "Bachelor of Software Engineering",
        location: "Sydney, Australia",
        dates: "Feb 2018 - Nov 2021",
        details: "",
      },
    ],
  },
  {
    id: "dense-senior",
    note: "Seven years, many quantified bullets. Most evidence available to ground a summary.",
    locale: "en-AU",
    summary:
      "Senior engineer building distributed data platforms, with a track record of taking systems from prototype to production and keeping them cheap to run.",
    basics: {
      fullName: "Daniel Okafor",
      title: "Senior Software Engineer",
      email: "daniel.okafor@example.com",
      phone: "(+61) 400 000 003",
      location: "Brisbane, Australia",
    },
    links: [link("GitHub", "https://github.com/example-daniel"), link("LinkedIn", "https://linkedin.com/in/example-daniel")],
    skills: [
      { category: "Languages", items: ["Go", "Python", "Java", "SQL", "TypeScript"] },
      { category: "Data & Streaming", items: ["Kafka", "Spark", "Airflow", "dbt", "Snowflake", "PostgreSQL"] },
      { category: "Platform", items: ["Kubernetes", "Docker", "Terraform", "AWS", "GCP", "Prometheus", "Grafana"] },
      { category: "Practices", items: ["Distributed Systems", "Observability", "CI/CD", "Incident Response", "Mentoring"] },
    ],
    experiences: [
      {
        title: "Senior Software Engineer",
        company: "Meridian Data",
        location: "Brisbane, Australia",
        dates: "Jun 2022 - Present",
        links: [],
        bullets: [
          "Led the rebuild of the ingestion pipeline onto Kafka and Spark, lifting sustained throughput from 40,000 to 250,000 events per second.",
          "Cut the platform's monthly cloud spend by 38 percent by right-sizing the compute tier and moving cold partitions to object storage.",
          "Owned the on-call rotation for four services and drove the median incident resolution time down from 90 minutes to 25.",
          "Mentored three engineers through their first production launches and ran the internal distributed-systems reading group.",
        ],
      },
      {
        title: "Software Engineer",
        company: "Ardent Analytics",
        location: "Brisbane, Australia",
        dates: "Feb 2019 - May 2022",
        links: [],
        bullets: [
          "Built the dbt models and Airflow schedules behind the company's core reporting product, serving 200 enterprise customers.",
          "Introduced end-to-end tracing across six services, which reduced time-to-diagnose on data quality incidents by roughly half.",
        ],
      },
    ],
    projects: [
      {
        name: "streamcheck",
        location: "Brisbane, Australia",
        dates: "2023 - Present",
        stack: "Go, Kafka",
        links: [link("GitHub", "https://github.com/example-daniel/streamcheck")],
        bullets: [
          "Open-source consumer-lag monitor for Kafka, used by several teams internally and with 400 GitHub stars.",
        ],
      },
    ],
    education: [
      {
        school: "University of Queensland",
        degree: "Bachelor of Engineering (Software)",
        location: "Brisbane, Australia",
        dates: "Feb 2014 - Nov 2017",
        details: "",
      },
    ],
  },
  {
    id: "career-changer",
    note: "Non-linear background, mixed domain vocabulary. Tests whether the summary stays grounded when the evidence is not all technical.",
    locale: "en-AU",
    summary:
      "Data analyst moving into engineering, with a background in clinical research and a focus on making analysis reproducible.",
    basics: {
      fullName: "Sofia Marchetti",
      title: "Data Analyst",
      email: "sofia.marchetti@example.com",
      phone: "(+61) 400 000 004",
      location: "Adelaide, Australia",
    },
    links: [link("LinkedIn", "https://linkedin.com/in/example-sofia")],
    skills: [
      { category: "Analysis", items: ["Python", "pandas", "SQL", "R", "Statistics"] },
      { category: "Tooling", items: ["Jupyter", "Git", "Tableau", "Excel"] },
      { category: "Domain", items: ["Clinical Research", "Regulatory Reporting", "Data Governance"] },
    ],
    experiences: [
      {
        title: "Data Analyst",
        company: "Coastline Health Research",
        location: "Adelaide, Australia",
        dates: "Aug 2023 - Present",
        links: [],
        bullets: [
          "Rebuilt the trial reporting workflow in Python notebooks, replacing a spreadsheet process that took two days each month.",
          "Standardised how study data is validated before submission, which removed a recurring source of regulatory queries.",
        ],
      },
      {
        title: "Clinical Research Coordinator",
        company: "Coastline Health Research",
        location: "Adelaide, Australia",
        dates: "Mar 2020 - Jul 2023",
        links: [],
        bullets: [
          "Coordinated data collection across three concurrent studies and maintained the source documentation for audit.",
        ],
      },
    ],
    projects: [],
    education: [
      {
        school: "University of Adelaide",
        degree: "Bachelor of Health Sciences",
        location: "Adelaide, Australia",
        dates: "Feb 2016 - Nov 2019",
        details: "",
      },
    ],
  },
];
