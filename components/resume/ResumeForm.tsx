
"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { ChevronDown, ChevronRight, GripVertical, MoveDown, MoveUp, Plus, Trash2, Download } from "lucide-react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useGuide } from "@/app/GuideContext";
import { useTranslations, useLocale } from "next-intl";

type ResumeBasics = {
  fullName: string;
  title: string;
  email: string;
  phone: string;
  photoUrl?: string;
  identity?: string;
  availabilityMonth?: string;
  wechat?: string;
  qq?: string;
};

type ResumeLink = {
  label: string;
  url: string;
};

type ResumeExperience = {
  location: string;
  dates: string;
  title: string;
  company: string;
  links: ResumeLink[];
  bullets: string[];
};

type ResumeProject = {
  name: string;
  location: string;
  stack: string;
  dates: string;
  links: ResumeLink[];
  bullets: string[];
};

type ResumeEducation = {
  school: string;
  degree: string;
  location: string;
  dates: string;
  details?: string;
};

type ResumeSkillGroup = {
  category: string;
  label?: string;
  itemsText: string;
};

type ResumeSkillPayload = {
  category: string;
  items: string[];
};

type ResumeProfilePayload = {
  id?: string;
  name?: string;
  locale?: string;
  basics?: ResumeBasics | null;
  links?: ResumeLink[] | null;
  summary?: string | null;
  experiences?: ResumeExperience[] | null;
  projects?: ResumeProject[] | null;
  education?: ResumeEducation[] | null;
  skills?: ResumeSkillPayload[] | null;
};

type ResumeProfileSummary = {
  id: string;
  name: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
  revision?: number;
};

const stepsEN = ["Personal info", "Summary", "Experience", "Projects", "Education", "Skills"] as const;
const stepsCN = ["个人信息", "工作经历", "项目经历", "教育背景", "技能/证书及其他"] as const;

const emptyBasics: ResumeBasics = {
  fullName: "",
  title: "",
  email: "",
  phone: "",
};

const emptyExperience = (): ResumeExperience => ({
  title: "",
  company: "",
  location: "",
  dates: "",
  links: [{ label: "", url: "" }],
  bullets: [""],
});

const emptyProject = (): ResumeProject => ({
  name: "",
  location: "",
  stack: "",
  dates: "",
  links: [{ label: "", url: "" }],
  bullets: [""],
});

const emptyEducation = (): ResumeEducation => ({
  school: "",
  degree: "",
  location: "",
  dates: "",
  details: "",
});

const emptySkillGroup = (): ResumeSkillGroup => ({
  category: "",
  itemsText: "",
});

const defaultLinks: ResumeLink[] = [
  { label: "LinkedIn", url: "" },
  { label: "GitHub", url: "" },
  { label: "Portfolio", url: "" },
];

function hasContent(value: string) {
  return value.trim().length > 0;
}

function hasBullets(items: string[]) {
  return items.some((item) => hasContent(item));
}

function normalizeBullets(items: string[]) {
  return items.map((item) => item.trim()).filter(Boolean);
}

function normalizeCommaItems(text: string) {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

type ReorderSection = "experience" | "project" | "education" | "skill";

function toSortableId(section: ReorderSection, index: number) {
  return `${section}:${index}`;
}

function toSortableIndex(id: string | number, section: ReorderSection) {
  const [idSection, indexText] = String(id).split(":");
  if (idSection !== section) return null;
  const index = Number(indexText);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function remapFocusedIndex(currentIndex: number, from: number, to: number) {
  if (currentIndex === from) return to;
  if (from < to && currentIndex > from && currentIndex <= to) return currentIndex - 1;
  if (to < from && currentIndex >= to && currentIndex < from) return currentIndex + 1;
  return currentIndex;
}

function SortableItem({
  id,
  children,
}: {
  id: string;
  children: (args: {
    dragHandleProps: HTMLAttributes<HTMLButtonElement>;
    isDragging: boolean;
  }) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? "opacity-75" : undefined}
    >
      {children({
        dragHandleProps: { ...attributes, ...listeners } as HTMLAttributes<HTMLButtonElement>,
        isDragging,
      })}
    </div>
  );
}

export function ResumeForm() {
  const { toast } = useToast();
  const { isTaskHighlighted, markTaskComplete } = useGuide();
  const t = useTranslations("resumeForm");
  const globalLocale = useLocale();
  const guideHighlightClass =
    "ring-2 ring-emerald-400 ring-offset-2 ring-offset-white shadow-[0_0_0_4px_rgba(16,185,129,0.18)]";
  const [currentStep, setCurrentStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewScheduledKeyRef = useRef<string | null>(null);
  const previewInFlightKeyRef = useRef<string | null>(null);
  const previewLatestKeyRef = useRef<string | null>(null);
  const [profiles, setProfiles] = useState<ResumeProfileSummary[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("Custom Blank");
  const [profileSwitching, setProfileSwitching] = useState(false);
  const [profileCreating, setProfileCreating] = useState(false);
  const [profileDeleting, setProfileDeleting] = useState(false);

  const locale = globalLocale.startsWith("zh") ? "zh-CN" : "en-AU";
  // Stable across renders per-locale so it can be safely used as a hook dep.
  const steps = useMemo(
    () => (locale === "zh-CN" ? stepsCN : stepsEN),
    [locale],
  );

  const [basics, setBasics] = useState<ResumeBasics>(emptyBasics);
  const [links, setLinks] = useState<ResumeLink[]>(defaultLinks);
  const [summary, setSummary] = useState("");
  const [experiences, setExperiences] = useState<ResumeExperience[]>([emptyExperience()]);
  const [projects, setProjects] = useState<ResumeProject[]>([emptyProject()]);
  const [education, setEducation] = useState<ResumeEducation[]>([emptyEducation()]);
  const [skills, setSkills] = useState<ResumeSkillGroup[]>([emptySkillGroup()]);
  const [expandedExperienceIndex, setExpandedExperienceIndex] = useState(0);
  const [expandedProjectIndex, setExpandedProjectIndex] = useState(0);
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const markdownRefs = useRef<
    Record<string, HTMLInputElement | HTMLTextAreaElement | null>
  >({});

  const registerMarkdownRef =
    (key: string) => (element: HTMLInputElement | HTMLTextAreaElement | null) => {
      markdownRefs.current[key] = element;
    };

  const applyBoldMarkdown = useCallback(
    (
      key: string,
      currentValue: string,
      onChange: (nextValue: string) => void,
    ) => {
      const field = markdownRefs.current[key];
      const start = field?.selectionStart ?? currentValue.length;
      const end = field?.selectionEnd ?? currentValue.length;
      const before = currentValue.slice(0, start);
      const selected = currentValue.slice(start, end);
      const after = currentValue.slice(end);
      const wrapped = `**${selected || "keyword"}**`;
      const nextValue = `${before}${wrapped}${after}`;
      const selectionStart = before.length + 2;
      const selectionEnd = selectionStart + (selected || "keyword").length;

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
    setCurrentStep(0);
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
      setLinks(Array.isArray(profile.links) && profile.links.length > 0 ? profile.links : defaultLinks);
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
              bullets: Array.isArray(entry.bullets) && entry.bullets.length > 0 ? entry.bullets : [""],
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
            stack: entry.stack ?? (("role" in entry ? (entry as { role?: string }).role : "") ?? ""),
            dates: entry.dates ?? "",
            links:
              Array.isArray(entry.links) && entry.links.length > 0
                ? entry.links.map((link) => ({
                    label: link.label ?? "",
                    url: link.url ?? "",
                  }))
                : (("link" in entry && (entry as { link?: string }).link
                    ? [{ label: "Link", url: (entry as { link?: string }).link ?? "" }]
                    : [{ label: "", url: "" }]) as ResumeLink[]),
            bullets: Array.isArray(entry.bullets) && entry.bullets.length > 0 ? entry.bullets : [""],
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
              Array.isArray(source.items) && source.items.length > 0 ? source.items.join(", ") : "",
          };
        });
        setSkills(skillGroups);
      } else {
        setSkills([emptySkillGroup()]);
      }

      setExpandedExperienceIndex(0);
      setExpandedProjectIndex(0);
      setCurrentStep(0);
    },
    [resetDraft],
  );

  const hydrateFromResumeApi = useCallback(
    (json: unknown) => {
      const record = (json ?? {}) as Record<string, unknown>;
      const nextProfiles = Array.isArray(record.profiles)
        ? (record.profiles as ResumeProfileSummary[])
        : [];
      const explicitActiveId =
        typeof record.activeProfileId === "string" ? record.activeProfileId : null;
      const inferredActiveId =
        nextProfiles.find((profile) => profile.isActive)?.id ??
        (nextProfiles.length > 0 ? nextProfiles[0].id : null);
      const nextActiveProfileId = explicitActiveId ?? inferredActiveId;

      setProfiles(nextProfiles);
      setActiveProfileId(nextActiveProfileId);
      setSelectedProfileId(nextActiveProfileId);

      const activeSummary = nextProfiles.find((profile) => profile.id === nextActiveProfileId) ?? null;
      setProfileName(activeSummary?.name ?? "Custom Blank");

      const activeProfile =
        (record.activeProfile as ResumeProfilePayload | null | undefined) ??
        (record.profile as ResumeProfilePayload | null | undefined) ??
        null;
      applyProfileToDraft(activeProfile);
    },
    [applyProfileToDraft],
  );

  useEffect(() => {
    let active = true;
    const load = async () => {
      const res = await fetch(`/api/resume-profile?locale=${locale}`);
      if (!res.ok) return;
      const json = await res.json();
      if (!active) return;
      hydrateFromResumeApi(json);
    };
    load();
    return () => {
      active = false;
    };
  }, [locale, hydrateFromResumeApi]);

  useEffect(() => {
    return () => {
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
      }
      previewAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [pdfUrl]);

  const isStepValid = useCallback(
    (stepIndex: number) => {
      const stepName = steps[stepIndex];
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
              hasContent(entry.name) &&
              hasContent(entry.dates) &&
              hasBullets(entry.bullets),
          )
        );
      }
      if (stepName === "Education" || stepName === "教育背景") {
        return (
          education.length > 0 &&
          education.every(
            (entry) =>
              hasContent(entry.school) &&
              hasContent(entry.degree) &&
              hasContent(entry.dates),
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
    [basics, summary, experiences, projects, education, skills, locale, steps],
  );

  const maxStep = useMemo(() => {
    let allowed = 0;
    while (allowed < steps.length && isStepValid(allowed)) {
      allowed += 1;
    }
    return allowed;
  }, [isStepValid, steps.length]);

  const canContinue = isStepValid(currentStep);
  const currentStepLabel = steps[currentStep];
  const progressPercent = ((currentStep + 1) / steps.length) * 100;

  const stepMeta = useMemo(
    () =>
      steps.map((label, index) => {
        const status = index === currentStep ? "current" : index < maxStep ? "complete" : "upcoming";
        return {
          label,
          index,
          status,
          available: index <= maxStep,
        };
      }),
    [currentStep, maxStep, steps],
  );

  const updateBasics = (field: keyof ResumeBasics, value: string) => {
    setBasics((prev) => ({ ...prev, [field]: value }));
  };

  const updateLink = (index: number, field: keyof ResumeLink, value: string) => {
    setLinks((prev) => prev.map((link, idx) => (idx === index ? { ...link, [field]: value } : link)));
  };

  const addLink = () => {
    setLinks((prev) => [...prev, { label: "", url: "" }]);
  };

  const removeLink = (index: number) => {
    setLinks((prev) => prev.filter((_, idx) => idx !== index));
  };

  const updateExperience = (
    index: number,
    field: keyof ResumeExperience,
    value: string,
  ) => {
    setExperiences((prev) =>
      prev.map((entry, idx) => (idx === index ? { ...entry, [field]: value } : entry)),
    );
  };

  const addExperience = () => {
    setExperiences((prev) => {
      const next = [...prev, emptyExperience()];
      setExpandedExperienceIndex(next.length - 1);
      return next;
    });
  };

  const removeExperience = (index: number) => {
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
  };

  const updateExperienceBullet = (expIndex: number, bulletIndex: number, value: string) => {
    setExperiences((prev) =>
      prev.map((entry, idx) => {
        if (idx !== expIndex) return entry;
        const bullets = entry.bullets.map((bullet, bIdx) => (bIdx === bulletIndex ? value : bullet));
        return { ...entry, bullets };
      }),
    );
  };

  const addExperienceBullet = (expIndex: number) => {
    setExperiences((prev) =>
      prev.map((entry, idx) =>
        idx === expIndex ? { ...entry, bullets: [...entry.bullets, ""] } : entry,
      ),
    );
  };

  const removeExperienceBullet = (expIndex: number, bulletIndex: number) => {
    setExperiences((prev) =>
      prev.map((entry, idx) => {
        if (idx !== expIndex) return entry;
        const nextBullets = entry.bullets.filter((_, bIdx) => bIdx !== bulletIndex);
        return { ...entry, bullets: nextBullets.length > 0 ? nextBullets : [""] };
      }),
    );
  };

  const updateProject = (index: number, field: keyof ResumeProject, value: string) => {
    setProjects((prev) =>
      prev.map((entry, idx) => (idx === index ? { ...entry, [field]: value } : entry)),
    );
  };

  const updateProjectLink = (
    projectIndex: number,
    linkIndex: number,
    field: keyof ResumeLink,
    value: string,
  ) => {
    setProjects((prev) =>
      prev.map((entry, idx) => {
        if (idx !== projectIndex) return entry;
        const links = entry.links.map((link, lIdx) =>
          lIdx === linkIndex ? { ...link, [field]: value } : link,
        );
        return { ...entry, links };
      }),
    );
  };

  const addProjectLink = (projectIndex: number) => {
    setProjects((prev) =>
      prev.map((entry, idx) =>
        idx === projectIndex ? { ...entry, links: [...entry.links, { label: "", url: "" }] } : entry,
      ),
    );
  };

  const removeProjectLink = (projectIndex: number, linkIndex: number) => {
    setProjects((prev) =>
      prev.map((entry, idx) => {
        if (idx !== projectIndex) return entry;
        const links = entry.links.filter((_, lIdx) => lIdx !== linkIndex);
        return { ...entry, links: links.length > 0 ? links : [{ label: "", url: "" }] };
      }),
    );
  };

  const addProject = () => {
    setProjects((prev) => {
      const next = [...prev, emptyProject()];
      setExpandedProjectIndex(next.length - 1);
      return next;
    });
  };

  const removeProject = (index: number) => {
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
  };

  const updateProjectBullet = (projIndex: number, bulletIndex: number, value: string) => {
    setProjects((prev) =>
      prev.map((entry, idx) => {
        if (idx !== projIndex) return entry;
        const bullets = entry.bullets.map((bullet, bIdx) => (bIdx === bulletIndex ? value : bullet));
        return { ...entry, bullets };
      }),
    );
  };

  const addProjectBullet = (projIndex: number) => {
    setProjects((prev) =>
      prev.map((entry, idx) =>
        idx === projIndex ? { ...entry, bullets: [...entry.bullets, ""] } : entry,
      ),
    );
  };

  const removeProjectBullet = (projIndex: number, bulletIndex: number) => {
    setProjects((prev) =>
      prev.map((entry, idx) => {
        if (idx !== projIndex) return entry;
        const nextBullets = entry.bullets.filter((_, bIdx) => bIdx !== bulletIndex);
        return { ...entry, bullets: nextBullets.length > 0 ? nextBullets : [""] };
      }),
    );
  };

  const updateEducation = (index: number, field: keyof ResumeEducation, value: string) => {
    setEducation((prev) =>
      prev.map((entry, idx) => (idx === index ? { ...entry, [field]: value } : entry)),
    );
  };

  const addEducation = () => {
    setEducation((prev) => [...prev, emptyEducation()]);
  };

  const removeEducation = (index: number) => {
    setEducation((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== index) : prev));
  };

  const updateSkillGroup = (index: number, field: keyof ResumeSkillGroup, value: string) => {
    setSkills((prev) =>
      prev.map((entry, idx) => (idx === index ? { ...entry, [field]: value } : entry)),
    );
  };

  const addSkillGroup = () => {
    setSkills((prev) => [...prev, emptySkillGroup()]);
  };

  const removeSkillGroup = (index: number) => {
    setSkills((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== index) : prev));
  };

  const updateExperienceLink = (
    expIndex: number,
    linkIndex: number,
    field: keyof ResumeLink,
    value: string,
  ) => {
    setExperiences((prev) =>
      prev.map((entry, idx) => {
        if (idx !== expIndex) return entry;
        const links = entry.links.map((link, lIdx) =>
          lIdx === linkIndex ? { ...link, [field]: value } : link,
        );
        return { ...entry, links };
      }),
    );
  };

  const addExperienceLink = (expIndex: number) => {
    setExperiences((prev) =>
      prev.map((entry, idx) => {
        if (idx !== expIndex) return entry;
        if (entry.links.length >= 2) return entry;
        return { ...entry, links: [...entry.links, { label: "", url: "" }] };
      }),
    );
  };

  const removeExperienceLink = (expIndex: number, linkIndex: number) => {
    setExperiences((prev) =>
      prev.map((entry, idx) => {
        if (idx !== expIndex) return entry;
        const links = entry.links.filter((_, lIdx) => lIdx !== linkIndex);
        return { ...entry, links: links.length > 0 ? links : [{ label: "", url: "" }] };
      }),
    );
  };

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
      const target = index + direction;
      moveSectionItem(section, index, target);
    },
    [moveSectionItem],
  );

  const onSectionDragEnd = useCallback(
    (section: ReorderSection, event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const from = toSortableIndex(active.id, section);
      const to = toSortableIndex(over.id, section);
      if (from === null || to === null) return;
      moveSectionItem(section, from, to);
    },
    [moveSectionItem],
  );

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
        const cleanedLinks = entry.links
          .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
          .filter((link) => link.label && link.url);

        return {
          name: entry.name.trim(),
          location: entry.location.trim(),
          stack: entry.stack.trim(),
          dates: entry.dates.trim(),
          links: cleanedLinks,
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
                hasContent(entry.school) &&
                hasContent(entry.degree) &&
                hasContent(entry.dates),
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

  const previewDraftPayload = useMemo(() => buildPayload("preview"), [buildPayload]);
  const previewDraftKey = useMemo(() => JSON.stringify(previewDraftPayload), [previewDraftPayload]);

  const schedulePreview = useCallback(
    (
      delayMs = 800,
      showEmptyToast = false,
      options?: { payload?: ResumeProfilePayload; payloadKey?: string; force?: boolean },
    ) => {
      if (!hasAnyContent) {
        if (showEmptyToast) {
          toast({
            title: t("toastAddDetailsFirst"),
            description: t("toastAddDetailsFirstDesc"),
            variant: "destructive",
          });
        }
        return;
      }
      const payload = options?.payload ?? buildPayload("preview");
      const payloadKey = options?.payloadKey ?? JSON.stringify(payload);
      const shouldSkip =
        !options?.force &&
        (payloadKey === previewScheduledKeyRef.current ||
          payloadKey === previewInFlightKeyRef.current ||
          payloadKey === previewLatestKeyRef.current);
      if (shouldSkip) {
        return;
      }

      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
      }
      previewAbortRef.current?.abort();
      const hasExistingPreview = Boolean(pdfUrl);
      if (!hasExistingPreview) {
        setPreviewStatus("loading");
      } else {
        setPreviewStatus("ready");
      }
      setPreviewError(null);
      previewScheduledKeyRef.current = payloadKey;

      const runPreview = async (attempt: number) => {
        previewScheduledKeyRef.current = null;
        previewInFlightKeyRef.current = payloadKey;
        const controller = new AbortController();
        previewAbortRef.current = controller;
        try {
          const res = await fetch("/api/resume-pdf", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });

          if (!res.ok) {
            let message = t("previewFailed");
            let code: string | undefined;
            if (res.headers.get("content-type")?.includes("application/json")) {
              const json = await res.json().catch(() => null);
              code = json?.error?.code;
              if (code === "LATEX_RENDER_CONFIG_MISSING") {
                message = t("previewNotConfigured");
              } else if (code === "LATEX_RENDER_TIMEOUT") {
                message = t("previewTimeout");
              } else if (code === "LATEX_RENDER_UNREACHABLE") {
                message = t("previewUnavailable");
              } else if (code === "LATEX_RENDER_FAILED") {
                message = t("previewCompileFailed");
              } else if (code === "NO_PROFILE") {
                message = t("previewSaveFirst");
              }
            }

            if (attempt === 0 && [502, 503, 504].includes(res.status)) {
              await new Promise((resolve) => setTimeout(resolve, 1200));
              return runPreview(1);
            }

            if (!hasExistingPreview) {
              setPreviewError(message);
              setPreviewStatus("error");
            }
            return;
          }

          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          setPdfUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
          setPreviewStatus("ready");
          previewLatestKeyRef.current = payloadKey;
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          if (!hasExistingPreview) {
            setPreviewError(t("previewFailed"));
            setPreviewStatus("error");
          }
        } finally {
          if (previewInFlightKeyRef.current === payloadKey) {
            previewInFlightKeyRef.current = null;
          }
          previewAbortRef.current = null;
        }
      };

      previewTimerRef.current = setTimeout(() => {
        runPreview(0);
      }, delayMs);
    },
    [buildPayload, hasAnyContent, pdfUrl, t, toast],
  );

  // Auto-generate (and live-update) the PDF preview whenever the draft
  // payload changes after the user starts editing. We deliberately skip
  // the very first effect run — that fire corresponds to the initial
  // profile hydration coming back from /api/resume-profile, not a real
  // user edit, and triggering schedulePreview there caused an unwanted
  // "preview spins as soon as the page loads" flash. The user will
  // bootstrap the first preview by clicking Refresh, hitting Save, or
  // editing any field. From the second `previewDraftKey` change onward
  // the live preview behaves exactly like Kickresume / Enhancv.
  const hasUserEditedRef = useRef(false);
  useEffect(() => {
    if (!hasAnyContent) return;
    if (!hasUserEditedRef.current) {
      hasUserEditedRef.current = true;
      return;
    }
    schedulePreview(450, false, {
      payload: previewDraftPayload,
      payloadKey: previewDraftKey,
    });
  }, [hasAnyContent, previewDraftKey, previewDraftPayload, schedulePreview]);

  const handleCreateProfile = async (mode: "copy" | "blank" = "copy") => {
    if (profileCreating || profileSwitching || profileDeleting) return;
    setProfileCreating(true);
    try {
      const res = await fetch("/api/resume-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          mode,
          sourceProfileId: activeProfileId ?? selectedProfileId ?? undefined,
          locale,
        }),
      });
      if (!res.ok) {
        const code = (await res.json().catch(() => null))?.error;
        if (code === "MIGRATION_REQUIRED") {
          throw new Error("MIGRATION_REQUIRED");
        }
        throw new Error("Create profile failed");
      }
      const json = await res.json();
      hydrateFromResumeApi(json);
      toast({
        title: t("toastNewVersionCreated"),
        description:
          mode === "copy"
            ? t("toastNewVersionCopyDesc")
            : t("toastNewVersionBlankDesc"),
      });
      setPdfUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setPreviewStatus("idle");
      setPreviewError(null);
    } catch {
      toast({
        title: t("toastCouldNotCreateVersion"),
        description:
          t("toastCouldNotCreateVersionDesc"),
        variant: "destructive",
      });
    } finally {
      setProfileCreating(false);
    }
  };

  const handleDeleteProfile = async () => {
    if (!selectedProfileId || profileDeleting || profileCreating || profileSwitching) return;
    if (profiles.length <= 1) {
      toast({
        title: t("toastCannotDeleteOnly"),
        description: t("toastCannotDeleteOnlyDesc"),
        variant: "destructive",
      });
      return;
    }

    const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);
    const confirmed = window.confirm(
      t("confirmDeleteVersion", { name: selectedProfile?.name ?? t("thisVersion") }),
    );
    if (!confirmed) return;

    setProfileDeleting(true);
    try {
      const res = await fetch("/api/resume-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", profileId: selectedProfileId, locale }),
      });
      if (!res.ok) {
        const code = (await res.json().catch(() => null))?.error;
        if (code === "LAST_PROFILE") {
          throw new Error("LAST_PROFILE");
        }
        throw new Error("Delete profile failed");
      }
      const json = await res.json();
      hydrateFromResumeApi(json);
      setPdfUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setPreviewStatus("idle");
      setPreviewError(null);
      toast({
        title: t("toastVersionDeleted"),
        description: t("toastVersionDeletedDesc"),
      });
    } catch (error) {
      toast({
        title:
          error instanceof Error && error.message === "LAST_PROFILE"
            ? t("toastCannotDeleteOnly")
            : t("toastCouldNotDeleteVersion"),
        description:
          error instanceof Error && error.message === "LAST_PROFILE"
            ? t("toastCannotDeleteOnlyDesc")
            : t("toastTryAgain"),
        variant: "destructive",
      });
    } finally {
      setProfileDeleting(false);
    }
  };

  const handleActivateProfile = async (profileId: string) => {
    if (
      !profileId ||
      profileId === activeProfileId ||
      profileSwitching ||
      profileCreating ||
      profileDeleting
    ) {
      return;
    }
    setProfileSwitching(true);
    try {
      const res = await fetch("/api/resume-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate", profileId, locale }),
      });
      if (!res.ok) {
        throw new Error("Activate profile failed");
      }
      const json = await res.json();
      hydrateFromResumeApi(json);
      setPdfUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setPreviewStatus("idle");
      setPreviewError(null);
      toast({
        title: t("toastSwitchedVersion"),
        description: t("toastSwitchedVersionDesc"),
      });
    } catch {
      toast({
        title: t("toastCouldNotSwitchVersion"),
        description: t("toastTryAgain"),
        variant: "destructive",
      });
      setSelectedProfileId(activeProfileId);
    } finally {
      setProfileSwitching(false);
    }
  };

  const handleNext = () => {
    if (!canContinue) return;
    setCurrentStep((prev) => Math.min(prev + 1, steps.length - 1));
    schedulePreview(250);
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  };

  const handleSave = async () => {
    if (!canContinue) return;
    setSaving(true);
    try {
      const payload = {
        ...buildPayload("save"),
        profileId: selectedProfileId ?? undefined,
        name: profileName.trim() || undefined,
        setActive: true,
        locale,
      };
      const res = await fetch("/api/resume-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error("Save failed");
      }

      const json = await res.json();
      hydrateFromResumeApi(json);
      toast({
        title: t("toastSaved"),
        description: t("toastSavedDesc"),
      });
      markTaskComplete("resume_setup");
      schedulePreview(150);
    } catch {
      toast({
        title: t("toastSaveFailed"),
        description: t("toastTryAgain"),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleOpenPreview = () => {
    if (!hasAnyContent) {
      schedulePreview(0, true);
      return;
    }
    setPreviewOpen(true);
    schedulePreview(0);
  };

  const previewUrl = useMemo(() => pdfUrl, [pdfUrl]);

  const renderPreviewFrame = (heightClass: string, framed = true) => (
    <div
      className={
        framed
          ? "relative rounded-lg border border-border bg-card/60 p-2"
          : "relative h-full w-full overflow-hidden rounded-none bg-card"
      }
    >
      {previewUrl ? (
        <iframe
          title="Resume preview"
          src={previewUrl}
          className={
            framed
              ? `${heightClass} w-full rounded-md border border-border bg-card`
              : `${heightClass} w-full`
          }
        />
      ) : (
        <div className={`flex ${heightClass} items-center justify-center text-xs text-muted-foreground`}>
          Click Preview to generate your PDF.
        </div>
      )}
      {previewStatus === "loading" ? (
        <div
          className={
            framed
              ? "absolute inset-0 flex items-center justify-center rounded-lg bg-background/70 text-xs text-muted-foreground"
              : "absolute inset-0 flex items-center justify-center bg-background/70 text-xs text-muted-foreground"
          }
        >
          Generating preview…
        </div>
      ) : null}
      {previewStatus === "error" ? (
        <div
          className={
            framed
              ? "absolute inset-x-2 bottom-2 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
              : "absolute inset-x-4 bottom-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
          }
        >
          <span>{previewError ?? t("previewFailed")}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => schedulePreview(0, false, { force: true })}
          >
            Retry
          </Button>
        </div>
          ) : null}
        </div>
      );

  const renderStep = () => {
    const stepName = steps[currentStep];

    if (stepName === "Personal info" || stepName === "个人信息") {
      return (
        <div className="space-y-5">
          <div>
            <h2 className="text-base font-semibold text-foreground">{t("personalInfo")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("personalInfoDesc")}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="resume-full-name">{t("fullName")}</Label>
              <Input
                id="resume-full-name"
                value={basics.fullName}
                onChange={(event) => updateBasics("fullName", event.target.value)}
                placeholder={t("fullNamePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="resume-title">{t("title")}</Label>
              <Input
                id="resume-title"
                value={basics.title}
                onChange={(event) => updateBasics("title", event.target.value)}
                placeholder={t("titlePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="resume-email">{t("email")}</Label>
              <Input
                id="resume-email"
                value={basics.email}
                onChange={(event) => updateBasics("email", event.target.value)}
                placeholder={t("emailPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="resume-phone">{t("phone")}</Label>
              <Input
                id="resume-phone"
                value={basics.phone}
                onChange={(event) => updateBasics("phone", event.target.value)}
                placeholder={t("phonePlaceholder")}
              />
            </div>
          </div>

          {locale === "zh-CN" && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>证件照</Label>
                <div className="flex items-center gap-2">
                  {basics.photoUrl ? (
                    <>
                      <Image
                        src={basics.photoUrl}
                        alt="证件照"
                        width={48}
                        height={64}
                        className="h-16 w-12 rounded border object-cover"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          fetch(`/api/resume-photo?url=${encodeURIComponent(basics.photoUrl!)}`, {
                            method: "DELETE",
                          });
                          updateBasics("photoUrl" as keyof ResumeBasics, "");
                        }}
                      >
                        删除
                      </Button>
                    </>
                  ) : (
                    <label className="cursor-pointer rounded-md border border-dashed px-4 py-2 text-sm text-muted-foreground hover:bg-muted/50">
                      点击上传
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={async (event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;
                          if (file.size > 2 * 1024 * 1024) {
                            toast({ title: "照片不能超过 2 MB", variant: "destructive" });
                            return;
                          }
                          try {
                            const res = await fetch("/api/resume-photo", {
                              method: "POST",
                              headers: { "content-type": file.type },
                              body: file,
                            });
                            if (!res.ok) throw new Error("upload failed");
                            const json = await res.json();
                            updateBasics("photoUrl" as keyof ResumeBasics, json.url);
                          } catch {
                            toast({ title: "上传失败，请重试", variant: "destructive" });
                          }
                          event.target.value = "";
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="resume-identity">身份</Label>
                <Input
                  id="resume-identity"
                  value={basics.identity ?? ""}
                  onChange={(event) => updateBasics("identity" as keyof ResumeBasics, event.target.value)}
                  placeholder="如: 大四学生 / 3年经验"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="resume-availability-month">到岗（YYYY-MM）</Label>
                <Input
                  id="resume-availability-month"
                  value={basics.availabilityMonth ?? ""}
                  onChange={(event) =>
                    updateBasics("availabilityMonth" as keyof ResumeBasics, event.target.value)
                  }
                  placeholder="如: 2026-03"
                />
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{t("links")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("linksDesc")}
                </p>
              </div>
              <Button type="button" variant="secondary" onClick={addLink}>
                {t("addLink")}
              </Button>
            </div>
            <div className="space-y-3">
              {links.map((link, index) => (
                <div key={`link-${index}`} className="grid gap-3 md:grid-cols-[180px,1fr,auto]">
                  <div className="space-y-2">
                    <Label htmlFor={`link-label-${index}`}>{t("label")}</Label>
                    <Input
                      id={`link-label-${index}`}
                      value={link.label}
                      onChange={(event) => updateLink(index, "label", event.target.value)}
                      placeholder={t("linkLabelPlaceholder")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`link-url-${index}`}>{t("url")}</Label>
                    <Input
                      id={`link-url-${index}`}
                      value={link.url}
                      onChange={(event) => updateLink(index, "url", event.target.value)}
                      placeholder={t("linkUrlPlaceholder")}
                    />
                  </div>
                  {links.length > 1 ? (
                    <div className="flex items-end">
                      <Button
                        type="button"
                        variant="ghost"
                        className="text-xs text-red-600 hover:text-red-600"
                        onClick={() => removeLink(index)}
                      >
                        {t("remove")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (stepName === "Summary") {
      return (
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">{t("summary")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("summaryDesc")}
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="resume-summary">{t("summary")}</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => applyBoldMarkdown("summary", summary, setSummary)}
              >
                {t("boldSelected")}
              </Button>
            </div>
            <Textarea
              id="resume-summary"
              ref={registerMarkdownRef("summary")}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder={t("summaryPlaceholder")}
              rows={5}
            />
          </div>
        </div>
      );
    }

    if (stepName === "Experience" || stepName === "工作经历") {
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground">{t("experience")}</h2>
              <p className="text-sm text-muted-foreground">{t("experienceDesc")}</p>
            </div>
            <Button type="button" variant="secondary" onClick={addExperience}>
              {t("addExperience")}
            </Button>
          </div>
          <div className="space-y-5">
            <DndContext
              sensors={dndSensors}
              collisionDetection={closestCenter}
              onDragEnd={(event) => onSectionDragEnd("experience", event)}
            >
              <SortableContext
                items={experiences.map((_, index) => toSortableId("experience", index))}
                strategy={verticalListSortingStrategy}
              >
                {experiences.map((entry, index) => (
                  <SortableItem key={`exp-${index}`} id={toSortableId("experience", index)}>
                    {({ dragHandleProps }) => (
                      <details
                        open={expandedExperienceIndex === index}
                        onToggle={(event) => {
                          if ((event.currentTarget as HTMLDetailsElement).open) {
                            setExpandedExperienceIndex(index);
                          }
                        }}
                        className="rounded-2xl border border-border bg-card/70 p-4"
                      >
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-1 py-1">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground">{t("experienceN", { n: index + 1 })}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {entry.title || entry.company ? `${entry.title || t("untitled")} · ${entry.company || t("company")}` : t("draft")}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Move experience up"
                              disabled={index === 0}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                moveByStep("experience", index, -1);
                              }}
                            >
                              <MoveUp className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Move experience down"
                              disabled={index === experiences.length - 1}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                moveByStep("experience", index, 1);
                              }}
                            >
                              <MoveDown className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Drag to reorder experience"
                              className="cursor-grab active:cursor-grabbing"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                              {...dragHandleProps}
                            >
                              <GripVertical className="h-4 w-4" />
                            </Button>
                            {experiences.length > 1 ? (
                              <Button
                                type="button"
                                variant="ghost"
                                className="text-xs text-red-600 hover:text-red-600"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  removeExperience(index);
                                }}
                              >
                                {t("remove")}
                              </Button>
                            ) : null}
                            {expandedExperienceIndex === index ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                        </summary>
                        <div className="space-y-3 pt-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`experience-title-${index}`}>{t("experienceTitle")}</Label>
                      <Input
                        id={`experience-title-${index}`}
                        value={entry.title}
                        onChange={(event) => updateExperience(index, "title", event.target.value)}
                        placeholder={t("experienceTitlePlaceholder")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`experience-company-${index}`}>{t("experienceCompany")}</Label>
                      <Input
                        id={`experience-company-${index}`}
                        value={entry.company}
                        onChange={(event) => updateExperience(index, "company", event.target.value)}
                        placeholder={t("experienceCompanyPlaceholder")}
                      />
                    </div>
                    {locale !== "zh-CN" && (
                      <div className="space-y-2">
                        <Label htmlFor={`experience-location-${index}`}>{t("experienceLocation")}</Label>
                        <Input
                          id={`experience-location-${index}`}
                          value={entry.location}
                          onChange={(event) => updateExperience(index, "location", event.target.value)}
                          placeholder={t("experienceLocationPlaceholder")}
                        />
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label htmlFor={`experience-dates-${index}`}>{t("experienceDates")}</Label>
                      <Input
                        id={`experience-dates-${index}`}
                        value={entry.dates}
                        onChange={(event) => updateExperience(index, "dates", event.target.value)}
                        placeholder={t("experienceDatesPlaceholder")}
                      />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>{t("experienceLinks")}</Label>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => addExperienceLink(index)}
                        disabled={entry.links.length >= 2}
                      >
                        {t("addLink")}
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {entry.links.map((link, linkIndex) => (
                        <div
                          key={`experience-${index}-link-${linkIndex}`}
                          className="grid gap-2 md:grid-cols-[1fr_2fr_auto]"
                        >
                          <Input
                            value={link.label}
                            onChange={(event) =>
                              updateExperienceLink(index, linkIndex, "label", event.target.value)
                            }
                            placeholder={t("expLinkLabelPlaceholder")}
                          />
                          <Input
                            value={link.url}
                            onChange={(event) =>
                              updateExperienceLink(index, linkIndex, "url", event.target.value)
                            }
                            placeholder={t("linkUrlPlaceholder")}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            className="text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => removeExperienceLink(index, linkIndex)}
                          >
                            {t("remove")}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>{t("experienceBullets")}</Label>
                      <Button type="button" variant="secondary" onClick={() => addExperienceBullet(index)}>
                        {t("addBullet")}
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {entry.bullets.map((bullet, bulletIndex) => (
                        <div key={`exp-${index}-bullet-${bulletIndex}`} className="flex gap-2">
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center justify-between">
                              <Label htmlFor={`experience-bullet-${index}-${bulletIndex}`}>{t("experienceBullet")}</Label>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  applyBoldMarkdown(
                                    `exp-bullet-${index}-${bulletIndex}`,
                                    bullet,
                                    (next) => updateExperienceBullet(index, bulletIndex, next),
                                  )
                                }
                              >
                                {t("boldSelected")}
                              </Button>
                            </div>
                            <Input
                              id={`experience-bullet-${index}-${bulletIndex}`}
                              ref={registerMarkdownRef(`exp-bullet-${index}-${bulletIndex}`)}
                              value={bullet}
                              onChange={(event) =>
                                updateExperienceBullet(index, bulletIndex, event.target.value)
                              }
                              placeholder={t("experienceBulletPlaceholder")}
                            />
                          </div>
                          <div className="flex items-end">
                            <Button
                              type="button"
                              variant="ghost"
                              className="text-xs text-muted-foreground hover:text-foreground"
                              onClick={() => removeExperienceBullet(index, bulletIndex)}
                            >
                              {t("remove")}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                      </details>
                    )}
                  </SortableItem>
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </div>
      );
    }

    if (stepName === "Projects" || stepName === "项目经历") {
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground">{t("projects")}</h2>
              <p className="text-sm text-muted-foreground">{t("projectsDesc")}</p>
            </div>
            <Button type="button" variant="secondary" onClick={addProject}>
              {t("addProject")}
            </Button>
          </div>
          <div className="space-y-5">
            <DndContext
              sensors={dndSensors}
              collisionDetection={closestCenter}
              onDragEnd={(event) => onSectionDragEnd("project", event)}
            >
              <SortableContext
                items={projects.map((_, index) => toSortableId("project", index))}
                strategy={verticalListSortingStrategy}
              >
                {projects.map((entry, index) => (
                  <SortableItem key={`project-${index}`} id={toSortableId("project", index)}>
                    {({ dragHandleProps }) => (
                      <details
                        open={expandedProjectIndex === index}
                        onToggle={(event) => {
                          if ((event.currentTarget as HTMLDetailsElement).open) {
                            setExpandedProjectIndex(index);
                          }
                        }}
                        className="rounded-2xl border border-border bg-card/70 p-4"
                      >
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-1 py-1">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground">{t("projectN", { n: index + 1 })}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {entry.name ? `${entry.name}${entry.stack ? ` · ${entry.stack}` : ""}` : t("draft")}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Move project up"
                              disabled={index === 0}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                moveByStep("project", index, -1);
                              }}
                            >
                              <MoveUp className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Move project down"
                              disabled={index === projects.length - 1}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                moveByStep("project", index, 1);
                              }}
                            >
                              <MoveDown className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Drag to reorder project"
                              className="cursor-grab active:cursor-grabbing"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                              {...dragHandleProps}
                            >
                              <GripVertical className="h-4 w-4" />
                            </Button>
                            {projects.length > 1 ? (
                              <Button
                                type="button"
                                variant="ghost"
                                className="text-xs text-red-600 hover:text-red-600"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  removeProject(index);
                                }}
                              >
                                {t("remove")}
                              </Button>
                            ) : null}
                            {expandedProjectIndex === index ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                        </summary>
                        <div className="space-y-3 pt-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`project-name-${index}`}>{t("projectName")}</Label>
                      <Input
                        id={`project-name-${index}`}
                        value={entry.name}
                        onChange={(event) => updateProject(index, "name", event.target.value)}
                        placeholder={t("projectNamePlaceholder")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`project-location-${index}`}>{t("projectLocation")}</Label>
                      <Input
                        id={`project-location-${index}`}
                        value={entry.location}
                        onChange={(event) => updateProject(index, "location", event.target.value)}
                        placeholder={t("projectLocationPlaceholder")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`project-dates-${index}`}>{t("projectDates")}</Label>
                      <Input
                        id={`project-dates-${index}`}
                        value={entry.dates}
                        onChange={(event) => updateProject(index, "dates", event.target.value)}
                        placeholder={t("projectDatesPlaceholder")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`project-stack-${index}`}>{t("techStack")}</Label>
                      <Input
                        id={`project-stack-${index}`}
                        value={entry.stack}
                        onChange={(event) => updateProject(index, "stack", event.target.value)}
                        placeholder={t("techStackPlaceholder")}
                      />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>{t("projectLinksOptional")}</Label>
                      <Button type="button" variant="secondary" onClick={() => addProjectLink(index)}>
                        {t("addLink")}
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {entry.links.map((link, linkIndex) => (
                        <div
                          key={`project-${index}-link-${linkIndex}`}
                          className="grid gap-2 md:grid-cols-[1fr_2fr_auto]"
                        >
                          <Input
                            value={link.label}
                            onChange={(event) =>
                              updateProjectLink(index, linkIndex, "label", event.target.value)
                            }
                            placeholder={t("projectLinkLabelPlaceholder")}
                          />
                          <Input
                            value={link.url}
                            onChange={(event) =>
                              updateProjectLink(index, linkIndex, "url", event.target.value)
                            }
                            placeholder={t("linkUrlPlaceholder")}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            className="text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => removeProjectLink(index, linkIndex)}
                          >
                            {t("remove")}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>{t("projectBullets")}</Label>
                      <Button type="button" variant="secondary" onClick={() => addProjectBullet(index)}>
                        {t("addBullet")}
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {entry.bullets.map((bullet, bulletIndex) => (
                        <div key={`project-${index}-bullet-${bulletIndex}`} className="flex gap-2">
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center justify-between">
                              <Label htmlFor={`project-bullet-${index}-${bulletIndex}`}>{t("projectBullet")}</Label>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  applyBoldMarkdown(
                                    `project-bullet-${index}-${bulletIndex}`,
                                    bullet,
                                    (next) => updateProjectBullet(index, bulletIndex, next),
                                  )
                                }
                              >
                                {t("boldSelected")}
                              </Button>
                            </div>
                            <Input
                              id={`project-bullet-${index}-${bulletIndex}`}
                              ref={registerMarkdownRef(`project-bullet-${index}-${bulletIndex}`)}
                              value={bullet}
                              onChange={(event) =>
                                updateProjectBullet(index, bulletIndex, event.target.value)
                              }
                              placeholder={t("projectBulletPlaceholder")}
                            />
                          </div>
                          <div className="flex items-end">
                            <Button
                              type="button"
                              variant="ghost"
                              className="text-xs text-muted-foreground hover:text-foreground"
                              onClick={() => removeProjectBullet(index, bulletIndex)}
                            >
                              {t("remove")}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                      </details>
                    )}
                  </SortableItem>
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </div>
      );
    }

    if (stepName === "Education" || stepName === "教育背景") {
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground">{t("education")}</h2>
              <p className="text-sm text-muted-foreground">{t("educationDesc")}</p>
            </div>
            <Button type="button" variant="secondary" onClick={addEducation}>
              {t("addEducation")}
            </Button>
          </div>
          <div className="space-y-5">
            <DndContext
              sensors={dndSensors}
              collisionDetection={closestCenter}
              onDragEnd={(event) => onSectionDragEnd("education", event)}
            >
              <SortableContext
                items={education.map((_, index) => toSortableId("education", index))}
                strategy={verticalListSortingStrategy}
              >
                {education.map((entry, index) => (
                  <SortableItem key={`education-${index}`} id={toSortableId("education", index)}>
                    {({ dragHandleProps }) => (
                      <div className="space-y-3 rounded-2xl border border-border bg-card/70 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">{t("educationN", { n: index + 1 })}</p>
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Move education up"
                              disabled={index === 0}
                              onClick={() => moveByStep("education", index, -1)}
                            >
                              <MoveUp className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Move education down"
                              disabled={index === education.length - 1}
                              onClick={() => moveByStep("education", index, 1)}
                            >
                              <MoveDown className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Drag to reorder education"
                              className="cursor-grab active:cursor-grabbing"
                              {...dragHandleProps}
                            >
                              <GripVertical className="h-4 w-4" />
                            </Button>
                            {education.length > 1 ? (
                              <Button
                                type="button"
                                variant="ghost"
                                className="text-xs text-red-600 hover:text-red-600"
                                onClick={() => removeEducation(index)}
                              >
                                {t("remove")}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={`education-school-${index}`}>{t("school")}</Label>
                    <Input
                      id={`education-school-${index}`}
                      value={entry.school}
                      onChange={(event) => updateEducation(index, "school", event.target.value)}
                      placeholder={t("schoolPlaceholder")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`education-degree-${index}`}>{t("degree")}</Label>
                    <Input
                      id={`education-degree-${index}`}
                      value={entry.degree}
                      onChange={(event) => updateEducation(index, "degree", event.target.value)}
                      placeholder={t("degreePlaceholder")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`education-location-${index}`}>{t("educationLocation")}</Label>
                    <Input
                      id={`education-location-${index}`}
                      value={entry.location}
                      onChange={(event) => updateEducation(index, "location", event.target.value)}
                      placeholder={t("educationLocationPlaceholder")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`education-dates-${index}`}>{t("educationDates")}</Label>
                    <Input
                      id={`education-dates-${index}`}
                      value={entry.dates}
                      onChange={(event) => updateEducation(index, "dates", event.target.value)}
                      placeholder={t("educationDatesPlaceholder")}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`education-details-${index}`}>{t("detailsOptional")}</Label>
                  <Input
                    id={`education-details-${index}`}
                    value={entry.details ?? ""}
                    onChange={(event) => updateEducation(index, "details", event.target.value)}
                    placeholder={t("detailsPlaceholder")}
                  />
                </div>
                      </div>
                    )}
                  </SortableItem>
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">{t("skills")}</h2>
            <p className="text-sm text-muted-foreground">{t("skillsDesc")}</p>
          </div>
          <Button type="button" variant="secondary" onClick={addSkillGroup}>
            {t("addGroup")}
          </Button>
        </div>
        <div className="space-y-5">
          <DndContext
            sensors={dndSensors}
            collisionDetection={closestCenter}
            onDragEnd={(event) => onSectionDragEnd("skill", event)}
          >
            <SortableContext
              items={skills.map((_, index) => toSortableId("skill", index))}
              strategy={verticalListSortingStrategy}
            >
              {skills.map((group, index) => (
                <SortableItem key={`skill-${index}`} id={toSortableId("skill", index)}>
                  {({ dragHandleProps }) => (
                    <div className="space-y-3 rounded-2xl border border-border bg-card/70 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-foreground">{t("groupN", { n: index + 1 })}</p>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Move skill group up"
                            disabled={index === 0}
                            onClick={() => moveByStep("skill", index, -1)}
                          >
                            <MoveUp className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Move skill group down"
                            disabled={index === skills.length - 1}
                            onClick={() => moveByStep("skill", index, 1)}
                          >
                            <MoveDown className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Drag to reorder skill group"
                            className="cursor-grab active:cursor-grabbing"
                            {...dragHandleProps}
                          >
                            <GripVertical className="h-4 w-4" />
                          </Button>
                          {skills.length > 1 ? (
                            <Button
                              type="button"
                              variant="ghost"
                              className="text-xs text-red-600 hover:text-red-600"
                              onClick={() => removeSkillGroup(index)}
                            >
                              {t("remove")}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`skill-label-${index}`}>{t("category")}</Label>
                        <Input
                          id={`skill-label-${index}`}
                          value={group.category}
                          onChange={(event) => updateSkillGroup(index, "category", event.target.value)}
                          placeholder={t("categoryPlaceholder")}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`skill-items-${index}`}>{t("itemsCommaSeparated")}</Label>
                        <Input
                          id={`skill-items-${index}`}
                          value={group.itemsText}
                          onChange={(event) => updateSkillGroup(index, "itemsText", event.target.value)}
                          placeholder={t("itemsPlaceholder")}
                        />
                      </div>
                    </div>
                  )}
                </SortableItem>
              ))}
            </SortableContext>
          </DndContext>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent
          className="h-[100dvh] w-[100vw] max-w-none overflow-hidden rounded-none p-0 sm:h-[92vh] sm:w-[98vw] sm:max-w-[min(98vw,1280px)] sm:rounded-lg"
          showCloseButton={false}
          data-testid="resume-preview-dialog"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{t("pdfPreview")}</DialogTitle>
            <DialogDescription>{t("pdfPreviewDesc")}</DialogDescription>
          </DialogHeader>
          <div className="flex h-full flex-col">
            <div className="flex h-11 items-center justify-end border-b border-border bg-background/90 px-3 gap-2">
              {pdfUrl && previewStatus === "ready" && (
                <a
                  href={pdfUrl}
                  download={(() => {
                    const fallback = locale === "zh-CN" ? "未命名简历" : "Unnamed_Resume";
                    if (!basics.fullName && !basics.title) return `${fallback}.pdf`;
                    const safeName = (basics.fullName || "").replace(/\s+/g, "_");
                    const safeTitle = (basics.title || "").replace(/\s+/g, "_");
                    const connector = safeName && safeTitle ? "_" : "";
                    return `${safeName}${connector}${safeTitle}.pdf`;
                  })()}
                  className="inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-xs font-medium text-emerald-700 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 disabled:pointer-events-none disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  {t("download")}
                </a>
              )}
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="sm">
                  {t("close")}
                </Button>
              </DialogClose>
            </div>
            <div className="flex-1 bg-card">
              {renderPreviewFrame("h-full", false)}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="space-y-6 lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start lg:gap-6 lg:space-y-0">
        <aside className="hidden lg:block lg:sticky lg:top-20">
          <div className="rounded-2xl border border-border bg-card/70 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("resumeSetup")}</p>
            <p className="mt-1 text-sm text-foreground/80">
              {t("stepOf", { current: currentStep + 1, total: steps.length })}
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-300 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <nav className="mt-4 space-y-2">
              {stepMeta.map((step) => (
                <button
                  key={step.label}
                  type="button"
                  onClick={() => (step.available ? setCurrentStep(step.index) : null)}
                  disabled={!step.available}
                  aria-current={step.status === "current" ? "step" : undefined}
                  className={`flex min-h-11 w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition ${
                    step.status === "current"
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : step.status === "complete"
                        ? "border-emerald-500/30 bg-emerald-500/10 text-foreground"
                        : "border-border bg-card text-muted-foreground"
                  } ${!step.available ? "opacity-50" : "hover:border-emerald-300"}`}
                >
                  <span>{step.label}</span>
                  <span className="text-xs">
                    {step.status === "complete" ? t("done") : step.status === "current" ? t("now") : ""}
                  </span>
                </button>
              ))}
            </nav>
          </div>
        </aside>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 lg:hidden">
            {steps.map((step, index) => {
              const isActive = index === currentStep;
              const isAvailable = index <= maxStep;
              return (
                <button
                  key={step}
                  type="button"
                  onClick={() => (isAvailable ? setCurrentStep(index) : null)}
                  disabled={!isAvailable}
                  className={`min-h-11 rounded-full border px-4 py-2 text-sm transition ${
                    isActive
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : "border-border bg-card text-muted-foreground"
                  } ${!isAvailable ? "opacity-50" : "hover:border-emerald-300"}`}
                >
                  {step}
                </button>
              );
            })}
          </div>

          <div className="rounded-2xl border border-border bg-card/70 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("masterResumeVersion")}</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <Label htmlFor="resume-profile-select" className="sr-only">
                {t("resumeVersion")}
              </Label>
              <select
                id="resume-profile-select"
                value={selectedProfileId ?? ""}
                onChange={(event) => {
                  const nextId = event.target.value || null;
                  setSelectedProfileId(nextId);
                  if (nextId) {
                    void handleActivateProfile(nextId);
                  }
                }}
                disabled={profileSwitching || profileCreating || profileDeleting}
                className="min-h-11 w-full flex-1 rounded-xl border border-input bg-card px-3 text-sm text-foreground shadow-sm transition hover:border-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 disabled:cursor-not-allowed disabled:bg-muted"
              >
                {profiles.length === 0 ? (
                  <option value="">{t("unsavedVersion")}</option>
                ) : null}
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                    {profile.id === activeProfileId ? ` (${t("active")})` : ""}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleCreateProfile("copy")}
                  disabled={profileCreating || profileSwitching || profileDeleting}
                >
                  <Plus className="h-4 w-4" />
                  {profileCreating ? t("creating") : t("newVersion")}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={t("moreVersionActions")}
                      disabled={profileCreating || profileSwitching || profileDeleting}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => void handleCreateProfile("copy")}>
                      {t("newVersionFromActive")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void handleCreateProfile("blank")}>
                      {t("newBlankVersion")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-rose-600 focus:text-rose-700"
                      onSelect={() => void handleDeleteProfile()}
                      disabled={profiles.length <= 1 || !selectedProfileId}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {t("deleteSelectedVersion")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <div className="mt-3 space-y-1">
              <Label htmlFor="resume-profile-name">{t("versionName")}</Label>
              <Input
                id="resume-profile-name"
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
                maxLength={80}
                placeholder={t("versionNamePlaceholder")}
                disabled={profileDeleting}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("versionCloneHint")}
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card/70 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("currentStep")}</p>
            <div className="mt-1 flex items-center justify-between gap-3">
              <p className="text-base font-semibold text-foreground">{currentStepLabel}</p>
              <p className="text-xs text-muted-foreground">
                {currentStep + 1}/{steps.length}
              </p>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-300 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          <div className="min-h-[420px] rounded-2xl border border-border bg-card/70 p-4 sm:min-h-[540px] sm:p-6">
            {renderStep()}
          </div>

          <div
            className="sticky bottom-2 z-20 rounded-2xl border border-border bg-background/95 p-3 shadow-sm backdrop-blur sm:bottom-3"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)" }}
            data-guide-anchor="resume_setup"
            data-testid="resume-action-bar"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" onClick={handleBack} disabled={currentStep === 0}>
                  {t("back")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleOpenPreview}
                  disabled={!hasAnyContent}
                >
                  {t("preview")}
                </Button>
              </div>
              {currentStep < steps.length - 1 ? (
                <Button type="button" onClick={handleNext} disabled={!canContinue}>
                  {t("next")}
                </Button>
              ) : (
                <Button
                  onClick={handleSave}
                  disabled={
                    !canContinue || saving || profileSwitching || profileCreating || profileDeleting
                  }
                  className={`edu-cta edu-cta--press ${
                    isTaskHighlighted("resume_setup") ? guideHighlightClass : ""
                  }`}
                  data-guide-highlight={isTaskHighlighted("resume_setup") ? "true" : "false"}
                >
                  {saving ? t("saving") : t("saveSelectedResume")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}




