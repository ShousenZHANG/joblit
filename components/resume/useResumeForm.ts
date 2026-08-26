"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import type {
  ResumeBasics,
  ResumeLink,
  ResumeExperience,
  ResumeProject,
  ResumeEducation,
  ResumeSkillGroup,
  ResumeCertification,
  ResumeProfilePayload,
  ReorderSection,
} from "./types";
import {
  emptyBasics,
  emptyExperience,
  emptyProject,
  emptyEducation,
  emptySkillGroup,
  emptyCertification,
  defaultLinks,
  newRowId,
} from "./constants";
import {
  hasContent,
  hasBullets,
  normalizeBullets,
  normalizeCommaItems,
} from "./utils";

/** The four sections whose entries are repeatable and individually openable. */
export type ExpandableSection =
  | "experience"
  | "project"
  | "education"
  | "skill";

type ExpansionState = Readonly<Record<ExpandableSection, ReadonlySet<string>>>;

const emptyExpansion = (): ExpansionState => ({
  experience: new Set<string>(),
  project: new Set<string>(),
  education: new Set<string>(),
  skill: new Set<string>(),
});

/**
 * Open the first entry of each list, which is what the editor has always done
 * on a fresh load: an all-collapsed form reads as empty even when it is full.
 */
const initialExpansion = (rows: {
  experience: readonly { rowId: string }[];
  project: readonly { rowId: string }[];
  education: readonly { rowId: string }[];
  skill: readonly { rowId: string }[];
}): ExpansionState => ({
  experience: new Set(rows.experience[0] ? [rows.experience[0].rowId] : []),
  project: new Set(rows.project[0] ? [rows.project[0].rowId] : []),
  education: new Set(rows.education[0] ? [rows.education[0].rowId] : []),
  skill: new Set(rows.skill[0] ? [rows.skill[0].rowId] : []),
});

export function useResumeForm(locale: string) {
  const [basics, setBasics] = useState<ResumeBasics>(emptyBasics);
  const [links, setLinks] = useState<ResumeLink[]>(defaultLinks);
  const [summary, setSummary] = useState("");
  const [experiences, setExperiences] = useState<ResumeExperience[]>([emptyExperience()]);
  const [projects, setProjects] = useState<ResumeProject[]>([emptyProject()]);
  const [education, setEducation] = useState<ResumeEducation[]>([emptyEducation()]);
  const [skills, setSkills] = useState<ResumeSkillGroup[]>([emptySkillGroup()]);
  // No seeded placeholder row: most profiles carry no certifications, and an
  // empty row would read as a demand rather than an option.
  const [certifications, setCertifications] = useState<ResumeCertification[]>([]);
  /**
   * Which repeatable entries are open, per list section, keyed by the row's
   * stable `rowId`.
   *
   * Two changes from the original single-index model. Entries no longer close
   * each other: comparing two roles meant reopening one, reading it, and
   * reopening the other, which is the shape of the work this editor exists
   * for. And identity moved from position to `rowId`, so a drag or a delete
   * needs no index remapping at all — the old `remapFocusedIndex` arithmetic
   * (and every off-by-one it could carry) simply has nothing left to do.
   */
  const [expandedRowIds, setExpandedRowIds] = useState<
    Readonly<Record<ExpandableSection, ReadonlySet<string>>>
  >(() => emptyExpansion());

  const toggleRowExpanded = useCallback(
    (section: ExpandableSection, rowId: string) => {
      setExpandedRowIds((prev) => {
        const next = new Set(prev[section]);
        if (next.has(rowId)) next.delete(rowId);
        else next.add(rowId);
        return { ...prev, [section]: next };
      });
    },
    [],
  );

  const collapseAllRows = useCallback((section: ExpandableSection) => {
    setExpandedRowIds((prev) => ({ ...prev, [section]: new Set<string>() }));
  }, []);

  /** Open a row without touching the others — used when one is just added. */
  const expandRow = useCallback((section: ExpandableSection, rowId: string) => {
    setExpandedRowIds((prev) => ({
      ...prev,
      [section]: new Set(prev[section]).add(rowId),
    }));
  }, []);

  const forgetRow = useCallback((section: ExpandableSection, rowId: string) => {
    setExpandedRowIds((prev) => {
      if (!prev[section].has(rowId)) return prev;
      const next = new Set(prev[section]);
      next.delete(rowId);
      return { ...prev, [section]: next };
    });
  }, []);

  const markdownRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({});

  const registerMarkdownRef =
    (key: string) => (element: HTMLInputElement | HTMLTextAreaElement | null) => {
      markdownRefs.current[key] = element;
    };

  const applyBoldMarkdown = useCallback(
    (key: string, currentValue: string, onChange: (nextValue: string) => void) => {
      const field = markdownRefs.current[key];
      const start = field?.selectionStart ?? currentValue.length;
      const end = field?.selectionEnd ?? currentValue.length;
      const before = currentValue.slice(0, start);
      const selected = currentValue.slice(start, end);
      const after = currentValue.slice(end);

      // Toggle: if selection is already wrapped in **, unwrap it
      const alreadyBold =
        start >= 2 &&
        end + 2 <= currentValue.length &&
        currentValue.slice(start - 2, start) === "**" &&
        currentValue.slice(end, end + 2) === "**";

      let nextValue: string;
      let selectionStart: number;
      let selectionEnd: number;

      if (alreadyBold && selected.length > 0) {
        // Unbold: remove the ** markers around the selection
        nextValue =
          currentValue.slice(0, start - 2) +
          selected +
          currentValue.slice(end + 2);
        selectionStart = start - 2;
        selectionEnd = selectionStart + selected.length;
      } else {
        // Bold: wrap selection in **
        const text = selected || "keyword";
        nextValue = `${before}**${text}**${after}`;
        selectionStart = before.length + 2;
        selectionEnd = selectionStart + text.length;
      }

      onChange(nextValue);
      requestAnimationFrame(() => {
        const nextField = markdownRefs.current[key];
        if (!nextField) return;
        nextField.focus();
        nextField.setSelectionRange(selectionStart, selectionEnd);
      });
    },
    [],
  );

  const resetDraft = useCallback(() => {
    const experience = emptyExperience();
    const project = emptyProject();
    const educationEntry = emptyEducation();
    const skill = emptySkillGroup();
    setBasics(emptyBasics);
    setLinks(defaultLinks);
    setSummary("");
    setExperiences([experience]);
    setProjects([project]);
    setEducation([educationEntry]);
    setSkills([skill]);
    setExpandedRowIds(
      initialExpansion({
        experience: [experience],
        project: [project],
        education: [educationEntry],
        skill: [skill],
      }),
    );
  }, []);

  const applyProfileToDraft = useCallback(
    (profile: ResumeProfilePayload | null) => {
      if (!profile) {
        resetDraft();
        return;
      }

      const rawBasics = (profile.basics ?? emptyBasics) as Record<string, unknown>;
      const sanitizedBasics: ResumeBasics = {
        fullName: typeof rawBasics.fullName === "string" ? rawBasics.fullName : "",
        title: typeof rawBasics.title === "string" ? rawBasics.title : "",
        email: typeof rawBasics.email === "string" ? rawBasics.email : "",
        phone: typeof rawBasics.phone === "string" ? rawBasics.phone : "",
        photoUrl: typeof rawBasics.photoUrl === "string" ? rawBasics.photoUrl : undefined,
        identity: typeof rawBasics.identity === "string" ? rawBasics.identity : undefined,
        availabilityMonth:
          typeof rawBasics.availabilityMonth === "string" ? rawBasics.availabilityMonth : undefined,
        wechat: typeof rawBasics.wechat === "string" ? rawBasics.wechat : undefined,
        qq: typeof rawBasics.qq === "string" ? rawBasics.qq : undefined,
      };
      setBasics(sanitizedBasics);
      setLinks(
        Array.isArray(profile.links) && profile.links.length > 0 ? profile.links : defaultLinks,
      );
      setSummary(profile.summary ?? "");

      // Rows are captured before they are set so the initial expansion can be
      // keyed on the ids that were just minted for them.
      let experienceRows: ResumeExperience[];
      if (Array.isArray(profile.experiences) && profile.experiences.length > 0) {
        experienceRows =
          profile.experiences.map((entry) => {
            const source = entry as ResumeExperience & { links?: ResumeLink[] };
            const normalizedLinks =
              Array.isArray(source.links) && source.links.length > 0
                ? source.links.slice(0, 2).map((link) => ({
                    label: link.label ?? "",
                    url: link.url ?? "",
                  }))
                : [{ label: "", url: "" }];
            return {
              rowId: newRowId(),
              title: entry.title ?? "",
              company: entry.company ?? "",
              location: entry.location ?? "",
              dates: entry.dates ?? "",
              links: normalizedLinks,
              bullets:
                Array.isArray(entry.bullets) && entry.bullets.length > 0 ? entry.bullets : [""],
            };
          });
      } else {
        experienceRows = [emptyExperience()];
      }
      setExperiences(experienceRows);

      let projectRows: ResumeProject[];
      if (Array.isArray(profile.projects) && profile.projects.length > 0) {
        projectRows =
          profile.projects.map((entry) => ({
            rowId: newRowId(),
            name: entry.name ?? "",
            location: entry.location ?? "",
            stack:
              entry.stack ??
              (("role" in entry ? (entry as { role?: string }).role : "") ?? ""),
            dates: entry.dates ?? "",
            links:
              Array.isArray(entry.links) && entry.links.length > 0
                ? entry.links.map((link) => ({
                    label: link.label ?? "",
                    url: link.url ?? "",
                  }))
                : (("link" in entry && (entry as { link?: string }).link
                    ? [
                        {
                          label: "Link",
                          url: (entry as { link?: string }).link ?? "",
                        },
                      ]
                    : [{ label: "", url: "" }]) as ResumeLink[]),
            bullets:
              Array.isArray(entry.bullets) && entry.bullets.length > 0 ? entry.bullets : [""],
          }));
      } else {
        projectRows = [emptyProject()];
      }
      setProjects(projectRows);

      let educationRows: ResumeEducation[];
      if (Array.isArray(profile.education) && profile.education.length > 0) {
        educationRows = profile.education.map((entry) => ({
          rowId: newRowId(),
          school: entry.school ?? "",
          degree: entry.degree ?? "",
          location: entry.location ?? "",
          dates: entry.dates ?? "",
          details: entry.details ?? "",
        }));
      } else {
        educationRows = [emptyEducation()];
      }
      setEducation(educationRows);

      let skillRows: ResumeSkillGroup[];
      if (Array.isArray(profile.skills) && profile.skills.length > 0) {
        skillRows = profile.skills.map((group) => {
          const source = group as { category?: string; label?: string; items?: string[] };
          return {
            rowId: newRowId(),
            category: source.category ?? source.label ?? "",
            itemsText:
              Array.isArray(source.items) && source.items.length > 0
                ? source.items.join(", ")
                : "",
          };
        });
      } else {
        skillRows = [emptySkillGroup()];
      }
      setSkills(skillRows);

      setCertifications(
        Array.isArray(profile.certifications)
          ? profile.certifications.map((cert) => ({
              rowId: newRowId(),
              name: cert.name ?? "",
              url: cert.url ?? "",
            }))
          : [],
      );

      setExpandedRowIds(
        initialExpansion({
          experience: experienceRows,
          project: projectRows,
          education: educationRows,
          skill: skillRows,
        }),
      );
    },
    [resetDraft],
  );

  // --- basics / links ---
  const updateBasics = useCallback((field: keyof ResumeBasics, value: string) => {
    setBasics((prev) => ({ ...prev, [field]: value }));
  }, []);

  const updateLink = useCallback((index: number, field: keyof ResumeLink, value: string) => {
    setLinks((prev) =>
      prev.map((link, idx) => (idx === index ? { ...link, [field]: value } : link)),
    );
  }, []);

  const addLink = useCallback(() => {
    setLinks((prev) => [...prev, { label: "", url: "" }]);
  }, []);

  const removeLink = useCallback((index: number) => {
    setLinks((prev) => prev.filter((_, idx) => idx !== index));
  }, []);

  // --- experiences ---
  const updateExperience = useCallback(
    (index: number, field: keyof ResumeExperience, value: string) => {
      setExperiences((prev) =>
        prev.map((entry, idx) => (idx === index ? { ...entry, [field]: value } : entry)),
      );
    },
    [],
  );

  const addExperience = useCallback(() => {
    const row = emptyExperience();
    setExperiences((prev) => [...prev, row]);
    expandRow("experience", row.rowId);
  }, [expandRow]);

  const removeExperience = useCallback(
    (index: number) => {
      setExperiences((prev) => {
        if (prev.length <= 1) return prev;
        const removed = prev[index];
        if (removed) forgetRow("experience", removed.rowId);
        return prev.filter((_, idx) => idx !== index);
      });
    },
    [forgetRow],
  );

  const updateExperienceBullet = useCallback(
    (expIndex: number, bulletIndex: number, value: string) => {
      setExperiences((prev) =>
        prev.map((entry, idx) => {
          if (idx !== expIndex) return entry;
          const bullets = entry.bullets.map((bullet, bIdx) =>
            bIdx === bulletIndex ? value : bullet,
          );
          return { ...entry, bullets };
        }),
      );
    },
    [],
  );

  const addExperienceBullet = useCallback((expIndex: number) => {
    setExperiences((prev) =>
      prev.map((entry, idx) =>
        idx === expIndex ? { ...entry, bullets: [...entry.bullets, ""] } : entry,
      ),
    );
  }, []);

  const removeExperienceBullet = useCallback((expIndex: number, bulletIndex: number) => {
    setExperiences((prev) =>
      prev.map((entry, idx) => {
        if (idx !== expIndex) return entry;
        const nextBullets = entry.bullets.filter((_, bIdx) => bIdx !== bulletIndex);
        return { ...entry, bullets: nextBullets.length > 0 ? nextBullets : [""] };
      }),
    );
  }, []);

  const updateExperienceLink = useCallback(
    (expIndex: number, linkIndex: number, field: keyof ResumeLink, value: string) => {
      setExperiences((prev) =>
        prev.map((entry, idx) => {
          if (idx !== expIndex) return entry;
          const links = entry.links.map((link, lIdx) =>
            lIdx === linkIndex ? { ...link, [field]: value } : link,
          );
          return { ...entry, links };
        }),
      );
    },
    [],
  );

  const addExperienceLink = useCallback((expIndex: number) => {
    setExperiences((prev) =>
      prev.map((entry, idx) => {
        if (idx !== expIndex) return entry;
        if (entry.links.length >= 2) return entry;
        return { ...entry, links: [...entry.links, { label: "", url: "" }] };
      }),
    );
  }, []);

  const removeExperienceLink = useCallback((expIndex: number, linkIndex: number) => {
    setExperiences((prev) =>
      prev.map((entry, idx) => {
        if (idx !== expIndex) return entry;
        const links = entry.links.filter((_, lIdx) => lIdx !== linkIndex);
        return { ...entry, links: links.length > 0 ? links : [{ label: "", url: "" }] };
      }),
    );
  }, []);

  // --- projects ---
  const updateProject = useCallback(
    (index: number, field: keyof ResumeProject, value: string) => {
      setProjects((prev) =>
        prev.map((entry, idx) => (idx === index ? { ...entry, [field]: value } : entry)),
      );
    },
    [],
  );

  const addProject = useCallback(() => {
    const row = emptyProject();
    setProjects((prev) => [...prev, row]);
    expandRow("project", row.rowId);
  }, [expandRow]);

  const removeProject = useCallback(
    (index: number) => {
      setProjects((prev) => {
        if (prev.length <= 1) return prev;
        const removed = prev[index];
        if (removed) forgetRow("project", removed.rowId);
        return prev.filter((_, idx) => idx !== index);
      });
    },
    [forgetRow],
  );

  const updateProjectBullet = useCallback(
    (projIndex: number, bulletIndex: number, value: string) => {
      setProjects((prev) =>
        prev.map((entry, idx) => {
          if (idx !== projIndex) return entry;
          const bullets = entry.bullets.map((bullet, bIdx) =>
            bIdx === bulletIndex ? value : bullet,
          );
          return { ...entry, bullets };
        }),
      );
    },
    [],
  );

  const addProjectBullet = useCallback((projIndex: number) => {
    setProjects((prev) =>
      prev.map((entry, idx) =>
        idx === projIndex ? { ...entry, bullets: [...entry.bullets, ""] } : entry,
      ),
    );
  }, []);

  const removeProjectBullet = useCallback((projIndex: number, bulletIndex: number) => {
    setProjects((prev) =>
      prev.map((entry, idx) => {
        if (idx !== projIndex) return entry;
        const nextBullets = entry.bullets.filter((_, bIdx) => bIdx !== bulletIndex);
        return { ...entry, bullets: nextBullets.length > 0 ? nextBullets : [""] };
      }),
    );
  }, []);

  const updateProjectLink = useCallback(
    (projectIndex: number, linkIndex: number, field: keyof ResumeLink, value: string) => {
      setProjects((prev) =>
        prev.map((entry, idx) => {
          if (idx !== projectIndex) return entry;
          const links = entry.links.map((link, lIdx) =>
            lIdx === linkIndex ? { ...link, [field]: value } : link,
          );
          return { ...entry, links };
        }),
      );
    },
    [],
  );

  const addProjectLink = useCallback((projectIndex: number) => {
    setProjects((prev) =>
      prev.map((entry, idx) =>
        idx === projectIndex
          ? { ...entry, links: [...entry.links, { label: "", url: "" }] }
          : entry,
      ),
    );
  }, []);

  const removeProjectLink = useCallback((projectIndex: number, linkIndex: number) => {
    setProjects((prev) =>
      prev.map((entry, idx) => {
        if (idx !== projectIndex) return entry;
        const links = entry.links.filter((_, lIdx) => lIdx !== linkIndex);
        return { ...entry, links: links.length > 0 ? links : [{ label: "", url: "" }] };
      }),
    );
  }, []);

  // --- education ---
  const updateEducation = useCallback(
    (index: number, field: keyof ResumeEducation, value: string) => {
      setEducation((prev) =>
        prev.map((entry, idx) => (idx === index ? { ...entry, [field]: value } : entry)),
      );
    },
    [],
  );

  const addEducation = useCallback(() => {
    const row = emptyEducation();
    setEducation((prev) => [...prev, row]);
    expandRow("education", row.rowId);
  }, [expandRow]);

  const removeEducation = useCallback(
    (index: number) => {
      setEducation((prev) => {
        if (prev.length <= 1) return prev;
        const removed = prev[index];
        if (removed) forgetRow("education", removed.rowId);
        return prev.filter((_, idx) => idx !== index);
      });
    },
    [forgetRow],
  );

  // --- skills ---
  const updateSkillGroup = useCallback(
    (index: number, field: keyof ResumeSkillGroup, value: string) => {
      setSkills((prev) =>
        prev.map((entry, idx) => (idx === index ? { ...entry, [field]: value } : entry)),
      );
    },
    [],
  );

  const addSkillGroup = useCallback(() => {
    const row = emptySkillGroup();
    setSkills((prev) => [...prev, row]);
    expandRow("skill", row.rowId);
  }, [expandRow]);

  const removeSkillGroup = useCallback(
    (index: number) => {
      setSkills((prev) => {
        if (prev.length <= 1) return prev;
        const removed = prev[index];
        if (removed) forgetRow("skill", removed.rowId);
        return prev.filter((_, idx) => idx !== index);
      });
    },
    [forgetRow],
  );

  // --- certifications ---
  const updateCertification = useCallback(
    (index: number, field: "name" | "url", value: string) => {
      setCertifications((prev) =>
        prev.map((entry, idx) => (idx === index ? { ...entry, [field]: value } : entry)),
      );
    },
    [],
  );

  const addCertification = useCallback(() => {
    setCertifications((prev) => [...prev, emptyCertification()]);
  }, []);

  const removeCertification = useCallback((index: number) => {
    setCertifications((prev) => prev.filter((_, idx) => idx !== index));
  }, []);

  // --- reorder ---
  const moveSectionItem = useCallback(
    (section: ReorderSection, from: number, to: number) => {
      if (from === to || from < 0 || to < 0) return;
      if (section === "experience") {
        setExperiences((prev) => {
          if (from >= prev.length || to >= prev.length) return prev;
          return arrayMove(prev, from, to);
        });
        // No expansion bookkeeping: rows are tracked by rowId, which a
        // reorder does not change.
        return;
      }
      if (section === "project") {
        setProjects((prev) => {
          if (from >= prev.length || to >= prev.length) return prev;
          return arrayMove(prev, from, to);
        });
        return;
      }
      if (section === "education") {
        setEducation((prev) => {
          if (from >= prev.length || to >= prev.length) return prev;
          return arrayMove(prev, from, to);
        });
        return;
      }
      setSkills((prev) => {
        if (from >= prev.length || to >= prev.length) return prev;
        return arrayMove(prev, from, to);
      });
    },
    [],
  );

  const moveByStep = useCallback(
    (section: ReorderSection, index: number, direction: -1 | 1) => {
      moveSectionItem(section, index, index + direction);
    },
    [moveSectionItem],
  );

  // --- payload ---
  const buildPayload = useCallback(
    (mode: "preview" | "save"): ResumeProfilePayload => {
      // A link needs BOTH a label and a url to be persistable — ResumeLinkSchema
      // requires url() so the default seed `{ label: "LinkedIn", url: "" }` (and
      // any half-filled row) would 400 the save/preview render. Require both,
      // matching how experience/project links are already filtered.
      const cleanedLinks = links
        .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
        .filter((link) => link.label && link.url);

      const cleanedExperiences = experiences.map((entry) => {
        const cleanedExperienceLinks = entry.links
          .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
          .filter((link) => link.label && link.url)
          .slice(0, 2);
        return {
          title: entry.title.trim(),
          company: entry.company.trim(),
          location: entry.location.trim(),
          dates: entry.dates.trim(),
          links: cleanedExperienceLinks,
          bullets: normalizeBullets(entry.bullets),
        };
      });

      const cleanedProjects = projects.map((entry) => {
        const pLinks = entry.links
          .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
          .filter((link) => link.label && link.url);
        return {
          name: entry.name.trim(),
          location: entry.location.trim(),
          stack: entry.stack.trim(),
          dates: entry.dates.trim(),
          links: pLinks,
          bullets: normalizeBullets(entry.bullets),
        };
      });

      // Field-by-field (not a spread) so the client-only rowId never leaks
      // into the API payload or the dirty-tracking snapshot.
      const cleanedEducation = education.map((entry) => ({
        school: entry.school.trim(),
        degree: entry.degree.trim(),
        location: entry.location.trim(),
        dates: entry.dates.trim(),
        details: entry.details?.trim() ?? "",
      }));

      const cleanedSkills = skills.map((group) => ({
        category: group.category.trim(),
        items: normalizeCommaItems(group.itemsText),
      }));

      // preview: keep only fully-renderable entries (all key fields present).
      // save: keep anything with ANY content, dropping the fully-empty seeded
      // placeholder rows that untouched sections carry — those would otherwise
      // fail the required-field schema and 400 the whole save. Partially filled
      // rows are kept (not silently dropped on re-hydrate) so the user never
      // loses typed data; completing or removing them clears the save error.
      const previewExperiences =
        mode === "preview"
          ? cleanedExperiences.filter(
              (entry) =>
                hasContent(entry.company) &&
                hasContent(entry.title) &&
                hasContent(entry.location) &&
                hasContent(entry.dates),
            )
          : cleanedExperiences.filter(
              (entry) =>
                hasContent(entry.title) ||
                hasContent(entry.company) ||
                hasContent(entry.location) ||
                hasContent(entry.dates) ||
                entry.bullets.length > 0 ||
                entry.links.length > 0,
            );

      const previewProjects =
        mode === "preview"
          ? cleanedProjects.filter((entry) => hasContent(entry.name) && hasContent(entry.dates))
          : cleanedProjects.filter(
              (entry) =>
                hasContent(entry.name) ||
                hasContent(entry.location) ||
                hasContent(entry.stack) ||
                hasContent(entry.dates) ||
                entry.bullets.length > 0 ||
                entry.links.length > 0,
            );

      const previewEducation =
        mode === "preview"
          ? cleanedEducation.filter(
              (entry) =>
                hasContent(entry.school) && hasContent(entry.degree) && hasContent(entry.dates),
            )
          : cleanedEducation.filter(
              (entry) =>
                hasContent(entry.school) ||
                hasContent(entry.degree) ||
                hasContent(entry.location) ||
                hasContent(entry.dates) ||
                hasContent(entry.details),
            );

      const previewSkills =
        mode === "preview"
          ? cleanedSkills.filter(
              (group) => hasContent(group.category) && group.items.length > 0,
            )
          : cleanedSkills.filter(
              (group) => hasContent(group.category) || group.items.length > 0,
            );

      // A certification is renderable with just a name; the schema rejects a
      // nameless row, so save keeps only rows with a name too — a URL-only
      // row would 400 the whole save.
      const cleanedCertifications = certifications
        .map((cert) => ({ name: cert.name.trim(), url: cert.url.trim() }))
        .filter((cert) => hasContent(cert.name));

      return {
        locale,
        basics,
        links: cleanedLinks.length > 0 ? cleanedLinks : null,
        summary: summary.trim() || null,
        experiences: previewExperiences,
        projects: previewProjects,
        education: previewEducation,
        skills: previewSkills,
        certifications: cleanedCertifications,
      };
    },
    [locale, basics, links, summary, experiences, projects, education, skills, certifications],
  );

  const hasAnyContent = useMemo(() => {
    const basicsFilled =
      hasContent(basics.fullName) ||
      hasContent(basics.title) ||
      hasContent(basics.email) ||
      hasContent(basics.phone);
    const linksFilled = links.some((link) => hasContent(link.url));
    const experienceFilled = experiences.some(
      (entry) =>
        hasContent(entry.title) ||
        hasContent(entry.company) ||
        hasContent(entry.location) ||
        hasContent(entry.dates) ||
        hasBullets(entry.bullets),
    );
    const projectsFilled = projects.some(
      (entry) =>
        hasContent(entry.name) ||
        hasContent(entry.stack) ||
        hasContent(entry.location) ||
        hasContent(entry.dates) ||
        entry.links.some((link) => hasContent(link.label) || hasContent(link.url)) ||
        hasBullets(entry.bullets),
    );
    const educationFilled = education.some(
      (entry) =>
        hasContent(entry.school) ||
        hasContent(entry.degree) ||
        hasContent(entry.location) ||
        hasContent(entry.dates),
    );
    const skillsFilled = skills.some(
      (group) => hasContent(group.category) || hasContent(group.itemsText),
    );
    const certificationsFilled = certifications.some(
      (cert) => hasContent(cert.name) || hasContent(cert.url),
    );

    return (
      basicsFilled ||
      linksFilled ||
      hasContent(summary) ||
      experienceFilled ||
      projectsFilled ||
      educationFilled ||
      skillsFilled ||
      certificationsFilled
    );
  }, [basics, links, summary, experiences, projects, education, skills, certifications]);

  const isStepValid = useCallback(
    (stepName: string) => {
      if (stepName === "Personal info" || stepName === "个人信息") {
        return (
          hasContent(basics.fullName) &&
          hasContent(basics.title) &&
          hasContent(basics.email) &&
          hasContent(basics.phone)
        );
      }
      if (stepName === "Summary") {
        return hasContent(summary);
      }
      if (stepName === "Experience" || stepName === "工作经历") {
        const requireLocation = locale !== "zh-CN";
        return (
          experiences.length > 0 &&
          experiences.every((entry) => {
            const baseOk =
              hasContent(entry.company) &&
              hasContent(entry.title) &&
              hasContent(entry.dates) &&
              hasBullets(entry.bullets);
            if (!baseOk) return false;
            return requireLocation ? hasContent(entry.location) : true;
          })
        );
      }
      if (stepName === "Projects" || stepName === "项目经历") {
        return (
          projects.length > 0 &&
          projects.every(
            (entry) =>
              hasContent(entry.name) && hasContent(entry.dates) && hasBullets(entry.bullets),
          )
        );
      }
      if (stepName === "Education" || stepName === "教育背景") {
        return (
          education.length > 0 &&
          education.every(
            (entry) =>
              hasContent(entry.school) && hasContent(entry.degree) && hasContent(entry.dates),
          )
        );
      }
      if (stepName === "Skills" || stepName === "技能/证书及其他") {
        return (
          skills.length > 0 &&
          skills.every(
            (group) =>
              hasContent(group.category) && normalizeCommaItems(group.itemsText).length > 0,
          )
        );
      }
      return false;
    },
    [basics, summary, experiences, projects, education, skills, locale],
  );

  return {
    // state
    basics,
    links,
    summary,
    setSummary,
    experiences,
    projects,
    education,
    skills,
    expandedRowIds,
    toggleRowExpanded,
    collapseAllRows,
    // basics / links
    updateBasics,
    updateLink,
    addLink,
    removeLink,
    // experiences
    updateExperience,
    addExperience,
    removeExperience,
    updateExperienceBullet,
    addExperienceBullet,
    removeExperienceBullet,
    updateExperienceLink,
    addExperienceLink,
    removeExperienceLink,
    // projects
    updateProject,
    addProject,
    removeProject,
    updateProjectBullet,
    addProjectBullet,
    removeProjectBullet,
    updateProjectLink,
    addProjectLink,
    removeProjectLink,
    // education
    updateEducation,
    addEducation,
    removeEducation,
    // skills
    updateSkillGroup,
    addSkillGroup,
    removeSkillGroup,
    // certifications
    certifications,
    updateCertification,
    addCertification,
    removeCertification,
    // reorder
    moveSectionItem,
    moveByStep,
    // payload
    buildPayload,
    hasAnyContent,
    resetDraft,
    applyProfileToDraft,
    // markdown
    applyBoldMarkdown,
    registerMarkdownRef,
    // validation
    isStepValid,
  };
}

export type UseResumeFormReturn = ReturnType<typeof useResumeForm>;
