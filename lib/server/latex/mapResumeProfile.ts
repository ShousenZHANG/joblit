import { escapeLatex, escapeLatexWithBold } from "./escapeLatex";
import { asRecord, asArray, toStringValue, hasText } from "@/lib/shared/utils/text";

type ResumeProfileLike = {
  summary?: string | null;
  basics?: unknown;
  links?: unknown;
  skills?: unknown;
  certifications?: unknown;
  experiences?: unknown;
  projects?: unknown;
  education?: unknown;
};

function formatSchoolDegree(schoolRaw: unknown, degreeRaw: unknown) {
  const school = escapeLatex(toStringValue(schoolRaw)).trim();
  const degree = escapeLatex(toStringValue(degreeRaw)).trim();
  if (school && degree) return `${school} -- ${degree}`;
  return school || degree || "";
}

function formatEduLocationDates(locationRaw: unknown, datesRaw: unknown) {
  const location = escapeLatex(toStringValue(locationRaw)).trim();
  const dates = escapeLatex(toStringValue(datesRaw)).trim();
  return {
    location,
    dates,
  };
}

export function mapResumeProfile(profile: ResumeProfileLike) {
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

  const projectBlocks = projects
    .map((proj) => {
      const record = proj as Record<string, unknown>;
      const linksRaw = asArray(record.links) as Record<string, unknown>[];
      const legacyLink = toStringValue(record.link);
      const roleRaw = toStringValue(record.role);
      const stackRaw = toStringValue(record.stack || roleRaw);

      const links = linksRaw
        .map((item) => ({
          label: escapeLatex(toStringValue(item.label)),
          url: escapeLatex(toStringValue(item.url)),
        }))
        .filter((item) => hasText(item.label) && hasText(item.url));

      if (!links.length && hasText(legacyLink)) {
        links.push({
          label: "Link",
          url: escapeLatex(legacyLink),
        });
      }

      return {
        name: escapeLatex(toStringValue(record.name)),
        location: escapeLatex(toStringValue(record.location)),
        dates: escapeLatex(toStringValue(record.dates)),
        stack: escapeLatex(stackRaw),
        links,
        bullets: asArray(record.bullets).map((item) => escapeLatexWithBold(toStringValue(item))),
      };
    })
    .filter((entry) => hasText(entry.name));

  const educationEntries = education
    .map((edu) => {
      const record = edu as Record<string, unknown>;
      const locationDates = formatEduLocationDates(record.location, record.dates);
      const schoolDegree = formatSchoolDegree(record.school, record.degree);
      const detail = escapeLatex(toStringValue(record.details)).trim();
      return {
        location: locationDates.location,
        dates: locationDates.dates,
        schoolDegree,
        detail,
      };
    })
    .filter((entry) => hasText(entry.schoolDegree));

  return {
    candidate: {
      name: escapeLatex(toStringValue(basics.fullName)),
      title: escapeLatex(toStringValue(basics.title)),
      email: escapeLatex(toStringValue(basics.email)),
      phone: escapeLatex(toStringValue(basics.phone)),
      linkedinUrl: linkedin?.url ? escapeLatex(toStringValue(linkedin.url)) : undefined,
      linkedinText: linkedin?.label ? escapeLatex(toStringValue(linkedin.label)) : undefined,
      githubUrl: github?.url ? escapeLatex(toStringValue(github.url)) : undefined,
      githubText: github?.label ? escapeLatex(toStringValue(github.label)) : undefined,
      websiteUrl: website?.url ? escapeLatex(toStringValue(website.url)) : undefined,
      websiteText: website?.label ? escapeLatex(toStringValue(website.label)) : undefined,
    },
    summary: escapeLatexWithBold(toStringValue(profile.summary)),
    skills: skills.map((group) => ({
      label: escapeLatex(toStringValue((group as Record<string, unknown>).category) || toStringValue((group as Record<string, unknown>).label)),
      items: asArray(group.items).map((item) => escapeLatex(toStringValue(item))),
    })),
    certifications: asArray(profile.certifications)
      .map((item) => {
        const record = item as Record<string, unknown>;
        return {
          name: escapeLatex(toStringValue(record.name)).trim(),
          url: escapeLatex(toStringValue(record.url)).trim(),
        };
      })
      .filter((cert) => hasText(cert.name))
      .slice(0, 6),
    experiences: experiences.map((entry) => {
      const links = asArray(entry.links)
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
      if (!links.length && hasText(legacyLink)) {
        links.push({ label: "Link", url: legacyLink });
      }

      return {
        location: escapeLatex(toStringValue(entry.location)),
        dates: escapeLatex(toStringValue(entry.dates)),
        title: escapeLatex(toStringValue(entry.title)),
        company: escapeLatex(toStringValue(entry.company)),
        links,
        bullets: asArray(entry.bullets).map((item) => escapeLatexWithBold(toStringValue(item))),
      };
    }),
    projects: projectBlocks,
    education: educationEntries,
  };
}





