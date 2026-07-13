"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
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

/**
 * Three-state save indicator for the resume editor — mirrors the proven
 * tailor draft pattern (see app/(app)/jobs/[id]/tailor/useTailorDraft.ts
 * SaveStatus). "dirty" means the live form differs from the last saved
 * snapshot, so the SectionNav must NOT claim "Saved".
 */
type ResumeSaveState = "dirty" | "saving" | "saved";

type ResumeContextValue = UseResumeFormReturn &
  UseResumePreviewReturn &
  UseResumeProfilesReturn & {
    activeSection: SectionId;
    setActiveSection: (section: SectionId) => void;
    previewOpen: boolean;
    setPreviewOpen: (open: boolean) => void;
    saving: boolean;
    /** True when the live draft differs from the last persisted snapshot. */
    isDirty: boolean;
    /** Derived three-state status driving the SectionNav save indicator. */
    saveState: ResumeSaveState;
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

  const validSections = getSectionIds(locale);
  const [sectionState, setSectionState] = useState<{
    locale: string;
    activeSection: SectionId;
  }>(() => ({ locale, activeSection: "personal" }));
  // Keep the rendered section valid on the locale-changing render itself.
  // React permits this guarded prop/state adjustment and immediately retries
  // the render, avoiding the stale section + cascading effect render.
  const activeSection = validSections.includes(sectionState.activeSection)
    ? sectionState.activeSection
    : "personal";
  if (
    sectionState.locale !== locale ||
    sectionState.activeSection !== activeSection
  ) {
    setSectionState({ locale, activeSection });
  }
  const setActiveSection = (section: SectionId) => {
    setSectionState({ locale, activeSection: section });
  };

  const [previewOpen, setPreviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const form = useResumeForm(locale);

  // --- dirty tracking ---------------------------------------------------
  // Serialize the live 'save' payload once per form change. It is compared
  // with the last hydrated/persisted state snapshot below to derive isDirty.
  const liveSaveKey = useMemo(
    () => JSON.stringify(form.buildPayload("save")),
    // form.buildPayload is a useCallback keyed on all form state, so its
    // identity changes on every edit — depending on it recomputes per change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form.buildPayload],
  );
  const preview = useResumePreview({
    buildPayload: form.buildPayload,
    hasAnyContent: form.hasAnyContent,
    t: t as unknown as (key: string) => string,
    toast,
  });
  const { schedulePreview } = preview;

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

  // Re-baseline the "last saved" snapshot whenever the active version changes.
  // A hydrate (initial load, create, delete, switch) batches the new
  // activeProfileId with the freshly-applied draft, so on the render after a
  // hydrate `liveSaveKey` already reflects the loaded draft — capturing it
  // here marks the form clean. Keystrokes never touch activeProfileId, so the
  // snapshot stays put and edits register as dirty. Saving the SAME version
  // re-baselines explicitly in handleSave (activeProfileId may be unchanged).
  const { activeProfileId } = profiles;
  const [savedBaseline, setSavedBaseline] = useState(() => ({
    activeProfileId,
    snapshot: liveSaveKey,
  }));
  const baselineSnapshot =
    savedBaseline.activeProfileId === activeProfileId
      ? savedBaseline.snapshot
      : liveSaveKey;
  if (savedBaseline.activeProfileId !== activeProfileId) {
    setSavedBaseline({ activeProfileId, snapshot: liveSaveKey });
  }
  const isDirty = form.hasAnyContent && liveSaveKey !== baselineSnapshot;
  const saveState: ResumeSaveState = saving
    ? "saving"
    : isDirty
      ? "dirty"
      : "saved";

  // Whether the always-on desktop preview pane is on screen (md+). On mobile
  // the pane is hidden and the preview only lives inside the dialog, so we skip
  // costly PDF renders there unless the dialog is open.
  const [isPreviewPaneVisible, setIsPreviewPaneVisible] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => setIsPreviewPaneVisible(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Live preview: regenerate the PDF as the user edits (debounced 400ms).
  // schedulePreview dedups identical payloads and keeps the current PDF painted
  // during the fetch, so firing on every keystroke is cheap and flicker-free.
  // Gated to when a preview surface is actually visible — the desktop pane (md+)
  // or the open mobile dialog — so mobile editing with the dialog closed never
  // triggers a wasted render.
  //
  // Build + serialize the preview payload ONCE per keystroke and reuse it as
  // the effect key, then hand the same payload/payloadKey to schedulePreview so
  // it skips its internal rebuild+restringify (useResumePreview.ts:74-75).
  const livePreviewPayload = useMemo(
    () => (form.hasAnyContent ? form.buildPayload("preview") : null),
    // form.buildPayload identity tracks all form state (see liveSaveKey above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form.hasAnyContent, form.buildPayload],
  );
  const livePreviewKey = useMemo(
    () => (livePreviewPayload ? JSON.stringify(livePreviewPayload) : ""),
    [livePreviewPayload],
  );
  useEffect(() => {
    if (!livePreviewPayload || !livePreviewKey) return;
    if (!previewOpen && !isPreviewPaneVisible) return;
    schedulePreview(400, false, {
      payload: livePreviewPayload,
      payloadKey: livePreviewKey,
    });
  }, [
    livePreviewPayload,
    livePreviewKey,
    previewOpen,
    isPreviewPaneVisible,
    schedulePreview,
  ]);

  const handleSave = async () => {
    setSaving(true);
    // Snapshot the exact draft being persisted up front. On success this
    // becomes the new "last saved" baseline so the dirty indicator resets to
    // clean even when saving the same version (where activeProfileId — and
    // thus the re-baseline effect — does not change).
    const savedSnapshot = JSON.stringify(form.buildPayload("save"));
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
      setSavedBaseline({ activeProfileId, snapshot: savedSnapshot });
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

  // Beforeunload guard — warn on tab-close / hard navigation only while there
  // are unsaved edits or a save in flight, mirroring FetchClient/TailorClient.
  // The resume editor has no autosave, so without this an entire editing
  // session is silently lost on accidental close.
  useEffect(() => {
    if (!isDirty && !saving) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty, saving]);

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
        isDirty,
        saveState,
        handleSave,
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
