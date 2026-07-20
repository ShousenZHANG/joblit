import { prisma } from "@/lib/server/prisma";
import { CareerNotFoundError } from "./errors";
import {
  buildInterviewQuestions,
  buildNegotiationScript,
  mapStarStoriesToRequirements,
} from "./toolkit";

export async function createInterviewToolkit(
  userId: string,
  input: { requirements: string[]; locale: "en" | "zh" },
) {
  const stories = await prisma.starStory.findMany({
    where: { userId },
    select: { id: true, title: true, skills: true, tags: true },
  });
  const storyInputs = stories.map((story) => ({
    id: story.id,
    title: story.title,
    skills: story.skills as string[],
    tags: story.tags as string[],
  }));
  return {
    questions: buildInterviewQuestions(input.requirements, input.locale),
    starMappings: mapStarStoriesToRequirements(input.requirements, storyInputs),
    grounding: {
      storyCount: storyInputs.length,
      inventedFacts: [],
    },
  };
}

export async function createNegotiationToolkit(
  userId: string,
  input: { offerId: string; strengths: string[]; locale: "en" | "zh" },
) {
  const offer = await prisma.offer.findFirst({
    where: { id: input.offerId, userId },
  });
  if (!offer) throw new CareerNotFoundError("offer");
  const values = [
    offer.baseSalaryAnnual,
    offer.bonusAnnual,
    offer.equityAnnual,
    offer.otherAnnual,
  ];
  const known = values.filter((value): value is number => value !== null);
  const offeredTotal = known.length === 0
    ? null
    : known.reduce((sum, value) => sum + value, 0);
  return buildNegotiationScript({
    company: offer.company,
    role: offer.role,
    currency: offer.currency,
    offeredTotal,
    targetTotal: offer.targetSalaryAnnual,
    strengths: input.strengths,
    locale: input.locale,
  });
}
