import type { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/server/prisma";
import { isAllowedStatusTransition } from "./applicationEvents";
import { CareerConflictError, CareerNotFoundError } from "./errors";
import { contentHash } from "./hashing";
import {
  buildInterviewQuestions,
  mapStarStoriesToRequirements,
} from "./toolkit";

async function requireOwnedJob(
  tx: Prisma.TransactionClient,
  userId: string,
  jobId: string,
) {
  const job = await tx.job.findFirst({
    where: { id: jobId, userId },
    select: { id: true, status: true, company: true, title: true },
  });
  if (!job) throw new CareerNotFoundError("job");
  return job;
}

async function requireOwnedApplication(
  tx: Prisma.TransactionClient,
  userId: string,
  applicationId: string,
) {
  const application = await tx.application.findFirst({
    where: { id: applicationId, userId },
    select: { id: true, jobId: true },
  });
  if (!application) throw new CareerNotFoundError("application");
  return application;
}

async function appendRecordEvent(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    jobId: string;
    type:
      | "INTERVIEW_PLANNED"
      | "INTERVIEW_COMPLETED"
      | "OFFER_RECORDED"
      | "OFFER_UPDATED"
      | "OFFER_DECIDED"
      | "FOLLOW_UP_CREATED"
      | "FOLLOW_UP_COMPLETED";
    note: string;
    metadata: Prisma.InputJsonValue;
  },
) {
  const job = await requireOwnedJob(tx, input.userId, input.jobId);
  return tx.applicationEvent.create({
    data: {
      userId: input.userId,
      jobId: input.jobId,
      companySnapshot: job.company,
      titleSnapshot: job.title,
      type: input.type,
      source: "USER",
      note: input.note,
      metadata: input.metadata,
    },
  });
}

async function projectStatus(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    jobId: string;
    fromStatus:
      | "NEW"
      | "APPLIED"
      | "INTERVIEW"
      | "OFFER"
      | "REJECTED"
      | "WITHDRAWN"
      | "ACCEPTED";
    toStatus:
      | "NEW"
      | "APPLIED"
      | "INTERVIEW"
      | "OFFER"
      | "REJECTED"
      | "WITHDRAWN"
      | "ACCEPTED";
    note: string;
    metadata: Prisma.InputJsonValue;
  },
) {
  if (input.fromStatus === input.toStatus) return input.fromStatus;
  if (!isAllowedStatusTransition(input.fromStatus, input.toStatus)) {
    throw new CareerConflictError(
      "INVALID_STATUS_TRANSITION",
      `Cannot move job from ${input.fromStatus} to ${input.toStatus}`,
    );
  }
  const updated = await tx.job.updateMany({
    where: {
      id: input.jobId,
      userId: input.userId,
      status: input.fromStatus,
    },
    data: { status: input.toStatus },
  });
  if (updated.count !== 1) {
    throw new CareerConflictError(
      "STALE_STATUS",
      "Job status changed while the career record was being saved",
    );
  }
  const job = await requireOwnedJob(tx, input.userId, input.jobId);
  await tx.applicationEvent.create({
    data: {
      userId: input.userId,
      jobId: input.jobId,
      companySnapshot: job.company,
      titleSnapshot: job.title,
      type: "STATUS_CHANGED",
      source: "USER",
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      note: input.note,
      metadata: input.metadata,
    },
  });
  return input.toStatus;
}

export function listStarStories(userId: string) {
  return prisma.starStory.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
}

type StarStoryInput = {
  title: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  reflection?: string;
  skills: string[];
  tags: string[];
  sourceEvidenceId?: string;
};

function starStoryHash(input: StarStoryInput): string {
  return contentHash({
    title: input.title,
    situation: input.situation,
    task: input.task,
    action: input.action,
    result: input.result,
    reflection: input.reflection ?? null,
    skills: [...input.skills].sort(),
    tags: [...input.tags].sort(),
  });
}

async function requireEvidence(
  tx: Prisma.TransactionClient,
  userId: string,
  evidenceId: string | undefined,
) {
  if (!evidenceId) return;
  const evidence = await tx.evidenceSnapshot.findFirst({
    where: { id: evidenceId, userId },
    select: { id: true },
  });
  if (!evidence) throw new CareerNotFoundError("evidence");
}

export function createStarStory(userId: string, input: StarStoryInput) {
  return prisma.$transaction(async (tx) => {
    await requireEvidence(tx, userId, input.sourceEvidenceId);
    const storyHash = starStoryHash(input);
    const existing = await tx.starStory.findUnique({
      where: { userId_storyHash: { userId, storyHash } },
    });
    if (existing) return { story: existing, reused: true };
    const story = await tx.starStory.create({
      data: {
        userId,
        ...input,
        skills: input.skills,
        tags: input.tags,
        storyHash,
      },
    });
    return { story, reused: false };
  });
}

export function updateStarStory(
  userId: string,
  id: string,
  patch: Partial<StarStoryInput>,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.starStory.findFirst({ where: { id, userId } });
    if (!existing) throw new CareerNotFoundError("star story");
    await requireEvidence(tx, userId, patch.sourceEvidenceId);
    const merged: StarStoryInput = {
      title: patch.title ?? existing.title,
      situation: patch.situation ?? existing.situation,
      task: patch.task ?? existing.task,
      action: patch.action ?? existing.action,
      result: patch.result ?? existing.result,
      reflection: patch.reflection ?? existing.reflection ?? undefined,
      skills: patch.skills ?? (existing.skills as string[]),
      tags: patch.tags ?? (existing.tags as string[]),
      sourceEvidenceId: patch.sourceEvidenceId ?? existing.sourceEvidenceId ?? undefined,
    };
    try {
      return await tx.starStory.update({
        where: { id: existing.id },
        data: { ...patch, skills: patch.skills, tags: patch.tags, storyHash: starStoryHash(merged) },
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002"
      ) {
        throw new CareerConflictError("DUPLICATE_STAR_STORY", "An identical STAR story already exists");
      }
      throw error;
    }
  });
}

export async function deleteStarStory(userId: string, id: string) {
  const result = await prisma.starStory.deleteMany({ where: { id, userId } });
  if (result.count === 0) throw new CareerNotFoundError("star story");
}

export function listInterviewPlans(userId: string, jobId?: string) {
  return prisma.interviewPlan.findMany({
    where: { userId, ...(jobId ? { jobId } : {}) },
    orderBy: [{ scheduledAt: "asc" }, { updatedAt: "desc" }],
  });
}

export function createInterviewPlan(
  userId: string,
  input: {
    jobId: string;
    round: number;
    title: string;
    scheduledAt?: Date | null;
    requirements: string[];
    locale: "en" | "zh";
    notes?: string;
  },
) {
  return prisma.$transaction(async (tx) => {
    const job = await requireOwnedJob(tx, userId, input.jobId);
    const stories = await tx.starStory.findMany({
      where: { userId },
      select: { id: true, title: true, skills: true, tags: true },
    });
    const storyInputs = stories.map((story) => ({
      id: story.id,
      title: story.title,
      skills: story.skills as string[],
      tags: story.tags as string[],
    }));
    const questions = buildInterviewQuestions(input.requirements, input.locale);
    const starMappings = mapStarStoriesToRequirements(input.requirements, storyInputs);
    const plan = await tx.interviewPlan.create({
      data: {
        userId,
        jobId: input.jobId,
        round: input.round,
        title: input.title,
        scheduledAt: input.scheduledAt,
        questions: questions as unknown as Prisma.InputJsonValue,
        starMappings: starMappings as unknown as Prisma.InputJsonValue,
        notes: input.notes,
      },
    });
    const metadata = {
      interviewPlanId: plan.id,
      round: plan.round,
      scheduledAt: plan.scheduledAt?.toISOString() ?? null,
    } as Prisma.InputJsonValue;
    await appendRecordEvent(tx, {
      userId,
      jobId: job.id,
      type: "INTERVIEW_PLANNED",
      note: `Created interview plan for round ${plan.round}`,
      metadata,
    });
    if (plan.scheduledAt && job.status !== "INTERVIEW" && job.status !== "OFFER" && job.status !== "ACCEPTED") {
      await projectStatus(tx, {
        userId,
        jobId: job.id,
        fromStatus: job.status,
        toStatus: "INTERVIEW",
        note: "Interview scheduled",
        metadata,
      });
    }
    return plan;
  });
}

export async function updateInterviewPlan(
  userId: string,
  id: string,
  patch: {
    title?: string;
    status?: "DRAFT" | "READY" | "COMPLETED" | "ARCHIVED";
    scheduledAt?: Date | null;
    notes?: string | null;
  },
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.interviewPlan.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new CareerNotFoundError("interview plan");
    const updated = await tx.interviewPlan.update({
      where: { id: existing.id },
      data: patch,
    });
    if (patch.status === "COMPLETED" && existing.status !== "COMPLETED") {
      await appendRecordEvent(tx, {
        userId,
        jobId: existing.jobId,
        type: "INTERVIEW_COMPLETED",
        note: `Completed interview plan round ${existing.round}`,
        metadata: {
          interviewPlanId: existing.id,
          round: existing.round,
        },
      });
    }
    return updated;
  });
}

export async function deleteInterviewPlan(userId: string, id: string) {
  const result = await prisma.interviewPlan.deleteMany({ where: { id, userId } });
  if (result.count === 0) throw new CareerNotFoundError("interview plan");
}

export type OfferInput = {
  jobId?: string;
  company: string;
  role: string;
  currency: string;
  baseSalaryAnnual?: number | null;
  bonusAnnual?: number | null;
  equityAnnual?: number | null;
  otherAnnual?: number | null;
  targetSalaryAnnual?: number | null;
  benefits: string[];
  location?: string;
  status: "ACTIVE" | "ACCEPTED" | "DECLINED" | "WITHDRAWN";
  receivedAt?: Date | null;
  deadlineAt?: Date | null;
  notes?: string;
};

export function listOffers(userId: string) {
  return prisma.offer.findMany({
    where: { userId },
    orderBy: [{ status: "asc" }, { receivedAt: "desc" }],
  });
}

export function createOffer(userId: string, input: OfferInput) {
  return prisma.$transaction(async (tx) => {
    const job = input.jobId
      ? await requireOwnedJob(tx, userId, input.jobId)
      : null;
    const offer = await tx.offer.create({
      data: {
        userId,
        ...input,
        benefits: input.benefits,
        receivedAt: input.receivedAt ?? undefined,
      },
    });
    if (job) {
      const metadata = {
        offerId: offer.id,
        currency: offer.currency,
      } as Prisma.InputJsonValue;
      await appendRecordEvent(tx, {
        userId,
        jobId: job.id,
        type: "OFFER_RECORDED",
        note: `Recorded offer from ${offer.company}`,
        metadata,
      });
      let projected = job.status;
      if (projected !== "OFFER" && projected !== "ACCEPTED") {
        projected = await projectStatus(tx, {
          userId,
          jobId: job.id,
          fromStatus: projected,
          toStatus: "OFFER",
          note: "Offer recorded",
          metadata,
        });
      }
      if (offer.status === "ACCEPTED" && projected !== "ACCEPTED") {
        await projectStatus(tx, {
          userId,
          jobId: job.id,
          fromStatus: projected,
          toStatus: "ACCEPTED",
          note: "Offer accepted",
          metadata,
        });
      } else if (offer.status === "DECLINED" && projected !== "WITHDRAWN") {
        await projectStatus(tx, {
          userId,
          jobId: job.id,
          fromStatus: projected,
          toStatus: "WITHDRAWN",
          note: "Offer declined",
          metadata,
        });
      }
    }
    return offer;
  });
}

export async function updateOffer(
  userId: string,
  id: string,
  patch: Partial<OfferInput>,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.offer.findFirst({ where: { id, userId } });
    if (!existing) throw new CareerNotFoundError("offer");
    const targetJobId = patch.jobId ?? existing.jobId;
    const job = targetJobId
      ? await requireOwnedJob(tx, userId, targetJobId)
      : null;
    const updated = await tx.offer.update({
      where: { id: existing.id },
      data: {
        ...patch,
        benefits: patch.benefits,
        receivedAt: patch.receivedAt ?? undefined,
      },
    });
    if (job) {
      const statusChanged = patch.status && patch.status !== existing.status;
      const metadata = {
        offerId: existing.id,
        previousOfferStatus: existing.status,
        offerStatus: updated.status,
      } as Prisma.InputJsonValue;
      await appendRecordEvent(tx, {
        userId,
        jobId: job.id,
        type: statusChanged ? "OFFER_DECIDED" : "OFFER_UPDATED",
        note: statusChanged ? `Offer marked ${updated.status}` : "Offer details updated",
        metadata,
      });
      if (updated.status === "ACCEPTED" && job.status !== "ACCEPTED") {
        const fromStatus = job.status === "OFFER"
          ? job.status
          : await projectStatus(tx, {
              userId,
              jobId: job.id,
              fromStatus: job.status,
              toStatus: "OFFER",
              note: "Offer recorded",
              metadata,
            });
        await projectStatus(tx, {
          userId,
          jobId: job.id,
          fromStatus,
          toStatus: "ACCEPTED",
          note: "Offer accepted",
          metadata,
        });
      } else if (updated.status === "DECLINED" && job.status !== "WITHDRAWN") {
        const fromStatus = job.status === "OFFER"
          ? job.status
          : await projectStatus(tx, {
              userId,
              jobId: job.id,
              fromStatus: job.status,
              toStatus: "OFFER",
              note: "Offer recorded",
              metadata,
            });
        await projectStatus(tx, {
          userId,
          jobId: job.id,
          fromStatus,
          toStatus: "WITHDRAWN",
          note: "Offer declined",
          metadata,
        });
      }
    }
    return updated;
  });
}

export async function deleteOffer(userId: string, id: string) {
  const result = await prisma.offer.deleteMany({ where: { id, userId } });
  if (result.count === 0) throw new CareerNotFoundError("offer");
}

export function listReminders(userId: string) {
  return prisma.followUpReminder.findMany({
    where: { userId },
    orderBy: [{ completedAt: "asc" }, { dismissedAt: "asc" }, { dueAt: "asc" }],
  });
}

type ReminderInput = {
  jobId?: string;
  applicationId?: string;
  type:
    | "APPLICATION_FOLLOW_UP"
    | "INTERVIEW_THANK_YOU"
    | "OFFER_DEADLINE"
    | "CUSTOM";
  title: string;
  dueAt: Date;
  note?: string;
};

export function createReminder(userId: string, input: ReminderInput) {
  return prisma.$transaction(async (tx) => {
    if (input.jobId) await requireOwnedJob(tx, userId, input.jobId);
    let eventJobId = input.jobId;
    if (input.applicationId) {
      const application = await requireOwnedApplication(tx, userId, input.applicationId);
      if (input.jobId && application.jobId && application.jobId !== input.jobId) {
        throw new CareerConflictError(
          "REMINDER_SCOPE_MISMATCH",
          "Application and job do not belong to the same career record",
        );
      }
      eventJobId ??= application.jobId ?? undefined;
    }
    const reminder = await tx.followUpReminder.create({ data: { userId, ...input } });
    if (eventJobId) {
      await appendRecordEvent(tx, {
        userId,
        jobId: eventJobId,
        type: "FOLLOW_UP_CREATED",
        note: `Created reminder: ${reminder.title}`,
        metadata: {
          reminderId: reminder.id,
          reminderType: reminder.type,
          dueAt: reminder.dueAt.toISOString(),
        },
      });
    }
    return reminder;
  });
}

export async function updateReminder(
  userId: string,
  id: string,
  patch: {
    title?: string;
    dueAt?: Date;
    note?: string | null;
    completed?: boolean;
    dismissed?: boolean;
  },
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.followUpReminder.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new CareerNotFoundError("reminder");
    const now = new Date();
    const reminder = await tx.followUpReminder.update({
      where: { id: existing.id },
      data: {
        title: patch.title,
        dueAt: patch.dueAt,
        note: patch.note,
        completedAt: patch.completed === undefined ? undefined : patch.completed ? now : null,
        dismissedAt: patch.dismissed === undefined ? undefined : patch.dismissed ? now : null,
      },
    });
    if (patch.completed && !existing.completedAt) {
      const application = !existing.jobId && existing.applicationId
        ? await requireOwnedApplication(tx, userId, existing.applicationId)
        : null;
      const eventJobId = existing.jobId ?? application?.jobId;
      if (eventJobId) {
        await appendRecordEvent(tx, {
          userId,
          jobId: eventJobId,
          type: "FOLLOW_UP_COMPLETED",
          note: `Completed reminder: ${reminder.title}`,
          metadata: {
            reminderId: reminder.id,
            reminderType: reminder.type,
          },
        });
      }
    }
    return reminder;
  });
}

export async function deleteReminder(userId: string, id: string) {
  const result = await prisma.followUpReminder.deleteMany({ where: { id, userId } });
  if (result.count === 0) throw new CareerNotFoundError("reminder");
}

export type ReminderSuggestion = {
  key: string;
  jobId: string;
  type: "APPLICATION_FOLLOW_UP" | "INTERVIEW_THANK_YOU" | "OFFER_DEADLINE";
  title: string;
  dueAt: Date;
  reason: string;
};

export async function deriveReminderSuggestions(
  userId: string,
  now = new Date(),
): Promise<ReminderSuggestion[]> {
  const [events, reminders, offers] = await Promise.all([
    prisma.applicationEvent.findMany({
      where: {
        userId,
        type: "STATUS_CHANGED",
        jobId: { not: null },
        toStatus: { in: ["APPLIED", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN", "ACCEPTED"] },
      },
      select: { jobId: true, toStatus: true, occurredAt: true },
      orderBy: { occurredAt: "asc" },
    }),
    prisma.followUpReminder.findMany({
      where: { userId },
      select: { jobId: true, type: true, dueAt: true },
    }),
    prisma.offer.findMany({
      where: {
        userId,
        status: "ACTIVE",
        deadlineAt: { not: null },
      },
      select: { id: true, jobId: true, company: true, deadlineAt: true },
    }),
  ]);

  const retainedEvents = events.filter(
    (event): event is typeof event & { jobId: string } => event.jobId !== null,
  );
  const latest = new Map<string, (typeof retainedEvents)[number]>();
  for (const event of retainedEvents) latest.set(event.jobId, event);
  const hasReminder = (jobId: string, type: string, dueAt: Date) =>
    reminders.some(
      (reminder) =>
        reminder.jobId === jobId &&
        reminder.type === type &&
        Math.abs(reminder.dueAt.getTime() - dueAt.getTime()) < 86_400_000,
    );
  const suggestions: ReminderSuggestion[] = [];
  for (const event of latest.values()) {
    if (event.toStatus === "APPLIED") {
      const dueAt = new Date(event.occurredAt.getTime() + 5 * 86_400_000);
      if (dueAt <= now && !hasReminder(event.jobId, "APPLICATION_FOLLOW_UP", dueAt)) {
        suggestions.push({
          key: `application:${event.jobId}:${dueAt.toISOString()}`,
          jobId: event.jobId,
          type: "APPLICATION_FOLLOW_UP",
          title: "Follow up on application",
          dueAt,
          reason: "Five days have passed since the latest application event.",
        });
      }
    }
    if (event.toStatus === "INTERVIEW") {
      const dueAt = new Date(event.occurredAt.getTime() + 86_400_000);
      if (dueAt <= now && !hasReminder(event.jobId, "INTERVIEW_THANK_YOU", dueAt)) {
        suggestions.push({
          key: `interview:${event.jobId}:${dueAt.toISOString()}`,
          jobId: event.jobId,
          type: "INTERVIEW_THANK_YOU",
          title: "Send interview thank-you",
          dueAt,
          reason: "One day has passed since the latest interview event.",
        });
      }
    }
  }
  for (const offer of offers) {
    if (!offer.jobId || !offer.deadlineAt) continue;
    const dueAt = new Date(offer.deadlineAt.getTime() - 2 * 86_400_000);
    if (dueAt <= now && !hasReminder(offer.jobId, "OFFER_DEADLINE", dueAt)) {
      suggestions.push({
        key: `offer:${offer.id}:${dueAt.toISOString()}`,
        jobId: offer.jobId,
        type: "OFFER_DEADLINE",
        title: `Review ${offer.company} offer deadline`,
        dueAt,
        reason: "Offer deadline is within two days.",
      });
    }
  }
  return suggestions.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}
