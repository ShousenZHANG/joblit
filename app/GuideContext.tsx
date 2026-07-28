"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useGuideCoachmark } from "@/app/guide/useGuideCoachmark";
import { useGuideJourneyController } from "@/app/guide/useGuideJourneyController";
import { useGuidePanelShortcut } from "@/app/guide/useGuidePanelShortcut";
import type {
  GuideJourneyState,
  GuideTaskCompletion,
} from "@/app/guide/guideJourney";
import { GuideCoachmark } from "@/components/guide/GuideCoachmark";
import { GuideLauncher } from "@/components/guide/GuideLauncher";
import {
  GuidePanel,
  type GuidePanelView,
} from "@/components/guide/GuidePanel";
import { ToastAction } from "@/components/ui/toast";
import { useMarket } from "@/hooks/useMarket";
import { useToast } from "@/hooks/use-toast";
import type {
  OnboardingTask,
  OnboardingTaskId,
} from "@/lib/onboarding";

type GuideContextValue = {
  loading: boolean;
  state: GuideJourneyState | null;
  activeTaskId: OnboardingTaskId | null;
  openGuide: () => void;
  closeGuide: () => void;
  markTaskComplete: (taskId: OnboardingTaskId) => void;
  isTaskHighlighted: (taskId: OnboardingTaskId) => boolean;
};

const WELCOME_SHOWN_KEY = "joblit_guide_welcome_shown";
const COMPLETION_TOAST_CLASS =
  "border-brand-emerald-200 bg-brand-emerald-50 text-brand-emerald-900 animate-in fade-in zoom-in-95 motion-reduce:animate-none";
const GuideContext = createContext<GuideContextValue | null>(null);

function welcomeAlreadyShown(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.sessionStorage.getItem(WELCOME_SHOWN_KEY) === "1";
  } catch {
    return true;
  }
}

function markWelcomeShown() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(WELCOME_SHOWN_KEY, "1");
  } catch {
    // sessionStorage can be unavailable in privacy-restricted environments.
  }
}

function useGuidePanelModel() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<GuidePanelView>("checklist");
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((current) => !current), []);
  const openChecklist = useCallback(() => {
    setView("checklist");
    setOpen(true);
  }, []);
  const startChecklist = useCallback(() => setView("checklist"), []);
  const showWelcome = useCallback(() => {
    if (welcomeAlreadyShown()) return;
    setView("welcome");
    setOpen(true);
    markWelcomeShown();
  }, []);
  return {
    open,
    view,
    close,
    toggle,
    openChecklist,
    startChecklist,
    showWelcome,
  };
}

function useCompletionAnnouncer(
  navigateToTask: (task: OnboardingTask) => void,
) {
  const t = useTranslations("guide");
  const { toast } = useToast();
  return useCallback(
    (completion: GuideTaskCompletion) => {
      if (!completion.celebration) return;
      const { completedTaskId, nextTask } = completion.celebration;
      if (!nextTask) {
        toast({
          title: t("allDone"),
          description: t("allDoneDesc"),
          duration: 6000,
          className: COMPLETION_TOAST_CLASS,
        });
        return;
      }
      toast({
        title: t("taskDoneToast", {
          title: t(`task_${completedTaskId}_title`),
        }),
        description: t("nextLabel", {
          title: t(`task_${nextTask.id}_title`),
        }),
        duration: 6000,
        className: COMPLETION_TOAST_CLASS,
        action: (
          <ToastAction
            altText={t("takeMeThere")}
            onClick={() => navigateToTask(nextTask)}
          >
            {t("takeMeThere")}
          </ToastAction>
        ),
      });
    },
    [navigateToTask, t, toast],
  );
}

type GuideCommandsOptions = {
  router: ReturnType<typeof useRouter>;
  panel: ReturnType<typeof useGuidePanelModel>;
  journey: ReturnType<typeof useGuideJourneyController>;
  coachmark: ReturnType<typeof useGuideCoachmark>;
};

function useGuideCommands({
  router,
  panel,
  journey,
  coachmark,
}: GuideCommandsOptions) {
  const { push } = router;
  const { close, openChecklist } = panel;
  const { complete, dismiss, reopen } = journey;
  const { arm, completeTask } = coachmark;
  const navigateToTask = useCallback(
    (task: OnboardingTask) => {
      arm(task.id);
      push(task.href);
      close();
    },
    [arm, close, push],
  );
  const announceCompletion = useCompletionAnnouncer(navigateToTask);
  const openGuide = useCallback(() => {
    openChecklist();
    reopen();
  }, [openChecklist, reopen]);
  const markTaskComplete = useCallback(
    (taskId: OnboardingTaskId) => {
      const completion = complete(taskId);
      completeTask(taskId);
      announceCompletion(completion);
    },
    [announceCompletion, complete, completeTask],
  );
  const dismissGuide = useCallback(() => {
    close();
    dismiss();
  }, [close, dismiss]);
  return { navigateToTask, openGuide, markTaskComplete, dismissGuide };
}

function useGuideContextValue(
  journey: ReturnType<typeof useGuideJourneyController>,
  commands: ReturnType<typeof useGuideCommands>,
  closeGuide: () => void,
  isTaskHighlighted: (taskId: OnboardingTaskId) => boolean,
) {
  const { activeTaskId, loading, state } = journey;
  const { markTaskComplete, openGuide } = commands;
  return useMemo<GuideContextValue>(
    () => ({
      loading,
      state,
      activeTaskId,
      openGuide,
      closeGuide,
      markTaskComplete,
      isTaskHighlighted,
    }),
    [
      activeTaskId,
      closeGuide,
      isTaskHighlighted,
      loading,
      markTaskComplete,
      openGuide,
      state,
    ],
  );
}

function useGuideProviderModel() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();
  const market = useMarket();
  const userId = session?.user?.id ?? null;
  const enabled = Boolean(userId) && market !== "CN";
  const panel = useGuidePanelModel();
  const journey = useGuideJourneyController({
    userId,
    enabled,
    onNewUser: panel.showWelcome,
  });
  const coachmark = useGuideCoachmark(pathname);
  const commands = useGuideCommands({ router, panel, journey, coachmark });
  useGuidePanelShortcut({
    enabled,
    panelOpen: panel.open,
    onClose: panel.close,
    onToggle: panel.toggle,
  });
  const contextValue = useGuideContextValue(
    journey,
    commands,
    panel.close,
    coachmark.isHighlighted,
  );
  return { userId, panel, journey, coachmark, commands, contextValue };
}

type GuideExperienceProps = {
  model: ReturnType<typeof useGuideProviderModel>;
};

function GuideExperience({ model }: GuideExperienceProps) {
  const { userId, panel, journey, coachmark, commands } = model;
  if (!userId || !journey.state) return null;
  return (
    <>
      {!panel.open && coachmark.task && coachmark.layout ? (
        <GuideCoachmark
          task={coachmark.task}
          stepNumber={coachmark.stepNumber}
          journey={journey.state}
          rect={coachmark.rect}
          layout={coachmark.layout}
          elementRef={coachmark.elementRef}
          onDismiss={coachmark.dismiss}
          onViewAll={commands.openGuide}
        />
      ) : null}
      {!panel.open && !journey.state.isComplete ? (
        <GuideLauncher
          journey={journey.state}
          activeTaskId={journey.activeTaskId}
          onOpen={commands.openGuide}
        />
      ) : null}
      <GuidePanel
        open={panel.open}
        view={panel.view}
        journey={journey.state}
        activeTaskId={journey.activeTaskId}
        onClose={panel.close}
        onDismiss={commands.dismissGuide}
        onStart={panel.startChecklist}
        onNavigate={commands.navigateToTask}
      />
    </>
  );
}

export function GuideProvider({ children }: { children: ReactNode }) {
  const model = useGuideProviderModel();
  return (
    <GuideContext.Provider value={model.contextValue}>
      {children}
      <GuideExperience model={model} />
    </GuideContext.Provider>
  );
}

const EMPTY_GUIDE_CONTEXT: GuideContextValue = {
  loading: false,
  state: null,
  activeTaskId: null,
  openGuide: () => {},
  closeGuide: () => {},
  markTaskComplete: () => {},
  isTaskHighlighted: () => false,
};

export function useGuide(): GuideContextValue {
  return useContext(GuideContext) ?? EMPTY_GUIDE_CONTEXT;
}
