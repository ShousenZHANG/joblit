"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { Download } from "lucide-react";
import { buildPdfFilename } from "@/lib/shared/pdfFilename";
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
import { SectionPager } from "./SectionPager";
import { PreviewPanel } from "./PreviewPanel";
import { SaveIndicator } from "./SaveIndicator";
import { VersionSelector } from "./VersionSelector";

// Lazy-load react-pdf (heaviest client dep) — only fetched when the mobile
// preview dialog opens. ssr:false because pdfjs needs DOM/canvas.
const ResumePdfPreview = dynamic(
  () => import("./ResumePdfPreview").then((m) => m.ResumePdfPreview),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-emerald-500 border-t-transparent" />
      </div>
    ),
  },
);
import { PersonalInfoSection } from "./sections/PersonalInfoSection";
import { SummarySection } from "./sections/SummarySection";
import { ExperienceSection } from "./sections/ExperienceSection";
import { ProjectsSection } from "./sections/ProjectsSection";
import { EducationSection } from "./sections/EducationSection";
import { SkillsSection } from "./sections/SkillsSection";
import { getSectionIds, type SectionId } from "./constants";

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
    expandedRowIds,
    toggleRowExpanded,
    collapseAllRows,
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
    certifications,
    updateCertification,
    addCertification,
    removeCertification,
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
          expandedIds={expandedRowIds.experience}
          onToggleExpanded={(rowId) => toggleRowExpanded("experience", rowId)}
          onCollapseAll={() => collapseAllRows("experience")}
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
          expandedIds={expandedRowIds.project}
          onToggleExpanded={(rowId) => toggleRowExpanded("project", rowId)}
          onCollapseAll={() => collapseAllRows("project")}
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
          expandedIds={expandedRowIds.education}
          onToggleExpanded={(rowId) => toggleRowExpanded("education", rowId)}
          onCollapseAll={() => collapseAllRows("education")}
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
          expandedIds={expandedRowIds.skill}
          onToggleExpanded={(rowId) => toggleRowExpanded("skill", rowId)}
          onCollapseAll={() => collapseAllRows("skill")}
          updateSkillGroup={updateSkillGroup}
          addSkillGroup={addSkillGroup}
          removeSkillGroup={removeSkillGroup}
          onMove={(from, to) => moveSectionItem("skill", from, to)}
          certifications={certifications}
          onUpdateCertification={updateCertification}
          onAddCertification={addCertification}
          onRemoveCertification={removeCertification}
        />
      );
    default:
      return null;
  }
}

export function MobilePreviewDialog() {
  const {
    previewOpen,
    setPreviewOpen,
    pdfUrl,
    previewStatus,
    previewError,
    schedulePreview,
    hasUnpreviewedChanges,
    basics,
    t,
  } = useResumeContext();

  const downloadFilename = buildPdfFilename(
    basics.fullName,
    basics.title,
    "cv",
    t("unnamedResumeFilename"),
  );

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
          <div
            data-testid="resume-mobile-preview-header"
            className="flex min-h-[calc(2.75rem+env(safe-area-inset-top))] shrink-0 items-center justify-end gap-2 border-b border-border bg-background/90 pt-[env(safe-area-inset-top)] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:min-h-11 sm:px-3 sm:pt-0"
          >
            {hasUnpreviewedChanges && previewStatus !== "loading" ? (
              <span
                data-testid="preview-pending-badge-mobile"
                className="mr-auto rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
              >
                {t("previewPending")}
              </span>
            ) : null}
            {pdfUrl && (
              <a
                href={pdfUrl}
                download={downloadFilename}
                className="inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-xs font-medium text-emerald-700 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 disabled:pointer-events-none disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                {t("download")}
              </a>
            )}
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="touch">
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
                {t("generatingPreview")}
              </div>
            )}
            {previewStatus === "error" && (
              <div className="absolute inset-x-4 bottom-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                <span>{previewError ?? t("previewFailed")}</span>
                <Button
                  type="button"
                  size="touch"
                  variant="outline"
                  onClick={() => schedulePreview(0, false, { force: true })}
                >
                  {t("retryPreview")}
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
  const { locale, activeSection } = useResumeContext();
  const formColumnRef = useRef<HTMLDivElement>(null);

  /* Lock outer shell scroll — Resume uses fixed-height panels with internal scroll */
  useEffect(() => {
    const appShell = document.querySelector<HTMLElement>(".app-shell");
    if (!appShell) return;
    appShell.classList.add("resume-scroll-lock");
    return () => {
      appShell.classList.remove("resume-scroll-lock");
    };
  }, []);

  // In focus mode the column swaps its whole contents, so a scroll position
  // left over from the previous section would drop the user into the middle of
  // the new one. Below `lg` the column is still one scroll and
  // `setActiveSection` already scrolls the anchor into view, so this must not
  // fight it — hence the width check rather than an unconditional reset.
  useEffect(() => {
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    formColumnRef.current?.scrollTo({ top: 0 });
  }, [activeSection]);

  // Sections render in the locale's own module order, so the editor mirrors
  // the document it produces.
  //
  // Two layouts from one tree. Below `lg` this is a single scroll: there is no
  // preview pane at that width, and showing one section at a time with no view
  // of the whole is exactly what retired the original one-section editor. From
  // `lg` up the live PDF supplies that overview, so the form focuses on the
  // active section and the rest are hidden by CSS.
  //
  // CSS rather than a JS breakpoint on purpose: every section stays mounted,
  // so switching keeps its state and costs no remount, there is no
  // server/client mismatch to flash through on first paint, and `display:none`
  // takes the hidden fields out of the tab order and the accessibility tree
  // for free.
  const sections = getSectionIds(locale);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Mobile preview dialog */}
      <MobilePreviewDialog />

      {/* Content area */}
      <div className="flex flex-1 min-h-0">
        {/* Desktop section rail — a jump list and position indicator. */}
        <SectionNav
          className="hidden w-16 shrink-0 flex-col border-r border-border lg:flex"
          scrollRootRef={formColumnRef}
        />

        {/* Form content area — `min-w-0` lets the form column shrink
            when the viewport narrows so the fixed-width preview pane
            never gets squeezed. The 720px max-w on the inner canvas
            prevents the editor from sprawling on ultra-wide screens. */}
        <div className="flex flex-1 min-w-0 min-h-0 flex-col">
          {/* Mobile jump chips */}
          <SectionNav className="lg:hidden border-b border-border" scrollRootRef={formColumnRef} />

          <div ref={formColumnRef} className="flex-1 min-h-0 overflow-y-auto">
            <div className="mx-auto max-w-[720px] px-4 pb-16 pt-5 lg:px-6 lg:pb-24 lg:pt-5">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <VersionSelector />
                <SaveIndicator className="pb-3" />
              </div>
              <div className="space-y-8">
                {sections.map((sectionId) => (
                  <div
                    key={sectionId}
                    data-section-slot={sectionId}
                    data-active={sectionId === activeSection ? "true" : "false"}
                    className={sectionId === activeSection ? undefined : "lg:hidden"}
                  >
                    <SectionContent sectionId={sectionId} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Focus-mode pager. Hidden below lg, where the column is still one
              continuous scroll and the rail chips already do this job. */}
          <SectionPager className="hidden lg:flex" />
        </div>

        {/* Desktop preview panel — viewport-fluid width via clamp() so
            the form column always keeps a comfortable working area:

              w = clamp(440px, 38vw, 720px)

            That gives the preview at least 440px on smaller laptops
            (form keeps ≥520px) and grows to 720px on ultra-wide
            displays without ever stealing more than 38% of the
            viewport. `shrink-0` plus the form column's `min-w-0`
            keep this width identical across every section. */}
        <PreviewPanel className="hidden w-[clamp(440px,38vw,720px)] shrink-0 flex-col border-l border-border lg:flex" />
      </div>
    </div>
  );
}
