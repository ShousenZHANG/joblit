"use client";

import { useEffect } from "react";
import { Check, Download, Loader2, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useResumeContext } from "./ResumeContext";
import { SectionNav } from "./SectionNav";
import { PreviewPanel } from "./PreviewPanel";
import { VersionSelector } from "./VersionSelector";
import { PersonalInfoSection } from "./sections/PersonalInfoSection";
import { SummarySection } from "./sections/SummarySection";
import { ExperienceSection } from "./sections/ExperienceSection";
import { ProjectsSection } from "./sections/ProjectsSection";
import { EducationSection } from "./sections/EducationSection";
import { SkillsSection } from "./sections/SkillsSection";
import type { SectionId } from "./constants";

function SectionContent({ sectionId }: { sectionId: SectionId }) {
  const {
    basics,
    links,
    locale,
    updateBasics,
    updateLink,
    addLink,
    removeLink,
    summary,
    setSummary,
    applyBoldMarkdown,
    registerMarkdownRef,
    experiences,
    expandedExperienceIndex,
    setExpandedExperienceIndex,
    updateExperience,
    addExperience,
    removeExperience,
    updateExperienceBullet,
    addExperienceBullet,
    removeExperienceBullet,
    updateExperienceLink,
    addExperienceLink,
    removeExperienceLink,
    moveSectionItem,
    projects,
    expandedProjectIndex,
    setExpandedProjectIndex,
    updateProject,
    addProject,
    removeProject,
    updateProjectBullet,
    addProjectBullet,
    removeProjectBullet,
    updateProjectLink,
    addProjectLink,
    removeProjectLink,
    education,
    updateEducation,
    addEducation,
    removeEducation,
    skills,
    updateSkillGroup,
    addSkillGroup,
    removeSkillGroup,
  } = useResumeContext();

  switch (sectionId) {
    case "personal":
      return (
        <PersonalInfoSection
          basics={basics}
          links={links}
          locale={locale}
          updateBasics={updateBasics}
          updateLink={updateLink}
          addLink={addLink}
          removeLink={removeLink}
        />
      );
    case "summary":
      return (
        <SummarySection
          summary={summary}
          setSummary={setSummary}
          locale={locale}
          applyBoldMarkdown={applyBoldMarkdown}
          registerMarkdownRef={registerMarkdownRef}
        />
      );
    case "experience":
      return (
        <ExperienceSection
          experiences={experiences}
          locale={locale}
          expandedIndex={expandedExperienceIndex}
          setExpandedIndex={setExpandedExperienceIndex}
          updateExperience={updateExperience}
          addExperience={addExperience}
          removeExperience={removeExperience}
          updateExperienceBullet={updateExperienceBullet}
          addExperienceBullet={addExperienceBullet}
          removeExperienceBullet={removeExperienceBullet}
          updateExperienceLink={updateExperienceLink}
          addExperienceLink={addExperienceLink}
          removeExperienceLink={removeExperienceLink}
          onMove={(from, to) => moveSectionItem("experience", from, to)}
          applyBoldMarkdown={applyBoldMarkdown}
          registerMarkdownRef={registerMarkdownRef}
        />
      );
    case "projects":
      return (
        <ProjectsSection
          projects={projects}
          locale={locale}
          expandedIndex={expandedProjectIndex}
          setExpandedIndex={setExpandedProjectIndex}
          updateProject={updateProject}
          addProject={addProject}
          removeProject={removeProject}
          updateProjectBullet={updateProjectBullet}
          addProjectBullet={addProjectBullet}
          removeProjectBullet={removeProjectBullet}
          updateProjectLink={updateProjectLink}
          addProjectLink={addProjectLink}
          removeProjectLink={removeProjectLink}
          onMove={(from, to) => moveSectionItem("project", from, to)}
          applyBoldMarkdown={applyBoldMarkdown}
          registerMarkdownRef={registerMarkdownRef}
        />
      );
    case "education":
      return (
        <EducationSection
          education={education}
          updateEducation={updateEducation}
          addEducation={addEducation}
          removeEducation={removeEducation}
          onMove={(from, to) => moveSectionItem("education", from, to)}
        />
      );
    case "skills":
      return (
        <SkillsSection
          skills={skills}
          updateSkillGroup={updateSkillGroup}
          addSkillGroup={addSkillGroup}
          removeSkillGroup={removeSkillGroup}
          onMove={(from, to) => moveSectionItem("skill", from, to)}
        />
      );
    default:
      return null;
  }
}

function MobilePreviewDialog() {
  const { previewOpen, setPreviewOpen, pdfUrl, previewStatus, previewError, schedulePreview, basics, locale, t } =
    useResumeContext();

  const downloadFilename = (() => {
    const fallback = locale === "zh-CN" ? "未命名简历" : "Unnamed_Resume";
    if (!basics.fullName && !basics.title) return `${fallback}.pdf`;
    const safeName = (basics.fullName || "").replace(/\s+/g, "_");
    const safeTitle = (basics.title || "").replace(/\s+/g, "_");
    const connector = safeName && safeTitle ? "_" : "";
    return `${safeName}${connector}${safeTitle}.pdf`;
  })();

  return (
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
                download={downloadFilename}
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
          <div className="relative flex-1 overflow-hidden bg-card">
            {pdfUrl ? (
              <iframe title="Resume preview" src={pdfUrl} className="h-full w-full" />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                {t("preview")}
              </div>
            )}
            {previewStatus === "loading" && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/70 text-xs text-muted-foreground">
                Generating preview…
              </div>
            )}
            {previewStatus === "error" && (
              <div className="absolute inset-x-4 bottom-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
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
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * ResumeSaveBar — sticky desktop-only header inside the form column.
 *
 * Replaces the previous icon-only rail-foot Save with a discoverable,
 * always-visible primary CTA. Mirrors the Linear / Notion / Figma
 * "save status next to the action" pattern: live save state on the
 * left, primary Save button on the right.
 */
function ResumeSaveBar({ className }: { className?: string }) {
  const {
    saving,
    handleSave,
    hasAnyContent,
    isTaskHighlighted,
    t: tForm,
  } = useResumeContext();

  const guideHighlight = isTaskHighlighted("resume_setup");

  return (
    <div
      className={cn(
        "shrink-0 border-b border-border/60 bg-background/85 px-6 py-2.5 backdrop-blur-sm",
        className,
      )}
    >
      <div className="mx-auto flex max-w-[720px] items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {hasAnyContent ? (
            <>
              <span
                aria-hidden
                className={cn(
                  "h-1.5 w-1.5 rounded-full ring-[3px] transition-colors",
                  saving
                    ? "bg-amber-500 ring-amber-500/20 motion-safe:animate-pulse"
                    : "bg-emerald-500 ring-emerald-500/15",
                )}
              />
              <span aria-live="polite" className="font-medium text-foreground/85">
                {saving ? tForm("saving") : tForm("toastSaved")}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground/70">{tForm("toastAddDetailsFirst")}</span>
          )}
        </div>
        <Button
          type="button"
          onClick={handleSave}
          disabled={saving}
          size="sm"
          data-guide-anchor="resume_setup"
          data-guide-highlight={guideHighlight ? "true" : "false"}
          className={cn(
            "h-9 min-w-[10rem] rounded-full bg-emerald-600 px-5 text-sm font-semibold text-white",
            "shadow-[0_8px_24px_-12px_rgba(5,150,105,0.55)] transition-all duration-150",
            "hover:bg-emerald-700 hover:shadow-[0_12px_28px_-12px_rgba(5,150,105,0.65)]",
            "active:scale-[0.98] motion-reduce:active:scale-100",
            "disabled:cursor-not-allowed disabled:opacity-70",
            guideHighlight &&
              "ring-2 ring-emerald-400 ring-offset-2 ring-offset-background",
          )}
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Save className="h-4 w-4" aria-hidden />
          )}
          {saving ? tForm("saving") : tForm("saveSelectedResume")}
        </Button>
      </div>
    </div>
  );
}

export function ResumePageLayout() {
  const { activeSection } = useResumeContext();
  // Reference the Check icon so it stays in scope even though the rail
  // foot indicator was removed (used by tooling for tree-shaking docs).
  void Check;

  /* Lock outer shell scroll — Resume uses fixed-height panels with internal scroll */
  useEffect(() => {
    const appShell = document.querySelector<HTMLElement>(".app-shell");
    if (!appShell) return;
    appShell.classList.add("resume-scroll-lock");
    return () => {
      appShell.classList.remove("resume-scroll-lock");
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Mobile preview dialog */}
      <MobilePreviewDialog />

      {/* Content area */}
      <div className="flex flex-1 min-h-0">
        {/* Desktop section rail (56px, icon-only per design system) */}
        <SectionNav className="hidden lg:flex w-14 shrink-0 border-r border-border flex-col" />

        {/* Form content area */}
        <div className="flex flex-1 min-h-0 flex-col">
          {/* Mobile tab nav */}
          <SectionNav className="lg:hidden border-b border-border" />

          {/* Save bar — desktop only; mobile keeps its inline Save inside
              the section tab row. Sticky so the Save CTA never scrolls
              away while the user fills out long sections. */}
          <ResumeSaveBar className="hidden lg:flex" />

          {/* Scrollable form content — design spec form-canvas:
              max-width 720px, padding 28px 40px 60px on desktop. */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="mx-auto max-w-[720px] px-4 pb-12 pt-6 lg:px-10 lg:pb-16 lg:pt-6">
              <VersionSelector />
              {/* `key` resets the subtree on section switch so the
                  fade-in always replays. `motion-reduce` opts out for
                  users who prefer reduced motion. */}
              <div
                key={activeSection}
                className="mt-6 animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none"
              >
                <SectionContent sectionId={activeSection} />
              </div>
            </div>
          </div>
        </div>

        {/* Desktop preview panel — design spec recommends 420-460px but
            user feedback prioritises a larger live PDF, so we bump to
            520px (lg) and 600px (xl). Form column still has the 720px
            max-w canvas plus comfortable gutters. */}
        <PreviewPanel className="hidden md:flex w-[520px] shrink-0 border-l border-border flex-col xl:w-[600px]" />
      </div>
    </div>
  );
}
