import { prisma } from "@/lib/server/prisma";

type Status =
  | "NEW"
  | "APPLIED"
  | "INTERVIEW"
  | "OFFER"
  | "REJECTED"
  | "WITHDRAWN"
  | "ACCEPTED";

type StatusEvent = {
  jobId: string;
  toStatus: Status | null;
  occurredAt: Date;
};

type JobProjection = {
  id: string;
  status: Status;
};

export type ComparableOffer = {
  id: string;
  company: string;
  role: string;
  currency: string;
  baseSalaryAnnual: number | null;
  bonusAnnual: number | null;
  equityAnnual: number | null;
  otherAnnual: number | null;
  targetSalaryAnnual: number | null;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(4));
}

export function buildFunnelAnalytics(
  events: StatusEvent[],
  currentJobs: JobProjection[],
) {
  const reached = new Map<Status, Set<string>>();
  for (const status of [
    "NEW",
    "APPLIED",
    "INTERVIEW",
    "OFFER",
    "REJECTED",
    "WITHDRAWN",
    "ACCEPTED",
  ] as const) {
    reached.set(status, new Set());
  }
  for (const job of currentJobs) reached.get(job.status)?.add(job.id);
  for (const event of events) {
    if (event.toStatus) reached.get(event.toStatus)?.add(event.jobId);
  }

  const ordered = [...events]
    .filter((event): event is StatusEvent & { toStatus: Status } => Boolean(event.toStatus))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const firstReached = new Map<string, Map<Status, Date>>();
  for (const event of ordered) {
    const perJob = firstReached.get(event.jobId) ?? new Map<Status, Date>();
    if (!perJob.has(event.toStatus)) perJob.set(event.toStatus, event.occurredAt);
    firstReached.set(event.jobId, perJob);
  }

  const appliedToInterview: number[] = [];
  const interviewToOffer: number[] = [];
  const offerToAccepted: number[] = [];
  for (const timeline of firstReached.values()) {
    const pairs: Array<[Status, Status, number[]]> = [
      ["APPLIED", "INTERVIEW", appliedToInterview],
      ["INTERVIEW", "OFFER", interviewToOffer],
      ["OFFER", "ACCEPTED", offerToAccepted],
    ];
    for (const [from, to, bucket] of pairs) {
      const start = timeline.get(from);
      const end = timeline.get(to);
      if (start && end && end >= start) {
        bucket.push((end.getTime() - start.getTime()) / 86_400_000);
      }
    }
  }

  const counts = {
    applied: reached.get("APPLIED")?.size ?? 0,
    interview: reached.get("INTERVIEW")?.size ?? 0,
    offer: reached.get("OFFER")?.size ?? 0,
    accepted: reached.get("ACCEPTED")?.size ?? 0,
    rejected: reached.get("REJECTED")?.size ?? 0,
    withdrawn: reached.get("WITHDRAWN")?.size ?? 0,
  };

  return {
    counts,
    conversion: {
      appliedToInterview: ratio(counts.interview, counts.applied),
      interviewToOffer: ratio(counts.offer, counts.interview),
      offerToAccepted: ratio(counts.accepted, counts.offer),
    },
    medianDays: {
      appliedToInterview: median(appliedToInterview),
      interviewToOffer: median(interviewToOffer),
      offerToAccepted: median(offerToAccepted),
    },
    sampleSizes: {
      appliedToInterview: appliedToInterview.length,
      interviewToOffer: interviewToOffer.length,
      offerToAccepted: offerToAccepted.length,
    },
  };
}

export function compareOffers(offers: ComparableOffer[]) {
  const normalized = offers.map((offer) => {
    const components = [
      offer.baseSalaryAnnual,
      offer.bonusAnnual,
      offer.equityAnnual,
      offer.otherAnnual,
    ];
    const known = components.filter((value): value is number => value !== null);
    const totalAnnual = known.reduce((sum, value) => sum + value, 0);
    const incomplete = known.length !== components.length;
    return {
      ...offer,
      totalAnnual,
      incomplete,
      salaryGap:
        offer.targetSalaryAnnual === null || incomplete
          ? null
          : offer.targetSalaryAnnual - totalAnnual,
    };
  });

  const currencies = new Map<string, typeof normalized>();
  for (const offer of normalized) {
    const group = currencies.get(offer.currency) ?? [];
    group.push(offer);
    currencies.set(offer.currency, group);
  }

  return {
    currencies: [...currencies.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, group]) => ({
        currency,
        offers: group
          .sort(
            (a, b) =>
              Number(a.incomplete) - Number(b.incomplete) ||
              b.totalAnnual - a.totalAnnual ||
              a.id.localeCompare(b.id),
          )
          .map((offer, index) => ({ ...offer, rank: index + 1 })),
      })),
    crossCurrencyComparison: false,
    note: "No exchange rate was assumed; offers are ranked only within the same currency.",
  };
}

export async function getCareerAnalytics(
  userId: string,
  range: { from?: Date; to?: Date },
) {
  const occurredAt = {
    ...(range.from ? { gte: range.from } : {}),
    ...(range.to ? { lte: range.to } : {}),
  };
  const [events, jobs, offers] = await Promise.all([
    prisma.applicationEvent.findMany({
      where: {
        userId,
        type: "STATUS_CHANGED",
        jobId: { not: null },
        ...(range.from || range.to ? { occurredAt } : {}),
      },
      select: { jobId: true, toStatus: true, occurredAt: true },
    }),
    prisma.job.findMany({
      where: { userId },
      select: { id: true, status: true },
    }),
    prisma.offer.findMany({
      where: { userId },
      select: {
        id: true,
        company: true,
        role: true,
        currency: true,
        baseSalaryAnnual: true,
        bonusAnnual: true,
        equityAnnual: true,
        otherAnnual: true,
        targetSalaryAnnual: true,
      },
    }),
  ]);
  const retainedEvents = events.filter(
    (event): event is typeof event & { jobId: string } => event.jobId !== null,
  );
  return {
    funnel: buildFunnelAnalytics(retainedEvents, jobs),
    offers: compareOffers(offers),
  };
}
