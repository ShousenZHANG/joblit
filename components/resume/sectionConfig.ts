import {
  Briefcase,
  FileText,
  FolderKanban,
  GraduationCap,
  User,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { SectionId } from "./constants";

/**
 * The identity of each section — icon and label key — shared by the rail and
 * the section headings so the two can never drift apart.
 */
export type SectionTranslationKey =
  | "personalInfo"
  | "summary"
  | "experience"
  | "projects"
  | "education"
  | "skills";

export interface SectionConfig {
  id: SectionId;
  tKey: SectionTranslationKey;
  icon: LucideIcon;
}

export const SECTION_CONFIG: readonly SectionConfig[] = [
  { id: "personal", tKey: "personalInfo", icon: User },
  { id: "summary", tKey: "summary", icon: FileText },
  { id: "experience", tKey: "experience", icon: Briefcase },
  { id: "projects", tKey: "projects", icon: FolderKanban },
  { id: "education", tKey: "education", icon: GraduationCap },
  { id: "skills", tKey: "skills", icon: Wrench },
];

export const SECTION_CONFIG_BY_ID = new Map(
  SECTION_CONFIG.map((section) => [section.id, section] as const),
);
