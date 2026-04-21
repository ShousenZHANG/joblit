"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useToast } from "@/hooks/use-toast";
import { useGuide } from "@/app/GuideContext";
import { useResumeForm } from "./useResumeForm";
import { useResumePreview } from "./useResumePreview";
import { useResumeProfiles } from "./useResumeProfiles";
import type { UseResumeFormReturn } from "./useResumeForm";
import type { UseResumePreviewReturn } from "./useResumePreview";
import type { UseResumeProfilesReturn } from "./useResumeProfiles";
import { getSectionIds, type SectionId } from "./constants";

type ResumeContextValue = UseResumeFormReturn &
  UseResumePreviewReturn &
  UseResumeProfilesReturn & {
    activeSection: SectionId;
    setActiveSection: (section: SectionId) => void;
    previewOpen: boolean;
    setPreviewOpen: (open: boolean) => void;
    navCollapsed: boolean;
    setNavCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
    saving: boolean;
    handleSave: () => Promise<void>;
    locale: string;
    t: ReturnType<typeof useTranslations>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    isTaskHighlighted: (task: any) => boolean;
  };

const ResumeContext = createContext<ResumeContextValue | null>(null);

export function ResumeFormProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const { isTaskHighlighted, markTaskComplete } = useGuide();
  const t = useTranslations("resumeForm");
  const globalLocale = useLocale();
  const locale = globalLocale.startsWith("zh") ? "zh-CN" : "en-AU";

  const [activeSection, setActiveSection] = useState<SectionId>("personal");
  // Reset activeSection when locale changes if the current section doesn't
  // exist in the new locale's layout (e.g. "summary" doesn't exist in CN).
  const validSections = getSectionIds(locale);
  useEffect(() => {
    if (!validSections.includes(activeSection)) {
      setActiveSection("personal");
    }
  }, [locale, activeSection, validSections]);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);

  const form = useResumeForm(locale);

  const preview = useResumePreview({
    buildPayload: form.buildPayload,
    hasAnyContent: form.hasAnyContent,
    t: t as unknown as (key: string) => string,
    toast,
  });

  const profiles = useResumeProfiles({
    locale,
    applyProfileToDraft: form.applyProfileToDraft,
    resetDraft: form.resetDraft,
    setPdfUrl: preview.setPdfUrl,
    setPreviewStatus: preview.setPreviewStatus,
    setPreviewError: preview.setPreviewError,
    t: t as unknown as (key: string, values?: Record<string, string | number>) => string,
    toast,
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form.buildPayload("save"),
        profileId: profiles.selectedProfileId ?? undefined,
        name: profiles.profileName.trim() || undefined,
        setActive: true,
        locale,
      };
      const res = await fetch("/api/resume-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Save failed");
      const json = await res.json();
      profiles.hydrateFromResumeApi(json);
      toast({ title: t("toastSaved"), description: t("toastSavedDesc") });
      markTaskComplete("resume_setup");
      preview.schedulePreview(150);
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

  return (
    <ResumeContext.Provider
      value={{
        ...form,
        ...preview,
        ...profiles,
        activeSection,
        setActiveSection,
        previewOpen,
        setPreviewOpen,
        saving,
        handleSave,
        navCollapsed,
        setNavCollapsed,
        locale,
        t,
        isTaskHighlighted,
      }}
    >
      {children}
    </ResumeContext.Provider>
  );
}

export function useResumeContext() {
  const ctx = useContext(ResumeContext);
  if (!ctx) throw new Error("useResumeContext must be used inside ResumeFormProvider");
  return ctx;
}
