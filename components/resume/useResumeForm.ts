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
  ResumeProfilePayload,
  ReorderSection,
} from "./types";
import {
  emptyBasics,
  emptyExperience,
  emptyProject,
  emptyEducation,
  emptySkillGroup,
  defaultLinks,
} from "./constants";
import {
  hasContent,
  hasBullets,
  normalizeBullets,
  normalizeCommaItems,
  remapFocusedIndex,
  toSortableIndex,
} from "./utils";

export function useResumeForm(locale: string) {
  const [basics, setBasics] = useState<ResumeBasics>(emptyBasics);
  const [links, setLinks] = useState<ResumeLink[]>(defaultLinks);
  const [summary, setSummary] = useState("");
  const [experiences, setExperiences] = useState<ResumeExperience[]>([emptyExperience()]);
  const [projects, setProjects] = useState<ResumeProject[]>([emptyProject()]);
  const [education, setEducation] = useState<ResumeEducation[]>([emptyEducation()]);
  const [skills, setSkills] = useState<ResumeSkillGroup[]>([emptySkillGroup()]);
  const [expandedExperienceIndex, setExpandedExperienceIndex] = useState(0);
  const [expandedProjectIndex, setExpandedProjectIndex] = useState(0);

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
    setBasics(emptyBasics);
    setLinks(defaultLinks);
    setSummary("");
    setExperiences([emptyExperience()]);
    setProjects([emptyProject()]);
    setEducation([emptyEducation()]);
    setSkills([emptySkillGroup()]);
    setExpandedExperienceIndex(0);
    setExpandedProjectIndex(0);
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

      if (Array.isArray(profile.experiences) && profile.experiences.length > 0) {
        setExperiences(
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
              title: entry.title ?? "",
              company: entry.company ?? "",
              location: entry.location ?? "",
              dates: entry.dates ?? "",
              links: normalizedLinks,
              bullets:
                Array.isArray(entry.bullets) && entry.bullets.length > 0 ? entry.bullets : [""],
            };
          }),
        );
      } else {
        setExperiences([emptyExperience()]);
      }

      if (Array.isArray(profile.projects) && profile.projects.length > 0) {
        setProjects(
          profile.projects.map((entry) => ({
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
          })),
        );
      } else {
        setProjects([emptyProject()]);
      }

      if (Array.isArray(profile.education) && profile.education.length > 0) {
        setEducation(
          profile.education.map((entry) => ({
            school: entry.school ?? "",
            degree: entry.degree ?? "",
            location: entry.location ?? "",
            dates: entry.dates ?? "",
            details: entry.details ?? "",
          })),
        );
      } else {
        setEducation([emptyEducation()]);
      }

      if (Array.isArray(profile.skills) && profile.skills.length > 0) {
        const skillGroups = profile.skills.map((group) => {
          const source = group as { category?: string; label?: string; items?: string[] };
          return {
            category: source.category ?? source.label ?? "",
            itemsText:
              Array.isArray(source.items) && source.items.length > 0
                ? source.items.join(", ")
                : "",
          };
        });
        setSkills(skillGroups);
      } else {
        setSkills([emptySkillGroup()]);
      }

      setExpandedExperienceIndex(0);
      setExpandedProjectIndex(0);
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
    setExperiences((prev) => {
      const next = [...prev, emptyExperience()];
      setExpandedExperienceIndex(next.length - 1);
      return next;
    });
  }, []);

  const removeExperience = useCallback((index: number) => {
    setExperiences((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, idx) => idx !== index);
      setExpandedExperienceIndex((current) => {
        if (current === index) return Math.max(0, index - 1);
        if (current > index) return current - 1;
        return current;
      });
      return next;
    });
  }, []);

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
    setProjects((prev) => {
      const next = [...prev, emptyProject()];
      setExpandedProjectIndex(next.length - 1);
      return next;
    });
  }, []);

  const removeProject = useCallback((index: number) => {
    setProjects((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, idx) => idx !== index);
      setExpandedProjectIndex((current) => {
        if (current === index) return Math.max(0, index - 1);
        if (current > index) return current - 1;
        return current;
      });
      return next;
    });
  }, []);

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
    setEducation((prev) => [...prev, emptyEducation()]);
  }, []);

  const removeEducation = useCallback((index: number) => {
    setEducation((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== index) : prev));
  }, []);

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
    setSkills((prev) => [...prev, emptySkillGroup()]);
  }, []);

  const removeSkillGroup = useCallback((index: number) => {
    setSkills((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== index) : prev));
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
        setExpandedExperienceIndex((current) => remapFocusedIndex(current, from, to));
        return;
      }
      if (section === "project") {
        setProjects((prev) => {
          if (from >= prev.length || to >= prev.length) return prev;
          return arrayMove(prev, from, to);
        });
        setExpandedProjectIndex((current) => remapFocusedIndex(current, from, to));
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
      const cleanedLinks = links
        .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
        .filter((link) => link.label || link.url);

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

      const cleanedEducation = education.map((entry) => ({
        ...entry,
        details: entry.details?.trim() ?? "",
      }));

      const cleanedSkills = skills.map((group) => ({
        category: group.category.trim(),
        items: normalizeCommaItems(group.itemsText),
      }));

      const previewExperiences =
        mode === "preview"
          ? cleanedExperiences.filter(
              (entry) =>
                hasContent(entry.company) &&
                hasContent(entry.title) &&
                hasContent(entry.location) &&
                hasContent(entry.dates),
            )
          : cleanedExperiences;

      const previewProjects =
        mode === "preview"
          ? cleanedProjects.filter((entry) => hasContent(entry.name) && hasContent(entry.dates))
          : cleanedProjects;

      const previewEducation =
        mode === "preview"
          ? cleanedEducation.filter(
              (entry) =>
                hasContent(entry.school) && hasContent(entry.degree) && hasContent(entry.dates),
            )
          : cleanedEducation;

      const previewSkills =
        mode === "preview"
          ? cleanedSkills.filter(
              (group) => hasContent(group.category) && group.items.length > 0,
            )
          : cleanedSkills;

      return {
        locale,
        basics,
        links: cleanedLinks.length > 0 ? cleanedLinks : null,
        summary: summary.trim() || null,
        experiences: previewExperiences,
        projects: previewProjects,
        education: previewEducation,
        skills: previewSkills,
      };
    },
    [locale, basics, links, summary, experiences, projects, education, skills],
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

    return (
      basicsFilled ||
      linksFilled ||
      hasContent(summary) ||
      experienceFilled ||
      projectsFilled ||
      educationFilled ||
      skillsFilled
    );
  }, [basics, links, summary, experiences, projects, education, skills]);

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
    expandedExperienceIndex,
    setExpandedExperienceIndex,
    expandedProjectIndex,
    setExpandedProjectIndex,
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
