// Anonymous, authored fixtures only. These are also the source for the static
// PDFs in public/demo; no profile or job data is read from the application.
export const DEMO_SKILLS = ["Power Apps", "Power Automate", "Azure", "TypeScript", "React", "Python", "SQL", "AWS"] as const;

export const DEMO_PROFILE = {
  name: "Alex Morgan",
  title: "Software Engineer",
  summary: "Software engineer experienced in building business applications, accessible web interfaces and AI-assisted workflows. Works with product and operations teams to turn requirements into maintainable software, with a practical focus on testing and clear documentation.",
  experience: [
    "Developed Power Apps forms and Power Automate workflows backed by SQL and Azure services.",
    "Built accessible React interfaces and TypeScript APIs for internal business tools.",
    "Used Python to test AI-assisted workflows and document human review checkpoints.",
  ],
} as const;

export const DEMO_JOBS = [
  {
    id: "powerapps",
    title: "Application Developer – PowerApps",
    qualifier: "Fixed term full-time opportunity",
    company: "Harbour Civic Systems",
    location: "Sydney, New South Wales, Australia",
    level: "Mid-senior level",
    age: "13h",
    requirement: "3+ years",
    technology: ["Power Apps", "Power Automate", "Azure", "SQL"],
    intro: "Build reliable business applications that help teams deliver better everyday services.",
    source: "You have 3+ years of application development experience, including hands-on work with Power Apps, Power Automate and Azure.",
    responsibilities: [
      "Design, build and support Power Apps solutions connected to SQL data sources.",
      "Work with stakeholders to translate business requirements into clear, accessible workflows.",
      "Test changes, document decisions and support the applications you deliver.",
    ],
    closing: "Bring a practical approach to problem-solving and communicate clearly with technical and non-technical teammates.",
    summary: "Software engineer with hands-on experience developing Power Apps forms and Power Automate workflows backed by SQL and Azure. Brings accessible interface development, testing and documentation experience to building maintainable business applications.",
    skills: [0, 1, 2, 6],
    cover: [
      "I am interested in the Application Developer – PowerApps role at Harbour Civic Systems. Your focus on reliable business applications aligns with my experience developing Power Apps forms and Power Automate workflows backed by SQL and Azure services.",
      "I have also built accessible React interfaces and TypeScript APIs for internal tools. That work gives me practical experience translating requirements into usable applications, while testing changes and documenting decisions for the people who maintain them.",
      "I would welcome the opportunity to discuss how my application development experience could support your team. Thank you for considering my application.",
    ],
  },
  {
    id: "fullstack",
    title: "Junior Full Stack Analyst Programmer",
    qualifier: "",
    company: "Southern Cross Software",
    location: "Melbourne, Victoria, Australia",
    level: "Entry level",
    age: "24h",
    requirement: "1–2 years",
    technology: ["React", "TypeScript", "SQL"],
    intro: "Build your full stack career across real business-critical systems.",
    source: "You bring 1–2 years of relevant professional experience and practical knowledge of React, TypeScript and SQL.",
    responsibilities: [
      "Develop across frontend, backend, APIs and internal business systems.",
      "Grow your technical skills through code review and collaboration with experienced engineers.",
      "Validate AI-assisted development outputs through testing and human review.",
    ],
    closing: "Join a supportive team that values clear communication, curiosity and maintainable software.",
    summary: "Software engineer with experience building accessible React interfaces and TypeScript APIs for internal business tools. Brings SQL knowledge and hands-on experience testing AI-assisted workflows, with a focus on dependable applications and clear documentation.",
    skills: [4, 3, 6, 5],
    cover: [
      "I am interested in the Junior Full Stack Analyst Programmer role at Southern Cross Software. Your work across business-critical systems connects with my experience building accessible React interfaces and TypeScript APIs for internal business tools.",
      "My work with SQL-backed applications and Python-based testing has helped me understand how interfaces, data and workflows fit together. I have also documented human review checkpoints for AI-assisted workflows, which aligns with your emphasis on validating development outputs.",
      "I would welcome a conversation about how I could contribute to your team and continue developing my full stack skills. Thank you for considering my application.",
    ],
  },
  {
    id: "ai",
    title: "AI Systems Engineer",
    qualifier: "",
    company: "Wattle Research Studio",
    location: "Brisbane, Queensland, Australia",
    level: "Mid-senior level",
    age: "24h",
    requirement: "3+ years",
    technology: ["Python", "Azure", "SQL"],
    intro: "Help teams turn AI-assisted workflows into useful, dependable internal tools.",
    source: "You bring 3+ years of software engineering experience, with Python, Azure and SQL skills to support AI-assisted workflows.",
    responsibilities: [
      "Build and test integrations between internal applications and AI services.",
      "Define human review checkpoints and document the limits of automated outputs.",
      "Work with product teams to improve reliability and maintainable system design.",
    ],
    closing: "We value thoughtful engineering, measurable testing and an honest understanding of what a system can do.",
    summary: "Software engineer with experience using Python to test AI-assisted workflows and document human review checkpoints. Combines Azure and SQL application experience with a practical approach to building reliable integrations and maintainable internal tools.",
    skills: [5, 2, 6, 3],
    cover: [
      "I am interested in the AI Systems Engineer role at Wattle Research Studio. Your focus on dependable internal tools aligns with my experience using Python to test AI-assisted workflows and document human review checkpoints.",
      "I bring experience developing applications backed by SQL and Azure services, as well as React interfaces and TypeScript APIs. This background helps me connect workflow requirements with the application and data systems that support them.",
      "I would welcome the opportunity to discuss how my software engineering experience could support your integrations and testing work. Thank you for your consideration.",
    ],
  },
] as const;

export type DemoJob = (typeof DEMO_JOBS)[number];
