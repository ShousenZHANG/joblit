import { escapeLatex, escapeLatexWithBold } from "./escapeLatex";
import { asRecord, asArray, toStringValue, hasText } from "@/lib/shared/utils/text";

type ResumeProfileLike = {
  summary?: string | null;
  basics?: unknown;
  links?: unknown;
  skills?: unknown;
  experiences?: unknown;
  projects?: unknown;
  education?: unknown;
};

function formatSchoolDegree(schoolRaw: unknown, degreeRaw: unknown) {
  const school = escapeLatex(toStringValue(schoolRaw)).trim();
  const degree = escapeLatex(toStringValue(degreeRaw)).trim();
  if (school && degree) return `${school} \\enspace $\\cdot$ \\enspace ${degree}`;
  return school || degree || "";
}

export function mapResumeProfileCN(profile: ResumeProfileLike) {
  const basics = asRecord(profile.basics);
  const links = asArray(profile.links) as Record<string, unknown>[];
  const skills = asArray(profile.skills) as Record<string, unknown>[];
  const experiences = asArray(profile.experiences) as Record<string, unknown>[];
  const projects = asArray(profile.projects) as Record<string, unknown>[];
  const education = asArray(profile.education) as Record<string, unknown>[];

  const findLink = (label: string) =>
    links.find((item) =>
      toStringValue(item.label).toLowerCase().includes(label),
    );

  const linkedin = findLink("linkedin");
  const github = findLink("github");
  const websiteExplicit = findLink("portfolio") || findLink("website");
  const websiteFallback = links.find((item) => item !== linkedin && item !== github);
  const website = websiteExplicit || websiteFallback;

  // --- CN-specific header fields ---
  const identity = toStringValue(basics.identity).trim();
  const availabilityMonth = toStringValue(
    (basics as Record<string, unknown>).availabilityMonth,
  ).trim();

  const identityEscaped = identity ? escapeLatex(identity) : "";
  const availabilityPart =
    availabilityMonth.length > 0 ? `到岗：${escapeLatex(availabilityMonth)}` : "";

  const personalParts = [identityEscaped, availabilityPart].filter(
    (v) => v.length > 0,
  );
  const personalInfoLine =
    personalParts.length > 0 ? personalParts.join(" $\\cdot$ ") : "";

  const photoUrl = toStringValue(basics.photoUrl).trim();
  const photoBlock =
    photoUrl.length > 0
      ? `\\begin{tikzpicture}[remember picture, overlay]
\\node[anchor=north east, inner sep=0pt] at ([xshift=-1.5cm, yshift=-1.0cm]current page.north east) {\\includegraphics[height=2.6cm]{photo}};
\\end{tikzpicture}`
      : "";

  // --- Contact extras (WeChat / QQ) ---
  const contactExtraLine = "";

  // --- Links line for header ---
  const linkEntries: string[] = [];
  if (linkedin?.url && hasText(toStringValue(linkedin.url))) {
    linkEntries.push(
      `\\href{${escapeLatex(toStringValue(linkedin.url))}}{${escapeLatex(toStringValue(linkedin.label))}}`,
    );
  }
  if (github?.url && hasText(toStringValue(github.url))) {
    linkEntries.push(
      `\\href{${escapeLatex(toStringValue(github.url))}}{${escapeLatex(toStringValue(github.label))}}`,
    );
  }
  if (website?.url && hasText(toStringValue(website.url))) {
    linkEntries.push(
      `\\href{${escapeLatex(toStringValue(website.url))}}{${escapeLatex(toStringValue(website.label))}}`,
    );
  }
  const linksLine =
    linkEntries.length > 0
      ? linkEntries.map((entry) => ` $\\cdot$ ${entry}`).join("")
      : "";

  // --- Skills ---
  const skillGroups = skills.map((group) => ({
    label: escapeLatex(
      toStringValue(
        (group as Record<string, unknown>).category,
      ) || toStringValue((group as Record<string, unknown>).label),
    ),
    items: asArray(group.items).map((item) => escapeLatex(toStringValue(item))),
  }));

  // --- Experiences ---
  const experienceEntries = experiences.map((entry) => {
    const expLinks = asArray(entry.links)
      .map((item) => {
        const link = item as Record<string, unknown>;
        return {
          label: escapeLatex(toStringValue(link.label)),
          url: escapeLatex(toStringValue(link.url)),
        };
      })
      .filter((link) => hasText(link.label) && hasText(link.url))
      .slice(0, 2);

    const legacyLink = escapeLatex(toStringValue(entry.link)).trim();
    if (!expLinks.length && hasText(legacyLink)) {
      expLinks.push({ label: "Link", url: legacyLink });
    }

    return {
      location: escapeLatex(toStringValue(entry.location)),
      dates: escapeLatex(toStringValue(entry.dates)),
      title: escapeLatex(toStringValue(entry.title)),
      company: escapeLatex(toStringValue(entry.company)),
      links: expLinks,
      bullets: asArray(entry.bullets).map((item) =>
        escapeLatexWithBold(toStringValue(item)),
      ),
    };
  });

  // --- Projects ---
  const projectBlocks = projects
    .map((proj) => {
      const record = proj as Record<string, unknown>;
      const linksRaw = asArray(record.links) as Record<string, unknown>[];
      const legacyLink = toStringValue(record.link);
      const roleRaw = toStringValue(record.role);
      const stackRaw = toStringValue(record.stack || roleRaw);

      const projLinks = linksRaw
        .map((item) => ({
          label: escapeLatex(toStringValue(item.label)),
          url: escapeLatex(toStringValue(item.url)),
        }))
        .filter((item) => hasText(item.label) && hasText(item.url));

      if (!projLinks.length && hasText(legacyLink)) {
        projLinks.push({
          label: "Link",
          url: escapeLatex(legacyLink),
        });
      }

      return {
        name: escapeLatex(toStringValue(record.name)),
        location: escapeLatex(toStringValue(record.location)),
        dates: escapeLatex(toStringValue(record.dates)),
        stack: escapeLatex(stackRaw),
        links: projLinks,
        bullets: asArray(record.bullets).map((item) =>
          escapeLatexWithBold(toStringValue(item)),
        ),
      };
    })
    .filter((entry) => hasText(entry.name));

  // --- Education ---
  const educationEntries = education
    .map((edu) => {
      const record = edu as Record<string, unknown>;
      const location = escapeLatex(toStringValue(record.location)).trim();
      const dates = escapeLatex(toStringValue(record.dates)).trim();
      const schoolDegree = formatSchoolDegree(record.school, record.degree);
      const detail = escapeLatex(toStringValue(record.details)).trim();
      return { location, dates, schoolDegree, detail };
    })
    .filter((entry) => hasText(entry.schoolDegree));

  return {
    candidate: {
      name: escapeLatex(toStringValue(basics.fullName)),
      title: escapeLatex(toStringValue(basics.title)),
      email: escapeLatex(toStringValue(basics.email)),
      phone: escapeLatex(toStringValue(basics.phone)),
      linkedinUrl: linkedin?.url
        ? escapeLatex(toStringValue(linkedin.url))
        : undefined,
      linkedinText: linkedin?.label
        ? escapeLatex(toStringValue(linkedin.label))
        : undefined,
      githubUrl: github?.url
        ? escapeLatex(toStringValue(github.url))
        : undefined,
      githubText: github?.label
        ? escapeLatex(toStringValue(github.label))
        : undefined,
      websiteUrl: website?.url
        ? escapeLatex(toStringValue(website.url))
        : undefined,
      websiteText: website?.label
        ? escapeLatex(toStringValue(website.label))
        : undefined,
    },
    photoBlock,
    personalInfoLine,
    contactExtraLine,
    linksLine,
    summary: escapeLatexWithBold(toStringValue(profile.summary)),
    skills: skillGroups,
    experiences: experienceEntries,
    projects: projectBlocks,
    education: educationEntries,
  };
}
