"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  useSyncExternalStore,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useTranslations, useLocale } from "next-intl";
import { useToast } from "@/hooks/use-toast";
import { useGuide } from "@/app/GuideContext";
import { useResumeAutosave, type AutosaveStatus } from "./useResumeAutosave";
import { useResumeForm } from "./useResumeForm";
import { useResumePreview } from "./useResumePreview";
import { useResumeProfiles } from "./useResumeProfiles";
import type { UseResumeFormReturn } from "./useResumeForm";
import type { UseResumePreviewReturn } from "./useResumePreview";
import type { UseResumeProfilesReturn } from "./useResumeProfiles";
import { getSectionIds, type SectionId } from "./constants";

/**
 * Per-section fill state, powering the quiet ticks on the section rail. It
 * answers exactly one question — "is there anything in this section yet?" —
 * and deliberately stops there: no percentage, no score, no nagging. The
 * sections that stay empty read as neutral, never as failures.
 */
export type SectionCompletion = Record<SectionId, boolean>;

/**
 * Delay between a commit (a field losing focus, a section change) and the
 * compile. Long enough to coalesce a blur with the section change it caused,
 * short enough that the refresh still feels like a direct consequence of
 * finishing the field.
 */
const PREVIEW_COMMIT_DELAY_MS = 120;
/**
 * How long the user has to stop typing before the preview refreshes itself.
 * Long enough to sit out a normal inter-word pause, short enough that
 * finishing a sentence and looking up finds the picture already changing.
 */
const PREVIEW_TYPING_DELAY_MS = 1500;
/** Where the editor was left. Per-browser, not per-account: it is a cursor,
 *  not part of the resume, and syncing it would fight between two open tabs. */
const LAST_SECTION_KEY = "joblit.resume.lastSection";

/** localStorage does not change under this tab, so there is nothing to
 *  subscribe to; useSyncExternalStore is here for its server/client snapshot
 *  split, not for reactivity. */
const subscribeToNothing = () => () => {};
const readStoredSection = (): string | null => {
  try {
    return window.localStorage.getItem(LAST_SECTION_KEY);
  } catch {
    // Private mode or a blocked store: fall back to the default section.
    return null;
  }
};
const readNoStoredSection = (): string | null => null;

type ResumeContextValue = UseResumeFormReturn &
  UseResumePreviewReturn &
  UseResumeProfilesReturn & {
    /** The section currently under the scroll position (drives the rail). */
    activeSection: SectionId;
    /** 0-based position of the active section in the locale order. */
    activeSectionIndex: number;
    sectionCount: number;
    /** Scrolls the form column to a section and marks it active. */
    setActiveSection: (section: SectionId) => void;
    /** Highlights a section without scrolling — used by the scroll spy. */
    setActiveSectionQuietly: (section: SectionId) => void;
    /** Sections register their scroll anchor here for the rail's scrollspy. */
    registerSectionNode: (section: SectionId, node: HTMLElement | null) => void;
    /** Live anchor map. A ref so registration never triggers a render; the spy
     *  reads it from an effect, which runs after every ref has attached. */
    sectionNodesRef: React.RefObject<Map<SectionId, HTMLElement>>;
    collapsedSections: ReadonlySet<SectionId>;
    toggleSectionCollapsed: (section: SectionId) => void;
    sectionCompletion: SectionCompletion;
    previewOpen: boolean;
    setPreviewOpen: (open: boolean) => void;
    /** True when the draft has moved on from the PDF currently on screen. */
    hasUnpreviewedChanges: boolean;
    saving: boolean;
    /** True when the live draft differs from the last persisted snapshot. */
    isDirty: boolean;
    autosaveStatus: AutosaveStatus;
    /** Epoch ms of the last successful save; null before the first one. */
    autosaveLastSavedAt: number | null;
    /** Force a save now; resolves false when it failed (caller must not discard). */
    autosaveFlush: () => Promise<boolean>;
    autosaveRetry: () => void;
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
  // `activeSection` is which section the editor is on: from `lg` up it is the
  // one section rendered, below `lg` it is the scroll position the spy reports.
  // Purely derived against the locale's section list — no render-phase state
  // adjustment — so a locale switch that drops a section (CN has no Summary)
  // simply falls back to the first one.
  //
  // Resuming where the user left off matters more in focus mode than it did in
  // the single scroll: the landing section is now the whole screen, so always
  // opening on Personal info would mean re-navigating every session.
  //
  // The stored cursor is read through useSyncExternalStore rather than an
  // effect. Restoring it in an effect meant a setState during the first commit
  // — a cascading render, and the lint rule that forbids it is right. This
  // gives the server "no stored value" and the client the real one, so
  // hydration matches and React swaps in the restored section itself.
  const storedSection = useSyncExternalStore(
    subscribeToNothing,
    readStoredSection,
    readNoStoredSection,
  );
  // An explicit choice outranks the stored one for the rest of the session.
  const [chosenSection, setRawActiveSection] = useState<SectionId | null>(null);
  const rawActiveSection =
    chosenSection ??
    (storedSection && (validSections as readonly string[]).includes(storedSection)
      ? (storedSection as SectionId)
      : "personal");
  const activeSection = validSections.includes(rawActiveSection)
    ? rawActiveSection
    : validSections[0];

  useEffect(() => {
    if (chosenSection === null) return;
    try {
      window.localStorage.setItem(LAST_SECTION_KEY, activeSection);
    } catch {
      // Nothing to do — losing the cursor is not worth surfacing.
    }
  }, [chosenSection, activeSection]);

  /** Position of the active section, for the focus-mode pager. */
  const activeSectionIndex = Math.max(0, validSections.indexOf(activeSection));
  const sectionCount = validSections.length;

  // Scroll anchors, registered by each rendered section. A ref (not state)
  // because registration happens during layout and must not re-render.
  const sectionNodesRef = useRef(new Map<SectionId, HTMLElement>());
  const registerSectionNode = useCallback(
    (section: SectionId, node: HTMLElement | null) => {
      if (node) sectionNodesRef.current.set(section, node);
      else sectionNodesRef.current.delete(section);
    },
    [],
  );

  // Not hand-memoized: only click handlers call this, never an effect
  // dependency, and a manual useCallback here defeats the compiler's own
  // memoization of the provider.
  const setActiveSection = (section: SectionId) => {
    setRawActiveSection(section);
    const node = sectionNodesRef.current.get(section);
    node?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  };

  // Collapse is per-section and opt-in: everything starts open, because the
  // whole point of the single-scroll layout is seeing the resume at once.
  const [collapsedSections, setCollapsedSections] = useState<ReadonlySet<SectionId>>(
    () => new Set<SectionId>(),
  );
  const toggleSectionCollapsed = useCallback((section: SectionId) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }, []);

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
    resetPreview: preview.resetPreview,
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
  //
  // The baseline is keyed on locale as well as the profile id. `locale` is
  // part of the save payload, so switching languages changed liveSaveKey and
  // marked the untouched draft dirty — autosave then fired with the PREVIOUS
  // locale's content and profileId under the NEW locale, before that locale's
  // profile had even finished loading. Re-baselining on the locale change
  // keeps the switch clean; the profile fetch it triggers hydrates the real
  // draft a moment later.
  const { activeProfileId } = profiles;
  const [savedBaseline, setSavedBaseline] = useState(() => ({
    activeProfileId,
    locale,
    snapshot: liveSaveKey,
  }));
  const baselineIsCurrent =
    savedBaseline.activeProfileId === activeProfileId &&
    savedBaseline.locale === locale;
  const baselineSnapshot = baselineIsCurrent
    ? savedBaseline.snapshot
    : liveSaveKey;
  if (!baselineIsCurrent) {
    setSavedBaseline({ activeProfileId, locale, snapshot: liveSaveKey });
  }
  const isDirty = form.hasAnyContent && liveSaveKey !== baselineSnapshot;

  // Quiet per-section fill state for the rail ticks. Cheap derivations over
  // state the form already owns — no extra bookkeeping to drift out of sync.
  const sectionCompletion: SectionCompletion = useMemo(
    () => ({
      personal: Boolean(
        form.basics.fullName.trim() ||
          form.basics.title.trim() ||
          form.basics.email.trim() ||
          form.basics.phone.trim(),
      ),
      summary: form.summary.trim().length > 0,
      experience: form.experiences.some(
        (entry) => entry.title.trim() || entry.company.trim(),
      ),
      projects: form.projects.some((entry) => entry.name.trim()),
      education: form.education.some(
        (entry) => entry.school.trim() || entry.degree.trim(),
      ),
      skills:
        form.skills.some(
          (entry) => entry.category.trim() || entry.itemsText.trim(),
        ) || form.certifications.some((cert) => cert.name.trim()),
    }),
    [
      form.basics,
      form.summary,
      form.experiences,
      form.projects,
      form.education,
      form.skills,
      form.certifications,
    ],
  );

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
  // The draft has moved on from the PDF on screen. Drives the quiet badge so
  // the gap between "what I typed" and "what I see" is always stated rather
  // than discovered when the picture suddenly changes.
  const hasUnpreviewedChanges =
    Boolean(livePreviewKey) && livePreviewKey !== preview.previewedKey;

  // One commit = one compile. Held in a ref so the window listener below can
  // be registered once and still read the current draft.
  const commitPreviewRef = useRef<(opts?: { throttled?: boolean }) => void>(
    () => {},
  );
  // Synced in an effect, never during render: a commit only ever fires from a
  // blur handler or another effect, both of which run after the commit that
  // wrote this, so it is always current by the time anything reads it.
  useEffect(() => {
    commitPreviewRef.current = (opts) => {
      if (!livePreviewPayload || !livePreviewKey) return;
      if (!previewOpen && !isPreviewPaneVisible) return;
      // A short delay coalesces a blur that is immediately followed by the
      // section change it caused.
      schedulePreview(PREVIEW_COMMIT_DELAY_MS, false, {
        payload: livePreviewPayload,
        payloadKey: livePreviewKey,
        throttled: opts?.throttled,
      });
    };
  });

  // Typing is a commit too, once the typing stops.
  //
  // Refreshing only on blur meant the preview sat still for as long as the
  // user stayed in one field — a whole summary paragraph could be written with
  // the picture beside it unchanged, which reads as the preview being broken
  // rather than deliberate. A pause is a good enough signal that a thought is
  // finished.
  //
  // Two guards keep this cheap. schedulePreview drops payloads it has already
  // rendered and holds compiles to PREVIEW_MIN_INTERVAL_MS apart, so a long
  // editing run costs one render every few seconds, not one per pause; and
  // mid-typing drafts that fail the shared schema are skipped before any
  // request is made.
  useEffect(() => {
    if (!livePreviewPayload || !livePreviewKey) return;
    if (!previewOpen && !isPreviewPaneVisible) return;
    if (!hasUnpreviewedChanges) return;
    const timer = window.setTimeout(() => {
      commitPreviewRef.current({ throttled: true });
    }, PREVIEW_TYPING_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [
    livePreviewPayload,
    livePreviewKey,
    hasUnpreviewedChanges,
    previewOpen,
    isPreviewPaneVisible,
  ]);

  // Leaving a field is the commit. Capture-phase blur on window fires for
  // every element that loses focus, so no per-input wiring is needed — the
  // same seam useResumeAutosave uses, deliberately with its own predicate:
  // autosave asks "is it unsaved", this asks "is it unpreviewed", and a draft
  // can easily be one without the other.
  //
  // Blurring without editing costs nothing: schedulePreview skips a payload
  // key it has already rendered.
  useEffect(() => {
    const onBlurCapture = () => commitPreviewRef.current();
    window.addEventListener("blur", onBlurCapture, true);
    return () => window.removeEventListener("blur", onBlurCapture, true);
  }, []);

  // Moving to another section is the other commit. Gated on unpreviewed work
  // so merely scrolling through a finished resume never compiles anything.
  const previewedSectionRef = useRef(activeSection);
  useEffect(() => {
    if (previewedSectionRef.current === activeSection) return;
    previewedSectionRef.current = activeSection;
    if (!hasUnpreviewedChanges) return;
    commitPreviewRef.current();
  }, [activeSection, hasUnpreviewedChanges]);

  // First paint. The keystroke effect used to double as this; without it a
  // freshly opened editor would sit empty until the user blurred something.
  // Keyed on the profile id so switching versions re-renders too.
  // The sentinel is deliberately not null: a brand-new, never-saved profile
  // HAS a null id, so initialising to null would read as "already hydrated"
  // and that editor would never paint a first preview.
  const NOT_HYDRATED = Symbol.for("joblit.preview.not-hydrated");
  const hydratedPreviewProfileRef = useRef<string | null | symbol>(NOT_HYDRATED);
  useEffect(() => {
    const profileId = profiles.selectedProfileId ?? null;
    if (hydratedPreviewProfileRef.current === profileId) return;
    if (!livePreviewPayload) return;
    if (!previewOpen && !isPreviewPaneVisible) return;
    hydratedPreviewProfileRef.current = profileId;
    commitPreviewRef.current();
  }, [
    profiles.selectedProfileId,
    livePreviewPayload,
    previewOpen,
    isPreviewPaneVisible,
  ]);

  // The persistence primitive behind autosave. It throws on failure so the
  // autosave hook can own the status; it deliberately raises no success toast,
  // because a toast every time the user pauses typing is noise, not feedback.
  // The quiet SaveIndicator says what happened instead.
  const persistDraft = useCallback(async () => {
    setSaving(true);
    // Snapshot the exact draft being persisted up front. On success this
    // becomes the new "last saved" baseline so the indicator resets to clean
    // even when saving the same version (where activeProfileId — and thus the
    // re-baseline effect — does not change). An edit that lands mid-request is
    // therefore still dirty afterwards, and autosave reschedules itself.
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
      // Adopt the server's version identity, never its copy of the draft:
      // replacing the form with an echo of what we just sent would wipe any
      // keystroke that landed while the request was in flight. Baselining
      // against the adopted id in the same batch also stops the id-change
      // re-baseline below from marking those keystrokes as already saved.
      const adoptedProfileId = profiles.adoptProfileMeta(json);
      setSavedBaseline({
        activeProfileId: adoptedProfileId,
        locale,
        snapshot: savedSnapshot,
      });
      markTaskComplete("resume_setup");
    } finally {
      setSaving(false);
    }
  }, [
    form,
    profiles,
    locale,
    activeProfileId,
    markTaskComplete,
    preview,
  ]);

  const autosave = useResumeAutosave({
    saveKey: liveSaveKey,
    isDirty,
    enabled: form.hasAnyContent,
    save: persistDraft,
  });
  const autosaveRetry = useCallback(() => {
    void autosave.flush();
  }, [autosave]);

  return (
    <ResumeContext.Provider
      value={{
        ...form,
        ...preview,
        ...profiles,
        activeSection,
        activeSectionIndex,
        sectionCount,
        setActiveSection,
        setActiveSectionQuietly: setRawActiveSection,
        registerSectionNode,
        sectionNodesRef,
        collapsedSections,
        toggleSectionCollapsed,
        sectionCompletion,
        previewOpen,
        setPreviewOpen,
        hasUnpreviewedChanges,
        saving,
        isDirty,
        autosaveStatus: autosave.status,
        autosaveLastSavedAt: autosave.lastSavedAt,
        autosaveFlush: autosave.flush,
        autosaveRetry,
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
