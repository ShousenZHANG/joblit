import type { ResumeProfile } from "@/lib/shared/schemas/resumeProfile";

export interface FlatProfile {
  // Basics
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: string;
  currentTitle: string;
  summary: string;

  // Links
  linkedinUrl: string;
  githubUrl: string;
  portfolioUrl: string;
  websiteUrl: string;

  // Current employment
  currentCompany: string;

  // Education (first entry)
  schoolName: string;
  degree: string;
  graduationDates: string;

  // Skills (comma-separated)
  skills: string;

  // CN-specific
  wechat: string;
  qq: string;
  gender: string;
  age: string;
  identity: string;
  availabilityMonth: string;
}

function findLinkUrl(
  links: ResumeProfile["links"],
  ...labels: string[]
): string {
  if (!links) return "";
  const normalizedLabels = labels.map((l) => l.toLowerCase());
  const found = links.find((link) =>
    normalizedLabels.some(
      (label) =>
        link.label.toLowerCase().includes(label) ||
        link.url.toLowerCase().includes(label),
    ),
  );
  return found?.url ?? "";
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return { firstName: fullName, lastName: "" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

export function flattenProfile(profile: ResumeProfile): FlatProfile {
  const basics = profile.basics;
  const fullName = basics?.fullName ?? "";
  const { firstName, lastName } = splitName(fullName);

  const firstExperience = profile.experiences?.[0];
  const firstEducation = profile.education?.[0];

  const allSkills = (profile.skills ?? []).flatMap((s) => s.items);

  return {
    fullName,
    firstName,
    lastName,
    email: basics?.email ?? "",
    phone: basics?.phone ?? "",
    location: basics?.location ?? "",
    currentTitle: basics?.title ?? "",
    summary: profile.summary ?? "",

    linkedinUrl: findLinkUrl(profile.links, "linkedin"),
    githubUrl: findLinkUrl(profile.links, "github"),
    portfolioUrl: findLinkUrl(profile.links, "portfolio"),
    websiteUrl: findLinkUrl(profile.links, "website", "blog", "personal"),

    currentCompany: firstExperience?.company ?? "",

    schoolName: firstEducation?.school ?? "",
    degree: firstEducation?.degree ?? "",
    graduationDates: firstEducation?.dates ?? "",

    skills: allSkills.join(", "),

    wechat: basics?.wechat ?? "",
    qq: basics?.qq ?? "",
    gender: basics?.gender ?? "",
    age: basics?.age ?? "",
    identity: basics?.identity ?? "",
    availabilityMonth: basics?.availabilityMonth ?? "",
  };
}
