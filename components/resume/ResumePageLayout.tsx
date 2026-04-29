"use client";

import { useEffect } from "react";
import { Download } from "lucide-react";
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
import { ResumePdfPreview } from "./ResumePdfPreview";
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
            {pdfUrl && (
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
              <div className="absolute inset-0 overflow-auto bg-gradient-to-b from-muted/40 via-muted/25 to-muted/15 px-3 py-4 sm:px-5 sm:py-5">
                <ResumePdfPreview pdfUrl={pdfUrl} maxWidth={760} />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                {t("preview")}
              </div>
            )}
            {previewStatus === "loading" && !pdfUrl && (
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

export function ResumePageLayout() {
  const { activeSection } = useResumeContext();

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
        {/* Desktop section sidebar with persistent save action */}
        <SectionNav className="hidden w-16 shrink-0 flex-col border-r border-border lg:flex" />

        {/* Form content area — `min-w-0` lets the form column shrink
            when the viewport narrows so the fixed-width preview pane
            never gets squeezed. The 720px max-w on the inner canvas
            prevents the editor from sprawling on ultra-wide screens. */}
        <div className="flex flex-1 min-w-0 min-h-0 flex-col">
          {/* Mobile tab nav */}
          <SectionNav className="lg:hidden border-b border-border" />

          {/* Scrollable form content — design spec form-canvas:
              max-width 720px, padding 28px 40px 60px on desktop. */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="mx-auto max-w-[720px] px-4 pb-12 pt-6 lg:px-8 lg:pb-16 lg:pt-6">
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

        {/* Desktop preview panel — fixed-width column that never
            shrinks. Three breakpoint stops keep the rendered PDF as
            large as the viewport allows while leaving a usable form
            column on each:
              md  ≥ 768px  → 480px preview
              lg  ≥ 1024px → 600px preview
              xl  ≥ 1280px → 720px preview
              2xl ≥ 1536px → 800px preview
            `shrink-0` plus the form column's `min-w-0` keep this width
            stable across every form section / option. */}
        <PreviewPanel className="hidden md:flex w-[480px] shrink-0 border-l border-border flex-col lg:w-[600px] xl:w-[720px] 2xl:w-[800px]" />
      </div>
    </div>
  );
}
