"use client";

import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { useTranslations } from "next-intl";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, CalendarClock, Check, ChevronDown, FileCheck2, FileText, ListChecks, MapPin, PencilLine, RotateCcw, Search, ShieldCheck, Sparkles, Trash2, X } from "lucide-react";
import { JobSearchBar } from "@/app/(app)/jobs/components/JobSearchBar";
import { DocumentTargetTabs } from "@/app/(app)/jobs/components/tailoring/DocumentTargetTabs";
import { TailorStep } from "@/app/(app)/jobs/components/tailoring/TailorStep";
import { useAccessibleTabs } from "@/components/ui/useAccessibleTabs";
import { DEMO_JOBS, DEMO_PROFILE, DEMO_SKILLS, type DemoJob } from "./ApplicationDemo.data";
import { useMotionPreference } from "./lib/useMotionPreference";
import { DepthLayer, ScrollChapter } from "./ScrollChapter";
import styles from "./ApplicationDemo.module.css";

const WORKSPACE_VIEWS = ["jobs", "fetch", "resume"] as const;
const STATUSES = ["NEW", "APPLIED", "REJECTED"] as const;
// Keep aligned with the list/detail breakpoint in ApplicationDemo.module.css.
const MOBILE_LAYOUT_QUERY = "(max-width: 700px)";
type WorkspaceView = (typeof WORKSPACE_VIEWS)[number];
type JobStatus = (typeof STATUSES)[number];
type DocumentTarget = "resume" | "cover";
type PreparedDocuments = Partial<Record<string, Partial<Record<DocumentTarget, boolean>>>>;

/** Local fixtures and UI state only: never mount the application's data hooks. */
export function ApplicationDemo() {
  const t = useTranslations("landingExperience.demo");
  const id = useId();
  const reducedMotion = useMotionPreference();
  const [view, setView] = useState<WorkspaceView>("jobs");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<JobStatus>("NEW");
  const [selectedId, setSelectedId] = useState<string>(DEMO_JOBS[0].id);
  const [statuses, setStatuses] = useState<Record<string, JobStatus>>({});
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [mobilePane, setMobilePane] = useState<"list" | "detail">("list");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedDocuments>({});
  const [dialogJob, setDialogJob] = useState<DemoJob | null>(null);
  const [dialogMode, setDialogMode] = useState<"tailor" | "description">("tailor");
  const [target, setTarget] = useState<DocumentTarget>("resume");
  const [phase, setPhase] = useState<"review" | "publish" | "none">("none");
  const [announcement, setAnnouncement] = useState("");
  // Keep the portal inside the landing's theme boundary, outside the clipped
  // workspace. This preserves both its semantic color tokens and modal focus.
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const sourceRef = useRef<HTMLParagraphElement>(null);
  const detailHeaderRef = useRef<HTMLDivElement>(null);
  const detailTitleRef = useRef<HTMLHeadingElement>(null);
  const jobCardRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingPaneFocus = useRef<{ pane: "list" | "detail"; jobId: string } | null>(null);
  const dialogTitleRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const sampleStatusRef = useRef<HTMLDivElement>(null);
  const pendingSampleFocus = useRef(false);
  const tabs = useAccessibleTabs({ id: `${id}-workspace`, value: view, values: WORKSPACE_VIEWS, onValueChange: setView });
  const jobs = DEMO_JOBS.filter((job) => !deletedIds.includes(job.id));
  const visibleJobs = jobs.filter((job) => (statuses[job.id] ?? "NEW") === filter && `${job.title} ${job.company} ${job.location} ${job.technology.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()));
  const job = visibleJobs.find((item) => item.id === selectedId) ?? visibleJobs[0];
  const hasDocument = Boolean(dialogJob && prepared[dialogJob.id]?.[target]);
  const samplePdf = dialogJob ? `/demo/${dialogJob.id}-${target}.pdf` : undefined;

  useEffect(() => {
    const pending = pendingPaneFocus.current;
    if (!pending || pending.pane !== mobilePane) return;
    pendingPaneFocus.current = null;
    if (!window.matchMedia(MOBILE_LAYOUT_QUERY).matches) return;
    const destination = pending.pane === "detail" ? detailTitleRef.current : jobCardRefs.current.get(pending.jobId);
    destination?.focus({ preventScroll: true });
    const scrollDestination = pending.pane === "detail" ? detailHeaderRef.current : destination;
    scrollDestination?.scrollIntoView({ block: "start", behavior: reducedMotion ? "instant" : "smooth" });
  }, [mobilePane, job?.id, reducedMotion]);

  useEffect(() => {
    if (!hasDocument || !pendingSampleFocus.current) return;
    pendingSampleFocus.current = false;
    sampleStatusRef.current?.focus({ preventScroll: true });
  }, [hasDocument]);

  function chooseJob(nextJob: DemoJob) {
    if (window.matchMedia(MOBILE_LAYOUT_QUERY).matches) pendingPaneFocus.current = { pane: "detail", jobId: nextJob.id };
    setSelectedId(nextJob.id);
    setHighlightedId(null);
    setMobilePane("detail");
  }

  function returnToRoleList() {
    if (job && window.matchMedia(MOBILE_LAYOUT_QUERY).matches) pendingPaneFocus.current = { pane: "list", jobId: job.id };
    setMobilePane("list");
  }

  function openJobDescription(event: MouseEvent<HTMLButtonElement>, highlightSource = false) {
    if (!job) return;
    openerRef.current = event.currentTarget;
    setHighlightedId(highlightSource ? job.id : null);
    setDialogMode("description");
    setDialogJob(job);
    if (highlightSource) setAnnouncement(t("sourceFound"));
  }

  function openTailor(event: MouseEvent<HTMLButtonElement>, nextTarget: DocumentTarget) {
    if (!job) return;
    openerRef.current = event.currentTarget;
    setDialogMode("tailor");
    setTarget(nextTarget);
    setPhase("none");
    setDialogJob(job);
  }

  function showPreparedSample() {
    if (!dialogJob) return;
    // The live flow generates, validates and publishes one target. A prepared
    // file represents that result immediately here, with no pretend task.
    pendingSampleFocus.current = true;
    setPrepared((current) => ({ ...current, [dialogJob.id]: { ...current[dialogJob.id], [target]: true } }));
    setPhase("none");
  }

  function reset() {
    pendingSampleFocus.current = false;
    pendingPaneFocus.current = null;
    setQuery(""); setFilter("NEW"); setSelectedId(DEMO_JOBS[0].id);
    setStatuses({}); setDeletedIds([]); setPrepared({}); setHighlightedId(null);
    setDialogJob(null); setView("jobs"); setMobilePane("list");
    setTarget("resume"); setPhase("none"); setAnnouncement(t("resetStatus"));
  }

  function showJobs() {
    pendingPaneFocus.current = null;
    setView("jobs"); setMobilePane("list");
    document.getElementById(tabs.getTabProps("jobs").id)?.focus();
  }

  function showExampleResults() {
    if (!jobs.length) reset();
    else {
      setQuery("");
      setFilter(statuses[jobs[0].id] ?? "NEW");
      setSelectedId(jobs[0].id);
    }
    showJobs();
  }

  const pdfLink = samplePdf ? <a href={samplePdf} target="_blank" rel="noreferrer" className={styles.pdfLink}>{t("openPdf")}<ArrowUpRight size={15} aria-hidden="true" /><span className={styles.srOnly}>{t("newTab")}</span></a> : null;

  return (
    <div className={styles.demoRoot}>
    <ScrollChapter id="demo" className={styles.section} labelledBy={`${id}-title`} interactive>
      <div className={styles.demoContent}>
      <header className={styles.sectionHeading}>
        <p className={styles.eyebrow}>{t("eyebrow")}</p>
        <h2 id={`${id}-title`}>{t("title")}</h2>
        <p className={styles.description}>{t("description")}</p>
      </header>
      <DepthLayer depth={0.5} tilt={-1}>
      <div className={styles.workspace} role="group" aria-label={t("label")} data-chapter-interactive="">
        <div className={styles.toolbar}>
          <div className={styles.brand}><span className={styles.brandMark} aria-hidden="true">J</span><span>Joblit</span></div>
          <div {...tabs.tabListProps} className={styles.tabs} aria-label={t("navigation")}>
            {WORKSPACE_VIEWS.map((item) => <button {...tabs.getTabProps(item)} type="button" key={item}>{t(item)}</button>)}
          </div>
          <span className={styles.sampleBadge}>{t("sample")}</span>
          <button type="button" className={styles.reset} onClick={reset} aria-label={t("reset")} title={t("reset")}><RotateCcw size={16} aria-hidden="true" /><span>{t("reset")}</span></button>
        </div>
        <div {...tabs.getPanelProps("jobs")} className={styles.jobsPanel} data-mobile-pane={mobilePane}>
          <aside className={styles.sidebar} aria-label={t("jobList")}>
            <div className={styles.search}><JobSearchBar q={query} onQueryChange={(value) => { setQuery(value); setMobilePane("list"); }} onSubmit={() => undefined} placeholder={t("searchPlaceholder")} /></div>
            <div className={styles.filterBar} role="group" aria-label={t("filterLabel")}>
              {STATUSES.map((status) => <button type="button" key={status} aria-pressed={filter === status} onClick={() => { setFilter(status); setMobilePane("list"); }}>
                {t(`statuses.${status}`)}{status === "NEW" && <span>{jobs.filter((item) => (statuses[item.id] ?? "NEW") === status).length}</span>}
              </button>)}
            </div>
            <ul className={styles.jobList}>
              {visibleJobs.map((item) => <li key={item.id}>
                <button ref={(node) => { if (node) jobCardRefs.current.set(item.id, node); else jobCardRefs.current.delete(item.id); }} type="button" className={styles.jobCard} aria-label={`${item.title}, ${item.company}`} aria-pressed={job?.id === item.id} onClick={() => chooseJob(item)}>
                  <span className={styles.jobCardTop}><span className={styles.statusBadge} data-status={statuses[item.id] ?? "NEW"}>{t(`statuses.${statuses[item.id] ?? "NEW"}`)}</span><span>{t("hoursAgo", { count: Number.parseInt(item.age) })}</span></span>
                  <strong>{item.title}</strong>
                  {item.qualifier && <span className={styles.qualifier}>{item.qualifier}</span>}
                  <span className={styles.company}>{item.company}<span className={styles.cardCity}> · {item.location.split(",")[0]}</span></span>
                  <span className={styles.location}><MapPin size={13} aria-hidden="true" />{item.location}</span>
                  <span className={styles.listMeta}>{t("fullTime")}<span aria-hidden="true">·</span>{item.level}<span className={styles.sourceBadge}>{t("sampleSource")}</span></span>
                </button>
              </li>)}
            </ul>
            {!visibleJobs.length && <div className={styles.listEmpty}><Search size={22} aria-hidden="true" /><p>{t("emptyTitle")}</p><span>{!jobs.length ? t("emptyRemoved") : query ? t("emptySearch") : t("emptyStatus")}</span>{!jobs.length ? <button type="button" className={styles.textButton} onClick={reset}>{t("restoreSamples")}</button> : query && <button type="button" className={styles.textButton} onClick={() => setQuery("")}>{t("clearSearch")}</button>}</div>}
            <p className={styles.listFooter}>{t("resultCount", { count: visibleJobs.length })}</p>
          </aside>
          <div className={styles.detail} role="group" aria-label={t("detail")}>
            {job ? <>
              <div ref={detailHeaderRef} className={styles.detailHeader}>
                <button type="button" className={styles.mobileBack} onClick={returnToRoleList}><ArrowLeft size={16} aria-hidden="true" />{t("backToList")}</button>
                <div className={styles.titleRow}>
                  <div><h3 ref={detailTitleRef} tabIndex={-1}>{job.title}</h3>{job.qualifier && <p className={styles.detailQualifier}>{job.qualifier}</p>}</div>
                  <label className={styles.statusSelect}><span className={styles.srOnly}>{t("jobStatus")}</span><span className={styles.statusDot} data-status={statuses[job.id] ?? "NEW"} aria-hidden="true" /><select value={statuses[job.id] ?? "NEW"} onChange={(event) => {
                    const next = event.target.value as JobStatus;
                    setStatuses((current) => ({ ...current, [job.id]: next }));
                    setAnnouncement(t("statusChanged", { title: job.title, status: t(`statuses.${next}`) }));
                  }}>{STATUSES.map((status) => <option key={status} value={status}>{t(`statuses.${status}`)}</option>)}</select><ChevronDown size={13} aria-hidden="true" /></label>
                </div>
                <p className={styles.jobMeta}><span className={styles.companyLabel}>{job.company}</span><span>{job.location}</span><span>{t("fullTime")}</span><span>{job.level}</span></p>
                <div className={styles.actionRow}>
                  <button type="button" className={styles.tailorButton} onClick={(event) => openTailor(event, "resume")}><Sparkles size={17} aria-hidden="true" />{t("tailor")}</button>
                  {prepared[job.id]?.resume && <button type="button" className={styles.secondaryButton} onClick={(event) => openTailor(event, "resume")}><FileCheck2 size={15} aria-hidden="true" />{t("savedCv")}</button>}
                  {prepared[job.id]?.cover && <button type="button" className={styles.secondaryButton} onClick={(event) => openTailor(event, "cover")}><FileCheck2 size={15} aria-hidden="true" />{t("savedCl")}</button>}
                  <a href={`/demo/${job.id}-job.html`} target="_blank" rel="noreferrer" className={styles.openJob}>{t("openJob")}<ArrowUpRight size={15} aria-hidden="true" /><span className={styles.srOnly}>{t("samplePostingNewTab")}</span></a>
                  <button type="button" className={styles.deleteButton} aria-label={t("removeJob")} title={t("removeJob")} onClick={() => { setDeletedIds((current) => [...current, job.id]); setAnnouncement(t("removedStatus")); setMobilePane("list"); }}><Trash2 size={17} aria-hidden="true" /></button>
                </div>
              </div>
              <div className={styles.detailBody}>
                <section className={styles.requirements} aria-labelledby={`${id}-requirements`}>
                  <h4 id={`${id}-requirements`}><ListChecks size={17} aria-hidden="true" />{t("requirements")}</h4>
                  <div className={styles.requirementGrid}>
                    <div className={styles.experienceCard}><p><CalendarClock size={15} aria-hidden="true" />{t("requiredExperience")}</p><div><strong>{job.requirement}</strong><button type="button" className={styles.sourceButton} onClick={(event) => openJobDescription(event, true)} aria-haspopup="dialog">{t("viewInJd")}<ArrowDown size={15} aria-hidden="true" /></button></div></div>
                    <div className={styles.technologyCard}><p>{t("technology")}</p><ul>{job.technology.map((skill) => <li key={skill}>{skill}</li>)}</ul></div>
                  </div>
                </section>
                <section className={styles.jobDescription} aria-labelledby={`${id}-description`}>
                  <div className={styles.descriptionHeading}><h4 id={`${id}-description`}>{t("jobDescription")}</h4><button type="button" className={styles.readDescription} onClick={(event) => openJobDescription(event)} aria-haspopup="dialog">{t("readFullJob")}<ArrowUpRight size={14} aria-hidden="true" /></button></div>
                  <p>{job.intro}</p><p>{job.responsibilities[0]}</p>
                </section>
              </div>
            </> : <div className={styles.detailEmpty}><ListChecks size={28} aria-hidden="true" /><h3>{t("emptyTitle")}</h3><p>{!jobs.length ? t("emptyRemoved") : query ? t("emptySearch") : t("emptyStatus")}</p><button type="button" className={styles.secondaryButton} onClick={showExampleResults}>{jobs.length ? t("viewExampleResults") : t("restoreSamples")}</button></div>}
          </div>
        </div>
        <div {...tabs.getPanelProps("fetch")} className={styles.fetchPanel}>
          <div className={styles.previewHeading}><span className={styles.sampleBadge}>{t("readOnlySample")}</span><h3>{t("fetchTitle")}</h3><p>{t("fetchDescription")}</p></div>
          <div className={styles.fetchCard}><dl><div><dt>{t("keywords")}</dt><dd>Application Developer, Full Stack, AI Engineer</dd></div><div><dt>{t("location")}</dt><dd>Australia</dd></div></dl><p>{t("fetchSampleNote")}</p><button type="button" className={styles.tailorButton} onClick={showExampleResults}>{t("viewExampleResults")}<ArrowRight size={16} aria-hidden="true" /></button></div>
        </div>
        <div {...tabs.getPanelProps("resume")} className={styles.resumePanel}>
          <div className={styles.previewHeading}><span className={styles.sampleBadge}>{t("readOnlySample")}</span><h3>{t("originalProfile")}</h3><p>{t("profileDescription")}</p><button type="button" className={styles.textButton} onClick={showJobs}><ArrowLeft size={16} aria-hidden="true" />{t("backToJobs")}</button></div>
          <article className={styles.profileCard} aria-label={t("originalProfile")}>
            <header><h4>{DEMO_PROFILE.name}</h4><p>{DEMO_PROFILE.title}</p></header>
            <section><h5>{t("summary")}</h5><p>{DEMO_PROFILE.summary}</p></section>
            <section><h5>{t("skills")}</h5><ul className={styles.skills}>{DEMO_SKILLS.map((skill) => <li key={skill}>{skill}</li>)}</ul></section>
            <section><h5>{t("experience")}</h5><ul className={styles.experience}>{DEMO_PROFILE.experience.map((item) => <li key={item}>{item}</li>)}</ul></section>
          </article>
        </div>
        <p className={styles.demoDisclaimer}><ShieldCheck size={14} aria-hidden="true" />{t("sampleNote")}</p>
      </div>
      </DepthLayer>
      <p className={styles.setupNote}>{t("localNote")}</p>
      <p className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
      </div>
    </ScrollChapter>
      <div ref={setPortalContainer} className={styles.portalRoot}>
        <Dialog.Root open={dialogJob !== null} onOpenChange={(open) => { if (!open) setDialogJob(null); }}>
          {portalContainer && <Dialog.Portal container={portalContainer}>
            <Dialog.Overlay className={styles.dialogOverlay} />
            <Dialog.Content className={styles.dialog} onPointerDownOutside={(event) => event.preventDefault()} onOpenAutoFocus={(event) => {
              event.preventDefault();
              if (dialogMode === "description" && highlightedId === dialogJob?.id) {
                sourceRef.current?.focus({ preventScroll: true });
                sourceRef.current?.scrollIntoView({ block: "center", behavior: "instant" });
              } else dialogTitleRef.current?.focus();
            }} onCloseAutoFocus={(event) => { event.preventDefault(); openerRef.current?.focus({ preventScroll: true }); }}>
              <header className={styles.dialogHeader}>
                <div><p className={styles.eyebrow}>{t("sample")}</p><Dialog.Title ref={dialogTitleRef} tabIndex={-1}>{dialogMode === "description" ? <FileText size={20} aria-hidden="true" /> : <Sparkles size={20} aria-hidden="true" />}{t(dialogMode === "description" ? "jobDescription" : "dialogTitle")}</Dialog.Title><Dialog.Description>{dialogJob?.title}<span aria-hidden="true"> · </span>{dialogJob?.company}</Dialog.Description></div>
                <Dialog.Close className={styles.closeButton} aria-label={t(dialogMode === "description" ? "closeJobDescription" : "close")}><X size={20} aria-hidden="true" /></Dialog.Close>
              </header>
              <div className={styles.dialogBody} tabIndex={dialogMode === "description" ? 0 : undefined} role={dialogMode === "description" ? "region" : undefined} aria-label={dialogMode === "description" ? t("jobDescription") : undefined}>
                {dialogMode === "description" && dialogJob ? <div className={`${styles.jobDescription} ${styles.fullDescription}`}>
                  <p>{dialogJob.intro}</p><ul>{dialogJob.responsibilities.map((item) => <li key={item}>{item}</li>)}</ul>
                  <h3>{t("aboutYou")}</h3>
                  <p id={`${id}-source`} ref={sourceRef} tabIndex={-1} className={styles.sourceQuote} data-highlighted={highlightedId === dialogJob.id}>{highlightedId === dialogJob.id ? <mark>{dialogJob.source}</mark> : dialogJob.source}</p>
                  <p>{dialogJob.closing}</p>
                </div> :
                <DocumentTargetTabs target={target} onSelect={(nextTarget) => { setTarget(nextTarget); setPhase("none"); }} label={t("documentTargets")} labels={{ resume: t("resume"), cover: t("cover") }} indicators={{ resume: dialogJob && prepared[dialogJob.id]?.resume ? { kind: "published", label: t("publishedSample") } : null, cover: dialogJob && prepared[dialogJob.id]?.cover ? { kind: "published", label: t("publishedSample") } : null }}>
                  <section className={styles.generatePanel} aria-label={t("generateExample")}>
                    {hasDocument ? <details className={styles.regenerate}><summary>{t("showAgain")}</summary><p>{t("preparedNote")}</p></details> : <div className={styles.generateContent}>
                      <div className={styles.generateHeading}><span aria-hidden="true"><FileText size={27} /></span><div><h3>{t(target === "resume" ? "resumeReadyTitle" : "coverReadyTitle")}</h3><p>{t(target === "resume" ? "resumeReadyBody" : "coverReadyBody")}</p></div></div>
                      <div className={styles.generateAction}><button type="button" className={styles.tailorButton} onClick={showPreparedSample}><Sparkles size={17} aria-hidden="true" />{t("generateExample")}</button><span><ShieldCheck size={14} aria-hidden="true" />{t("preparedLabel")}</span></div>
                      <p className={styles.generationExplanation}>{t("preparedNote")}</p>
                    </div>}
                  </section>
                  {!hasDocument ? <div className={styles.lockedSteps}>
                    <section><PencilLine size={17} aria-hidden="true" /><h3>{t("review")}</h3><p>{t("reviewLocked")}</p></section>
                    <section><FileCheck2 size={17} aria-hidden="true" /><h3>{t("publish")}</h3><p>{t("publishLocked")}</p></section>
                  </div> : <>
                    <div ref={sampleStatusRef} tabIndex={-1} className={styles.preparedSuccess} role="status"><Check size={17} aria-hidden="true" /><span>{t("sampleReady", { target: t(target === "resume" ? "resume" : "cover") })}</span></div>
                    <div className={styles.steps}>
                      <TailorStep index={1} title={t("review")} state={phase === "review" ? "expanded" : "done"} description={t("readOnlyReview")} onExpand={() => setPhase("review")}>
                        {dialogJob && target === "resume" ? <div className={styles.reviewContent}>
                          <section><h4>{t("tailoredSummary")}</h4><p className={styles.reviewText}>{dialogJob.summary}</p><details className={styles.originalSummary}><summary>{t("compareOriginal")}</summary><p>{DEMO_PROFILE.summary}</p></details></section>
                          <section><h4>{t("selectedSkills")}</h4><ol className={styles.skills}>{dialogJob.skills.map((index) => <li key={index}><Check size={13} aria-hidden="true" />{DEMO_SKILLS[index]}</li>)}</ol><p className={styles.reviewHint}>{t("existingSkillsOnly")}</p></section>
                          <p className={styles.preserved}><ShieldCheck size={15} aria-hidden="true" />{t("experiencePreserved")}</p>
                        </div> : <div className={styles.reviewContent}>{dialogJob?.cover.map((paragraph, index) => <section key={index}><h4>{t("paragraph", { count: index + 1 })}</h4><p className={styles.reviewText}>{paragraph}</p></section>)}</div>}
                        <div className={styles.reviewFooter}><button type="button" className={styles.secondaryButton} onClick={() => setPhase("publish")}>{t("viewPublished")}<ArrowRight size={15} aria-hidden="true" /></button></div>
                      </TailorStep>
                      <TailorStep index={2} title={t("publish")} state={phase === "publish" ? "expanded" : "done"} summary={t("publishedSample")} description={t("publicationNote")} onExpand={() => setPhase("publish")} doneAside={pdfLink}>
                        <p className={styles.reviewHint}>{t("staticPdfNote")}</p>{pdfLink}
                      </TailorStep>
                    </div>
                  </>}
                </DocumentTargetTabs>}
              </div>
              <footer className={styles.dialogFooter}><p>{t(dialogMode === "description" ? "sampleNote" : "dialogFooter")}</p><Dialog.Close className={styles.secondaryButton}>{t("backToJobs")}<ArrowRight size={15} aria-hidden="true" /></Dialog.Close></footer>
            </Dialog.Content>
          </Dialog.Portal>}
        </Dialog.Root>
      </div>
    </div>
  );
}
