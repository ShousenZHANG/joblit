export type CareerTab = "overview" | "interviews" | "stories" | "offers";

export type FunnelTransition =
  | "appliedToInterview"
  | "interviewToOffer"
  | "offerToAccepted";

export type CareerAnalytics = {
  funnel: {
    counts: {
      applied: number;
      interview: number;
      offer: number;
      accepted: number;
      rejected: number;
      withdrawn: number;
    };
    conversion: Record<FunnelTransition, number | null>;
    medianDays: Record<FunnelTransition, number | null>;
    sampleSizes: Record<FunnelTransition, number>;
  };
  offers: OfferComparison;
};

export type OfferComparison = {
  currencies: Array<{
    currency: string;
    offers: Array<{
      id: string;
      company: string;
      role: string;
      currency: string;
      baseSalaryAnnual: number | null;
      bonusAnnual: number | null;
      equityAnnual: number | null;
      otherAnnual: number | null;
      targetSalaryAnnual: number | null;
      totalAnnual: number;
      incomplete: boolean;
      salaryGap: number | null;
      rank: number;
    }>;
  }>;
  crossCurrencyComparison: false;
  note: string;
};

export type ReminderType =
  | "APPLICATION_FOLLOW_UP"
  | "INTERVIEW_THANK_YOU"
  | "OFFER_DEADLINE"
  | "CUSTOM";

export type Reminder = {
  id: string;
  jobId: string | null;
  applicationId: string | null;
  type: ReminderType;
  title: string;
  dueAt: string;
  note: string | null;
  completedAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReminderSuggestion = {
  key: string;
  jobId: string;
  type: Exclude<ReminderType, "CUSTOM">;
  title: string;
  dueAt: string;
  reason: string;
};

export type ReminderData = {
  persisted: Reminder[];
  suggestions: ReminderSuggestion[];
};

export type InterviewQuestion = {
  id: string;
  requirement: string;
  question: string;
  followUps: string[];
  evidenceRequired: true;
};

export type StoryMapping = {
  requirementId: string;
  requirement: string;
  candidates: Array<{
    storyId: string;
    storyTitle: string;
    score: number;
  }>;
  needsEvidence: boolean;
};

export type InterviewPlan = {
  id: string;
  jobId: string;
  round: number;
  title: string;
  status: "DRAFT" | "READY" | "COMPLETED" | "ARCHIVED";
  scheduledAt: string | null;
  questions: InterviewQuestion[];
  starMappings: StoryMapping[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StarStory = {
  id: string;
  title: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  reflection: string | null;
  skills: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type OfferStatus = "ACTIVE" | "ACCEPTED" | "DECLINED" | "WITHDRAWN";

export type Offer = {
  id: string;
  jobId: string | null;
  company: string;
  role: string;
  currency: string;
  baseSalaryAnnual: number | null;
  bonusAnnual: number | null;
  equityAnnual: number | null;
  otherAnnual: number | null;
  targetSalaryAnnual: number | null;
  benefits: string[];
  location: string | null;
  status: OfferStatus;
  receivedAt: string;
  deadlineAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JobChoice = {
  id: string;
  title: string;
  company: string | null;
  status: string;
};

export type NegotiationToolkit = {
  script: string;
  factsUsed: {
    company: string;
    role: string;
    offeredTotal: number | null;
    targetTotal: number | null;
    strengths: string[];
  };
  inventedFacts: [];
};

export type InterviewToolkit = {
  questions: InterviewQuestion[];
  starMappings: StoryMapping[];
  grounding: {
    storyCount: number;
    inventedFacts: [];
  };
};
